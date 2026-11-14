-- Bring your own key, fourth provider: Claude on Amazon Bedrock (domain/ai/providers.ts). The key is a
-- long-term Bedrock API key sent as a bearer token to bedrock-runtime.<region>.amazonaws.com; the endpoint
-- column holds only the AWS Region, so the address is always Amazon's. Model ids may hold : and / (inference
-- profile ARNs), which the model rule already allows. Offered to workspaces only after the extraction eval.

alter table public.workspace_ai_settings drop constraint workspace_ai_settings_provider_check;
alter table public.workspace_ai_settings add constraint workspace_ai_settings_provider_check
  check (provider in ('openai', 'azure_openai', 'anthropic', 'openai_compatible', 'bedrock'));

alter table public.workspace_ai_settings drop constraint workspace_ai_settings_endpoint_check;
alter table public.workspace_ai_settings add constraint workspace_ai_settings_endpoint_check check (
  (provider = 'azure_openai' and endpoint is not null and endpoint ~ '^https://[a-z0-9][a-z0-9-]{0,62}\.(openai\.azure\.com|cognitiveservices\.azure\.com|services\.ai\.azure\.com)$')
  or (provider = 'openai_compatible' and endpoint is not null and length(endpoint) <= 200
      and endpoint ~ '^https://[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+(/[A-Za-z0-9._~-]{1,64})*$'
      and endpoint !~ '^https://[0-9.]+(/|$)')
  or (provider = 'bedrock' and endpoint is not null and endpoint ~ '^[a-z]{2}(-gov)?-[a-z]+-[0-9]$')
  or (provider not in ('azure_openai', 'openai_compatible', 'bedrock') and endpoint is null)
);

create or replace function public.set_workspace_ai(target_workspace uuid, ai_provider text, ai_model text, ai_endpoint text default null, api_key text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  model text := trim(coalesce(ai_model, ''));
  endpoint text := nullif(regexp_replace(trim(coalesce(ai_endpoint, '')), '/+$', ''), '');
  new_key text := nullif(trim(coalesce(api_key, '')), '');
  current public.workspace_ai_settings;
  key_secret uuid;
  saved public.workspace_ai_settings;
begin
  if not app_private.is_workspace_admin(target_workspace) then
    raise exception 'Only an admin can change the AI provider.' using errcode = '42501';
  end if;
  if ai_provider is null or ai_provider not in ('openai', 'azure_openai', 'anthropic', 'openai_compatible', 'bedrock') then
    raise exception 'Choose a provider.' using errcode = '22023';
  end if;
  if ai_provider not in ('azure_openai', 'openai_compatible', 'bedrock') then endpoint := null; end if;
  if ai_provider in ('azure_openai', 'bedrock') then endpoint := lower(endpoint); end if;
  if ai_provider = 'azure_openai' and endpoint is null then
    raise exception 'Enter the endpoint of your Azure OpenAI resource.' using errcode = '22023';
  end if;
  if ai_provider = 'openai_compatible' and endpoint is null then
    raise exception 'Enter the address of your endpoint.' using errcode = '22023';
  end if;
  if ai_provider = 'bedrock' and endpoint is null then
    raise exception 'Enter the AWS Region of your Bedrock model.' using errcode = '22023';
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
