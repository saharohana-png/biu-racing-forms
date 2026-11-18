create schema if not exists forms;
set search_path = forms, pg_catalog;
CREATE TABLE "attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"system_id" text NOT NULL,
	"field_id" text NOT NULL,
	"original_name" text NOT NULL,
	"safe_name" text NOT NULL,
	"mime" text NOT NULL,
	"size" bigint NOT NULL,
	"sha256" text,
	"storage_key" text NOT NULL,
	"state" text NOT NULL,
	"replaces_id" text,
	"version" bigint DEFAULT 1 NOT NULL,
	"actor" text NOT NULL,
	"created_at" text NOT NULL,
	"mutation_key" text NOT NULL
);

CREATE UNIQUE INDEX "attachment_mutation" ON "attachments" ("mutation_key");
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"system_id" text,
	"action" text NOT NULL,
	"revision" bigint,
	"actor" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE "invites" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"role" text NOT NULL,
	"system_ids" text NOT NULL,
	"expires_at" text NOT NULL,
	"used_by" text,
	"created_at" text NOT NULL
);

CREATE TABLE "memberships" (
	"subject" text PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"system_ids" text NOT NULL,
	"active" bigint DEFAULT 1 NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE "mutations" (
	"id" text PRIMARY KEY NOT NULL,
	"system_id" text NOT NULL,
	"payload_hash" text NOT NULL,
	"revision" bigint NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE "review_events" (
	"id" text PRIMARY KEY NOT NULL,
	"system_id" text NOT NULL,
	"revision" bigint NOT NULL,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"field_ids" text NOT NULL,
	"actor" text NOT NULL,
	"role" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE "revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"system_id" text NOT NULL,
	"revision" bigint NOT NULL,
	"answers" text NOT NULL,
	"status" text NOT NULL,
	"review" text NOT NULL,
	"schema_version" text NOT NULL,
	"content_hash" text NOT NULL,
	"actor" text NOT NULL,
	"created_at" text NOT NULL,
	"mutation_key" text NOT NULL
);

CREATE UNIQUE INDEX "revision_system_version" ON "revisions" ("system_id","revision");
CREATE UNIQUE INDEX "revision_mutation" ON "revisions" ("mutation_key");
CREATE TABLE "shared_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"record_id" text NOT NULL,
	"value" text NOT NULL,
	"unit" text NOT NULL,
	"source" text NOT NULL,
	"base_revision" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"actor" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE "shared_records" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"system_ids" text NOT NULL,
	"value" text NOT NULL,
	"unit" text NOT NULL,
	"source" text NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "shared_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"record_id" text NOT NULL,
	"revision" bigint NOT NULL,
	"value" text NOT NULL,
	"unit" text NOT NULL,
	"source" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE UNIQUE INDEX "shared_record_revision" ON "shared_revisions" ("record_id","revision");
CREATE TABLE "submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"answers" text DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"review" text DEFAULT '{}' NOT NULL,
	"updated_at" text NOT NULL,
	"last_mutation" text
);

CREATE TABLE "workspace" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_subject" text NOT NULL,
	"created_at" text NOT NULL
);

ALTER TABLE "memberships" ADD "auth_source" text DEFAULT 'manual' NOT NULL;
CREATE TABLE "translation_cache" (
	"input_hash" text PRIMARY KEY NOT NULL,
	"translated_text" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE "translation_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"system_id" text NOT NULL,
	"source_revision" bigint NOT NULL,
	"source_hash" text NOT NULL,
	"prompt_version" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"lease_token" text,
	"lease_until" bigint DEFAULT 0 NOT NULL,
	"attempts" bigint DEFAULT 0 NOT NULL,
	"error_code" text,
	"retry_at" bigint DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE UNIQUE INDEX "translation_source_version" ON "translation_jobs" ("system_id","source_revision","prompt_version");
CREATE TABLE "email_entry_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"created_at" text NOT NULL,
	"revoked_at" text
);

ALTER TABLE forms.attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE forms.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE forms.invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE forms.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE forms.mutations ENABLE ROW LEVEL SECURITY;
ALTER TABLE forms.review_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE forms.revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE forms.shared_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE forms.shared_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE forms.shared_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE forms.submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE forms.workspace ENABLE ROW LEVEL SECURITY;
ALTER TABLE forms.translation_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE forms.translation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE forms.email_entry_sessions ENABLE ROW LEVEL SECURITY;
RESET search_path;
REVOKE ALL ON SCHEMA forms FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA forms FROM PUBLIC, anon, authenticated;
CREATE TABLE forms.gateway_key (id boolean primary key default true check(id), digest text not null);
ALTER TABLE forms.gateway_key ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.forms_gateway_authorize(key_hash text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
SELECT EXISTS(SELECT 1 FROM forms.gateway_key WHERE digest = key_hash);
$$;
REVOKE ALL ON FUNCTION public.forms_gateway_authorize(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.forms_gateway_authorize(text) TO service_role;
CREATE OR REPLACE FUNCTION public.forms_gateway_batch(statements jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = forms, pg_catalog AS $$
DECLARE item jsonb; query text; rows jsonb; result jsonb := '[]'; previous_changes bigint := 0;
BEGIN
 IF jsonb_typeof(statements) <> 'array' OR jsonb_array_length(statements)>150 THEN RAISE EXCEPTION 'Invalid batch'; END IF;
 PERFORM pg_advisory_xact_lock(20472027);
 FOR item IN SELECT value FROM jsonb_array_elements(statements) LOOP
  query := replace(item->>'sql','changes()',previous_changes::text);
  IF query ~* '^\s*SELECT\s' THEN
   EXECUTE 'SELECT COALESCE(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) FROM (' || query || ') t' INTO rows;
   previous_changes := 0;
  ELSIF query ~* '^\s*(INSERT|UPDATE|DELETE)\s' THEN
   EXECUTE 'WITH changed AS (' || query || ' RETURNING *) SELECT COALESCE(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) FROM changed t' INTO rows;
   previous_changes := jsonb_array_length(rows);
   rows := '[]';
  ELSE RAISE EXCEPTION 'Statement type not allowed'; END IF;
  result := result || jsonb_build_array(jsonb_build_object('success',true,'results',rows,'meta',jsonb_build_object('changes',previous_changes)));
 END LOOP;
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.forms_gateway_batch(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.forms_gateway_batch(jsonb) TO service_role;
INSERT INTO storage.buckets(id,name,public,file_size_limit) VALUES('evidence','evidence',false,26214400) ON CONFLICT(id) DO NOTHING;
