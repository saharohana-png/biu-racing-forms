import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=new URL('../',import.meta.url);
const read=name=>readFileSync(new URL(name,root),'utf8');
const full=JSON.parse(read('data/systems.normalized.json'));
const overview=JSON.parse(read('data/systems.overview.json'));

test('overview keeps every system, navigation property, field ID and label without drift',()=>{
 assert.equal(overview.length,22);
 assert.deepEqual(overview.map(s=>s.id),full.map(s=>s.id));
 for(const system of overview){
  const original=full.find(s=>s.id===system.id);
  assert.deepEqual(Object.keys(system).sort(),['id','label','department','electricalDomain','interfaces','fields'].sort());
  for(const key of ['id','label','department','electricalDomain','interfaces'])assert.deepEqual(system[key],original[key],`${system.id}.${key}`);
  assert.deepEqual(system.fields,original.fields.map(({id,label})=>({id,label})),`${system.id} field navigation changed`);
 }
});

test('navigation catalog excludes prompts, columns, evidence and source registries',()=>{
 for(const system of overview)for(const field of system.fields)assert.deepEqual(Object.keys(field).sort(),['id','label']);
 assert(Buffer.byteLength(read('data/systems.overview.json'))<Buffer.byteLength(read('data/systems.normalized.json'))/5);
 const implementation=read('lib/overview-catalog.ts');
 assert.match(implementation,/systems\.overview\.json/);
 assert.doesNotMatch(implementation,/from\s+['"][^'"]*(?:\/catalog|systems\.normalized|coverage|examples|coordinator)/);
 assert.match(read('components/racing/system-map.tsx'),/import \{ systems \} from '@\/lib\/overview-catalog'/);
});

test('generator check is read-only and resolves data from its own location',()=>{
 const before=read('data/systems.overview.json');
 const result=spawnSync(process.execPath,[fileURLToPath(new URL('scripts/generate-overview-catalog.mjs',root)),'--check'],{cwd:'/tmp',encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 assert.match(result.stdout,/22 systems/);
 assert.equal(read('data/systems.overview.json'),before);
});
