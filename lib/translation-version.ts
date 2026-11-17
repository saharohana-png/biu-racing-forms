export const TRANSLATION_VERSION = 'he-en-local-v2';

/** Added to the same D1 batch as the immutable source revision. */
export function translationQueueStatement(db:D1Database, systemId:string, mutationKey:string) {
  return db.prepare(`INSERT OR IGNORE INTO translation_jobs
    (id,system_id,source_revision,source_hash,prompt_version,status,created_at,updated_at)
    SELECT system_id || ':' || revision || ':' || ?,system_id,revision,content_hash,?,'queued',created_at,created_at
    FROM revisions WHERE system_id=? AND mutation_key=?`).bind(TRANSLATION_VERSION,TRANSLATION_VERSION,systemId,mutationKey);
}
