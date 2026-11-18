import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Only non-secret resource identifiers are copied into the generated config. */
export function productionConfig(base, env) {
  const databaseId = env.FORMS_D1_DATABASE_ID?.trim();
  if (!databaseId || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(databaseId) || databaseId === '00000000-0000-4000-8000-000000000000') {
    throw new Error('Set FORMS_D1_DATABASE_ID to the real production D1 UUID.');
  }
  if (Object.hasOwn(base.vars ?? {}, 'LOCAL_DEV') || env.LOCAL_DEV) {
    throw new Error('LOCAL_DEV is forbidden in a production build.');
  }
  if (base.d1_databases?.length !== 1 || base.d1_databases[0].binding !== 'DB' || base.r2_buckets?.length !== 1 || base.r2_buckets[0].binding !== 'BUCKET') {
    throw new Error('Expected the DB and BUCKET bindings. Review production configuration.');
  }
  const config = structuredClone(base);
  config.d1_databases[0].database_id = databaseId;
  const bucket = env.FORMS_R2_BUCKET_NAME?.trim();
  if (bucket) {
    if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error('Invalid FORMS_R2_BUCKET_NAME.');
    config.r2_buckets[0].bucket_name = bucket;
  }
  if (env.CLOUDFLARE_ACCOUNT_ID) {
    if (!/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID)) throw new Error('Invalid CLOUDFLARE_ACCOUNT_ID.');
    config.account_id = env.CLOUDFLARE_ACCOUNT_ID;
  }
  return config;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  try {
    const config = productionConfig(JSON.parse(readFileSync(resolve(root, 'wrangler.jsonc'), 'utf8')), process.env);
    writeFileSync(resolve(root, 'wrangler.production.jsonc'), JSON.stringify(config, null, 2) + '\n');
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const result = spawnSync(npm, ['run', 'build'], {
      cwd: root,
      env: { ...process.env, FORMS_WRANGLER_CONFIG: './wrangler.production.jsonc' },
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
