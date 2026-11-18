import test from 'node:test';
import assert from 'node:assert/strict';
import { productionConfig } from '../scripts/build-production.mjs';
const base = {
  name: 'test-site',
  d1_databases: [{ binding: 'DB', database_name: 'test-db', database_id: '00000000-0000-4000-8000-000000000000' }],
  r2_buckets: [{ binding: 'BUCKET', bucket_name: 'test-files' }],
};
const env = { FORMS_D1_DATABASE_ID: '12345678-1234-4321-abcd-123456789abc' };
test('production refuses an absent, invalid or placeholder database', () => {
  for (const id of [undefined, '', 'wrong', base.d1_databases[0].database_id]) {
    assert.throws(() => productionConfig(base, { FORMS_D1_DATABASE_ID: id }), /D1 UUID/);
  }
});
test('production refuses development authentication bypass and changed bindings', () => {
  assert.throws(() => productionConfig(base, { ...env, LOCAL_DEV: 'true' }), /LOCAL_DEV/);
  assert.throws(() => productionConfig({ ...base, vars: { LOCAL_DEV: 'false' } }, env), /LOCAL_DEV/);
  assert.throws(() => productionConfig({ ...base, d1_databases: [] }, env), /bindings/);
});
test('production preserves the local template and never copies credentials into config', () => {
  const original = structuredClone(base);
  const config = productionConfig(base, { ...env, CLOUDFLARE_API_TOKEN: 'test-secret', FORMS_R2_BUCKET_NAME: 'production-files' });
  assert.equal(config.d1_databases[0].database_id, env.FORMS_D1_DATABASE_ID);
  assert.equal(config.r2_buckets[0].bucket_name, 'production-files');
  assert.deepEqual(base, original);
  assert.ok(!JSON.stringify(config).includes('test-secret'));
  assert.throws(() => productionConfig(base, { ...env, CLOUDFLARE_ACCOUNT_ID: 'bad' }), /ACCOUNT_ID/);
  assert.throws(() => productionConfig(base, { ...env, FORMS_R2_BUCKET_NAME: '../bad' }), /BUCKET_NAME/);
});
