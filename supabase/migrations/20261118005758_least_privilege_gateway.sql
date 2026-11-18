GRANT USAGE ON SCHEMA forms TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA forms TO service_role;
ALTER FUNCTION public.forms_gateway_authorize(text) SECURITY INVOKER;
ALTER FUNCTION public.forms_gateway_batch(jsonb) SECURITY INVOKER;
CREATE FUNCTION forms.changes() RETURNS bigint LANGUAGE sql STABLE SET search_path='' AS $$ SELECT COALESCE(NULLIF(current_setting('forms.previous_changes',true),''),'0')::bigint $$;
REVOKE ALL ON FUNCTION forms.changes() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION forms.changes() TO service_role;
CREATE OR REPLACE FUNCTION public.forms_gateway_batch(statements jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = forms, pg_catalog AS $$
DECLARE item jsonb; query text; rows jsonb; result jsonb := '[]'; previous_changes bigint := 0;
BEGIN
 IF jsonb_typeof(statements) <> 'array' OR jsonb_array_length(statements)>150 THEN RAISE EXCEPTION 'Invalid batch'; END IF;
 PERFORM pg_advisory_xact_lock(20472027);
 PERFORM set_config('forms.previous_changes','0',true);
 FOR item IN SELECT value FROM jsonb_array_elements(statements) LOOP
  query := item->>'sql';
  IF query ~* '^\s*SELECT\s' THEN
   EXECUTE 'SELECT COALESCE(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) FROM (' || query || ') t' INTO rows;
   previous_changes := 0;
  ELSIF query ~* '^\s*(INSERT|UPDATE|DELETE)\s' THEN
   EXECUTE 'WITH changed AS (' || query || ' RETURNING *) SELECT COALESCE(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) FROM changed t' INTO rows;
   previous_changes := jsonb_array_length(rows);
   rows := '[]';
  ELSE RAISE EXCEPTION 'Statement type not allowed'; END IF;
  PERFORM set_config('forms.previous_changes',previous_changes::text,true);
  result := result || jsonb_build_array(jsonb_build_object('success',true,'results',rows,'meta',jsonb_build_object('changes',previous_changes)));
 END LOOP;
 RETURN result;
END;
$$;
