import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const workspace = sqliteTable('workspace', {
  id: text('id').primaryKey(), ownerSubject: text('owner_subject').notNull(), createdAt: text('created_at').notNull(),
});
export const memberships = sqliteTable('memberships', {
  subject: text('subject').primaryKey(), role: text('role').notNull(), systemIds: text('system_ids').notNull(), active: integer('active').notNull().default(1), createdAt: text('created_at').notNull(), authSource: text('auth_source').notNull().default('manual'),
});
export const emailEntrySessions = sqliteTable('email_entry_sessions', {
  tokenHash: text('token_hash').primaryKey(), subject: text('subject').notNull(), expiresAt: integer('expires_at').notNull(), createdAt: text('created_at').notNull(), revokedAt: text('revoked_at'),
});
export const submissions = sqliteTable('submissions', {
  id: text('id').primaryKey(), revision: integer('revision').notNull().default(0), answers: text('answers').notNull().default('{}'), status: text('status').notNull().default('draft'), review: text('review').notNull().default('{}'), updatedAt: text('updated_at').notNull(), lastMutation: text('last_mutation'),
});
export const revisions = sqliteTable('revisions', {
  id: text('id').primaryKey(), systemId: text('system_id').notNull(), revision: integer('revision').notNull(), answers: text('answers').notNull(), status: text('status').notNull(), review: text('review').notNull(), schemaVersion: text('schema_version').notNull(), contentHash: text('content_hash').notNull(), actor: text('actor').notNull(), createdAt: text('created_at').notNull(), mutationKey: text('mutation_key').notNull(),
}, (t) => [uniqueIndex('revision_system_version').on(t.systemId,t.revision), uniqueIndex('revision_mutation').on(t.mutationKey)]);
export const mutations = sqliteTable('mutations', {
  id: text('id').primaryKey(), systemId: text('system_id').notNull(), payloadHash: text('payload_hash').notNull(), revision: integer('revision').notNull(), createdAt: text('created_at').notNull(),
});
export const attachments = sqliteTable('attachments', {
  id: text('id').primaryKey(), systemId: text('system_id').notNull(), fieldId: text('field_id').notNull(), originalName: text('original_name').notNull(), safeName: text('safe_name').notNull(), mime: text('mime').notNull(), size: integer('size').notNull(), sha256: text('sha256'), storageKey: text('storage_key').notNull(), state: text('state').notNull(), replacesId: text('replaces_id'), version: integer('version').notNull().default(1), actor: text('actor').notNull(), createdAt: text('created_at').notNull(), mutationKey: text('mutation_key').notNull(),
}, (t)=>[uniqueIndex('attachment_mutation').on(t.mutationKey)]);
export const reviewEvents = sqliteTable('review_events', {
  id:text('id').primaryKey(), systemId:text('system_id').notNull(), revision:integer('revision').notNull(), action:text('action').notNull(), reason:text('reason').notNull(), fieldIds:text('field_ids').notNull(), actor:text('actor').notNull(), role:text('role').notNull(), createdAt:text('created_at').notNull(),
});
export const auditEvents = sqliteTable('audit_events', {
  id:text('id').primaryKey(), systemId:text('system_id'), action:text('action').notNull(), revision:integer('revision'), actor:text('actor').notNull(), createdAt:text('created_at').notNull(),
});
export const invites = sqliteTable('invites', {
  id:text('id').primaryKey(), tokenHash:text('token_hash').notNull(), role:text('role').notNull(), systemIds:text('system_ids').notNull(), expiresAt:text('expires_at').notNull(), usedBy:text('used_by'), createdAt:text('created_at').notNull(),
});
export const sharedRecords = sqliteTable('shared_records', {
  id:text('id').primaryKey(), label:text('label').notNull(), systemIds:text('system_ids').notNull(), value:text('value').notNull(), unit:text('unit').notNull(), source:text('source').notNull(), revision:integer('revision').notNull().default(1), updatedAt:text('updated_at').notNull(),
});
export const sharedProposals = sqliteTable('shared_proposals', {
  id:text('id').primaryKey(), recordId:text('record_id').notNull(), value:text('value').notNull(), unit:text('unit').notNull(), source:text('source').notNull(), baseRevision:integer('base_revision').notNull(), status:text('status').notNull().default('pending'), actor:text('actor').notNull(), createdAt:text('created_at').notNull(),
});
export const sharedRevisions = sqliteTable('shared_revisions', {
  id:text('id').primaryKey(), recordId:text('record_id').notNull(), revision:integer('revision').notNull(), value:text('value').notNull(), unit:text('unit').notNull(), source:text('source').notNull(), createdAt:text('created_at').notNull(),
},(t)=>[uniqueIndex('shared_record_revision').on(t.recordId,t.revision)]);

export const translationJobs = sqliteTable('translation_jobs', {
  id:text('id').primaryKey(),systemId:text('system_id').notNull(),sourceRevision:integer('source_revision').notNull(),sourceHash:text('source_hash').notNull(),promptVersion:text('prompt_version').notNull(),status:text('status').notNull().default('queued'),model:text('model').notNull().default(''),leaseToken:text('lease_token'),leaseUntil:integer('lease_until').notNull().default(0),attempts:integer('attempts').notNull().default(0),errorCode:text('error_code'),retryAt:integer('retry_at').notNull().default(0),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[uniqueIndex('translation_source_version').on(t.systemId,t.sourceRevision,t.promptVersion)]);
export const translationCache = sqliteTable('translation_cache', {
  inputHash:text('input_hash').primaryKey(),translatedText:text('translated_text').notNull(),model:text('model').notNull(),promptVersion:text('prompt_version').notNull(),createdAt:text('created_at').notNull(),
});
