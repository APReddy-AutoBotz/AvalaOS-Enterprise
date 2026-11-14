-- Bring your own key (BYOK), first step: a workspace may use its own OpenAI or Azure OpenAI key.
--
-- public.workspace_ai_settings: the provider, model (or Azure deployment), Azure endpoint and the key's last
--   four characters. Members read it; nobody writes it directly.
-- app_private.workspace_ai_keys: which Vault secret holds the key. The key itself is in vault.secrets,
--   encrypted, and is read only by public.workspace_ai_connection, which only the server (service role)
--   may call. It is never returned to the browser.
-- public.set_workspace_ai / public.clear_workspace_ai: admins only.
-- ai_usage.key_source: whose key a call used; the platform's monthly allowance counts only the platform's.
-- A workspace without its own key keeps using the platform key, within the allowance (journey-ai).

create table public.workspace_ai_settings (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  provider text not null check (provider in ('openai', 'azure_openai')),
  model text not null check (model ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
  endpoint text check (endpoint is null or endpoint ~ '^https://[a-z0-9][a-z0-9-]{0,62}\.(openai\.azure\.com|cognitiveservices\.azure\.com|services\.ai\.azure\.com)$'),
  key_hint text not null check (length(key_hint) = 4),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  last_used_at timestamptz,
  last_tested_at timestamptz,
  last_test_ok boolean,
  check ((provider = 'azure_openai') = (endpoint is not null))
);

alter table public.workspace_ai_settings enable row level security;
create policy workspace_ai_settings_select on public.workspace_ai_settings for select to authenticated
  using (app_private.is_workspace_member(workspace_id));
create index workspace_ai_settings_updated_by_idx on public.workspace_ai_settings (updated_by);

create table app_private.workspace_ai_keys (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  secret_id uuid not null
);
alter table app_private.workspace_ai_keys enable row level security;
revoke all on app_private.workspace_ai_keys from public, anon, authenticated;

create function public.set_workspace_ai(target_workspace uuid, ai_provider text, ai_model text, ai_endpoint text default null, api_key text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  model text := trim(coalesce(ai_model, ''));
  endpoint text := nullif(lower(trim(coalesce(ai_endpoint, ''))), '');
  new_key text := nullif(trim(coalesce(api_key, '')), '');
  current public.workspace_ai_settings;
  key_secret uuid;
  saved public.workspace_ai_settings;
begin
  if not app_private.is_workspace_admin(target_workspace) then
    raise exception 'Only an admin can change the AI provider.' using errcode = '42501';
  end if;
  if ai_provider is null or ai_provider not in ('openai', 'azure_openai') then
    raise exception 'Choose a provider.' using errcode = '22023';
  end if;
  if ai_provider = 'openai' then endpoint := null; end if;
  if ai_provider = 'azure_openai' and endpoint is null then
    raise exception 'Enter the endpoint of your Azure OpenAI resource.' using errcode = '22023';
  end if;
  if new_key is not null and (length(new_key) not between 20 and 400 or new_key ~ '\s') then
    raise exception 'Paste the whole API key.' using errcode = '22023';
  end if;

  select * into current from public.workspace_ai_settings where workspace_id = target_workspace;
  select secret_id into key_secret from app_private.workspace_ai_keys where workspace_id = target_workspace;
  if new_key is null and (key_secret is null or current.provider is distinct from ai_provider) then
    raise exception 'Paste the API key for this provider.' using errcode = '22023';
  end if;

  if new_key is not null then
    if key_secret is null then
      key_secret := vault.create_secret(new_key, 'workspace-ai-' || target_workspace, 'Avala OS: AI provider key of a workspace', null);
      insert into app_private.workspace_ai_keys (workspace_id, secret_id) values (target_workspace, key_secret);
    else
      perform vault.update_secret(key_secret, new_key, null, null, null);
    end if;
  end if;

  insert into public.workspace_ai_settings (workspace_id, provider, model, endpoint, key_hint, updated_by, updated_at)
  values (target_workspace, ai_provider, model, endpoint, coalesce(right(new_key, 4), current.key_hint), (select auth.uid()), now())
  on conflict (workspace_id) do update set
    provider = excluded.provider, model = excluded.model, endpoint = excluded.endpoint, key_hint = excluded.key_hint,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at,
    last_tested_at = null, last_test_ok = null
  returning * into saved;

  return jsonb_build_object('provider', saved.provider, 'model', saved.model, 'endpoint', saved.endpoint, 'keyHint', saved.key_hint, 'updatedAt', saved.updated_at);
end $$;

revoke all on function public.set_workspace_ai(uuid, text, text, text, text) from public, anon;
grant execute on function public.set_workspace_ai(uuid, text, text, text, text) to authenticated;

-- Back to the platform key: the workspace's key is deleted from the Vault.
create function public.clear_workspace_ai(target_workspace uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  key_secret uuid;
begin
  if not app_private.is_workspace_admin(target_workspace) then
    raise exception 'Only an admin can change the AI provider.' using errcode = '42501';
  end if;
  delete from app_private.workspace_ai_keys where workspace_id = target_workspace returning secret_id into key_secret;
  if key_secret is not null then delete from vault.secrets v where v.id = key_secret; end if;
  delete from public.workspace_ai_settings where workspace_id = target_workspace;
end $$;

revoke all on function public.clear_workspace_ai(uuid) from public, anon;
grant execute on function public.clear_workspace_ai(uuid) to authenticated;

-- The connection the server functions use, with the key. Service role only.
create function public.workspace_ai_connection(target_workspace uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('provider', s.provider, 'model', s.model, 'endpoint', s.endpoint, 'apiKey', d.decrypted_secret)
  from public.workspace_ai_settings s
  join app_private.workspace_ai_keys k on k.workspace_id = s.workspace_id
  join vault.decrypted_secrets d on d.id = k.secret_id
  where s.workspace_id = target_workspace;
$$;

revoke all on function public.workspace_ai_connection(uuid) from public, anon, authenticated;
grant execute on function public.workspace_ai_connection(uuid) to service_role;

alter table public.ai_usage add column key_source text not null default 'platform' check (key_source in ('platform', 'workspace'));

-- The platform's monthly allowance counts only calls made on the platform key.
create or replace function public.ai_tokens_used_this_month(target_workspace uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(input_tokens + output_tokens), 0)::bigint
  from public.ai_usage
  where workspace_id = target_workspace
    and key_source = 'platform'
    and created_at >= date_trunc('month', now());
$$;
