-- Bring your own key. Rolls back; success ends with the error "ALL_TESTS_PASSED (9 groups)";
-- any other error names the failed check.
do $test$
declare
  admin_u uuid := gen_random_uuid();
  editor_u uuid := gen_random_uuid();
  outsider_u uuid := gen_random_uuid();
  ws uuid; n int; r jsonb; t text; passed int := 0;
  key1 text := 'sk-proj-test-' || replace(gen_random_uuid()::text, '-', '') || 'AB12';
  key2 text := 'azure-test-' || replace(gen_random_uuid()::text, '-', '') || 'CD34';
  key3 text := 'ant-test-' || replace(gen_random_uuid()::text, '-', '') || 'EF56';
  key4 text := 'gw-test-' || replace(gen_random_uuid()::text, '-', '') || 'GH78';
  key5 text := 'ABSK' || replace(gen_random_uuid()::text, '-', '') || 'IJ90';
begin
  insert into auth.users (id, email, invited_at, email_confirmed_at) values
    (admin_u, 'a-' || admin_u || '@example.test', now(), now()), (editor_u, 'e-' || editor_u || '@example.test', now(), now()), (outsider_u, 'o-' || outsider_u || '@example.test', now(), now());
  delete from app_private.platform_owners;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ws := (public.create_organization('AI test', 'AP') ->> 'workspaceId')::uuid;
  execute 'reset role';
  insert into public.workspace_members (workspace_id, user_id, role, can_approve) values (ws, editor_u, 'editor', false);

  -- 1. An admin sets an OpenAI key; only its last four characters are kept where members read.
  perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  r := public.set_workspace_ai(ws, 'openai', 'gpt-5.5', 'https://ignored.example', '  ' || key1 || ' ');
  if r ->> 'keyHint' <> 'AB12' or r ->> 'endpoint' is not null or r::text like '%' || key1 || '%' then raise exception 'FAILED 1a: %', r; end if;
  select count(*) into n from public.workspace_ai_settings where workspace_id = ws and key_hint = 'AB12';
  if n <> 1 then raise exception 'FAILED 1b: settings not readable by the admin'; end if;
  execute 'reset role';
  select string_agg(row_to_json(s)::text, '') into t from public.workspace_ai_settings s where workspace_id = ws;
  if t like '%' || key1 || '%' then raise exception 'FAILED 1c: key stored in the settings table'; end if;
  select count(*) into n from vault.decrypted_secrets where decrypted_secret = key1;
  if n <> 1 then raise exception 'FAILED 1d: key not in the vault'; end if;
  passed := passed + 1;

  -- 2. An editor reads the settings but cannot change them or read the key; an outsider sees nothing.
  perform set_config('request.jwt.claims', json_build_object('sub', editor_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.workspace_ai_settings where workspace_id = ws;
  if n <> 1 then raise exception 'FAILED 2a: editor cannot read settings'; end if;
  begin perform public.set_workspace_ai(ws, 'openai', 'gpt-4.1', null, key1); raise exception 'FAILED 2b: editor changed the provider';
  exception when insufficient_privilege then null; end;
  begin perform public.clear_workspace_ai(ws); raise exception 'FAILED 2c: editor removed the key';
  exception when insufficient_privilege then null; end;
  begin perform public.workspace_ai_connection(ws); raise exception 'FAILED 2d: editor read the key';
  exception when insufficient_privilege then null; end;
  begin perform 1 from app_private.workspace_ai_keys; raise exception 'FAILED 2e: key table readable';
  exception when insufficient_privilege then null; end;
  begin update public.workspace_ai_settings set model = 'x' where workspace_id = ws; exception when insufficient_privilege then null; end;
  execute 'reset role';
  select count(*) into n from public.workspace_ai_settings where workspace_id = ws and model = 'gpt-5.5';
  if n <> 1 then raise exception 'FAILED 2f: direct write changed the settings'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', outsider_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.workspace_ai_settings where workspace_id = ws;
  if n <> 0 then raise exception 'FAILED 2g: outsider read settings'; end if;
  execute 'reset role';
  passed := passed + 1;

  -- 3. The server reads the connection with the key.
  r := public.workspace_ai_connection(ws);
  if r ->> 'provider' <> 'openai' or r ->> 'model' <> 'gpt-5.5' or r ->> 'apiKey' <> key1 then raise exception 'FAILED 3: %', r ->> 'provider'; end if;
  passed := passed + 1;

  -- 4. Changing the model keeps the key; changing the provider needs a new key; Azure needs its endpoint.
  perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  r := public.set_workspace_ai(ws, 'openai', 'gpt-4.1', null, null);
  if r ->> 'keyHint' <> 'AB12' or r ->> 'model' <> 'gpt-4.1' then raise exception 'FAILED 4a: %', r; end if;
  begin perform public.set_workspace_ai(ws, 'azure_openai', 'prod', 'https://acme.openai.azure.com', null); raise exception 'FAILED 4b: provider changed without a key';
  exception when invalid_parameter_value then null; end;
  begin perform public.set_workspace_ai(ws, 'azure_openai', 'prod', null, key2); raise exception 'FAILED 4c: Azure without an endpoint';
  exception when invalid_parameter_value then null; end;
  begin perform public.set_workspace_ai(ws, 'azure_openai', 'prod', 'https://evil.example', key2); raise exception 'FAILED 4d: endpoint off Azure accepted';
  exception when check_violation then null; end;
  begin perform public.set_workspace_ai(ws, 'openai', 'gpt-5.5', null, 'short'); raise exception 'FAILED 4e: short key accepted';
  exception when invalid_parameter_value then null; end;
  r := public.set_workspace_ai(ws, 'azure_openai', 'prod', 'https://ACME.openai.azure.com', key2);
  if r ->> 'keyHint' <> 'CD34' or r ->> 'endpoint' <> 'https://acme.openai.azure.com' then raise exception 'FAILED 4f: %', r; end if;
  execute 'reset role';
  if (public.workspace_ai_connection(ws) ->> 'apiKey') <> key2 then raise exception 'FAILED 4g: key not replaced'; end if;
  select count(*) into n from vault.secrets where name = 'workspace-ai-' || ws;
  if n <> 1 then raise exception 'FAILED 4h: % vault secrets for the workspace', n; end if;
  passed := passed + 1;

  -- 5. Removing the key deletes it from the vault and returns the workspace to the platform key.
  perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.clear_workspace_ai(ws);
  execute 'reset role';
  select count(*) into n from vault.secrets where name = 'workspace-ai-' || ws;
  if n <> 0 then raise exception 'FAILED 5a: key left in the vault'; end if;
  if public.workspace_ai_connection(ws) is not null then raise exception 'FAILED 5b: connection still returned'; end if;
  passed := passed + 1;

  -- 6. The platform allowance counts only calls on the platform key.
  insert into public.ai_usage (workspace_id, user_id, task, model, status, input_tokens, output_tokens, key_source) values
    (ws, admin_u, 't', 'm', 'ok', 100, 10, 'platform'), (ws, admin_u, 't', 'm', 'ok', 5000, 500, 'workspace');
  if public.ai_tokens_used_this_month(ws) <> 110 then raise exception 'FAILED 6: allowance counted %', public.ai_tokens_used_this_month(ws); end if;
  passed := passed + 1;

  -- 7. Anthropic takes a model id and no endpoint, and needs its own key; an unknown provider is refused.
  perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  r := public.set_workspace_ai(ws, 'openai', 'gpt-5.5', null, key1);
  begin perform public.set_workspace_ai(ws, 'anthropic', 'claude-sonnet-5-5', null, null); raise exception 'FAILED 7a: provider changed without a key';
  exception when invalid_parameter_value then null; end;
  r := public.set_workspace_ai(ws, 'anthropic', 'claude-sonnet-5-5', 'https://ignored.example', key3);
  if r ->> 'provider' <> 'anthropic' or r ->> 'keyHint' <> 'EF56' or r ->> 'endpoint' is not null then raise exception 'FAILED 7b: %', r; end if;
  begin perform public.set_workspace_ai(ws, 'vertex', 'x', null, key3); raise exception 'FAILED 7c: unknown provider accepted';
  exception when invalid_parameter_value then null; end;
  execute 'reset role';
  r := public.workspace_ai_connection(ws);
  if r ->> 'provider' <> 'anthropic' or r ->> 'apiKey' <> key3 then raise exception 'FAILED 7d: %', r ->> 'provider'; end if;
  passed := passed + 1;

  -- 8. An OpenAI-compatible endpoint needs an https host name (no IP address, no port), and a served model name may hold a slash.
  perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.set_workspace_ai(ws, 'openai_compatible', 'm', null, key4); raise exception 'FAILED 8a: no endpoint accepted';
  exception when invalid_parameter_value then null; end;
  begin perform public.set_workspace_ai(ws, 'openai_compatible', 'm', 'https://10.0.0.1/v1', key4); raise exception 'FAILED 8b: IP address accepted';
  exception when check_violation then null; end;
  begin perform public.set_workspace_ai(ws, 'openai_compatible', 'm', 'https://llm.acme-corp.com:8443/v1', key4); raise exception 'FAILED 8c: port accepted';
  exception when check_violation then null; end;
  begin perform public.set_workspace_ai(ws, 'openai_compatible', 'm', 'http://llm.acme-corp.com/v1', key4); raise exception 'FAILED 8d: http accepted';
  exception when check_violation then null; end;
  r := public.set_workspace_ai(ws, 'openai_compatible', 'meta-llama/Llama-3.3-70B-Instruct', 'https://llm.acme-corp.com/v1/', key4);
  if r ->> 'endpoint' <> 'https://llm.acme-corp.com/v1' or r ->> 'model' <> 'meta-llama/Llama-3.3-70B-Instruct' or r ->> 'keyHint' <> 'GH78' then raise exception 'FAILED 8e: %', r; end if;
  r := public.set_workspace_ai(ws, 'openai', 'gpt-5.5', 'https://llm.acme-corp.com/v1', key1);
  if r ->> 'endpoint' is not null then raise exception 'FAILED 8f: endpoint kept for OpenAI'; end if;
  execute 'reset role';
  passed := passed + 1;

  -- 9. Claude on Bedrock takes a model or inference profile id (with : and /) and an AWS Region as its endpoint.
  perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.set_workspace_ai(ws, 'bedrock', 'm', null, key5); raise exception 'FAILED 9a: no Region accepted';
  exception when invalid_parameter_value then null; end;
  begin perform public.set_workspace_ai(ws, 'bedrock', 'm', 'https://bedrock-runtime.us-east-1.amazonaws.com', key5); raise exception 'FAILED 9b: an address accepted as the Region';
  exception when check_violation then null; end;
  r := public.set_workspace_ai(ws, 'bedrock', 'arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/abc', 'EU-Central-1', key5);
  if r ->> 'provider' <> 'bedrock' or r ->> 'endpoint' <> 'eu-central-1' or r ->> 'keyHint' <> 'IJ90' then raise exception 'FAILED 9c: %', r; end if;
  execute 'reset role';
  r := public.workspace_ai_connection(ws);
  if r ->> 'apiKey' <> key5 or r ->> 'endpoint' <> 'eu-central-1' then raise exception 'FAILED 9d: %', r ->> 'provider'; end if;
  passed := passed + 1;

  raise exception 'ALL_TESTS_PASSED (% groups)', passed;
end $test$;
