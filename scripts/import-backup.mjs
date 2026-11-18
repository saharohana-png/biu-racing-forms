/** Run locally with private .env.local. Never commit the backup or server keys. */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {unzipSync,strFromU8} from 'fflate';
const archive=process.argv[2];
if(!archive)throw Error('Usage: node --env-file=.env.local scripts/import-backup.mjs /private/backup.zip');
const url=process.env.FORMS_GATEWAY_URL,key=process.env.FORMS_GATEWAY_KEY;
if(!url||!key)throw Error('Private server configuration required');
const digest=x=>createHash('sha256').update(x).digest('hex');
const quote=x=>x===null||x===undefined?'NULL':typeof x==='number'?String(x):"'"+String(x).replaceAll("'","''")+"'";
async function gateway(path,options={}){
 const r=await fetch(url+path,{...options,headers:{...options.headers,'x-forms-key':key},signal:AbortSignal.timeout(90000)});
 if(!r.ok)throw Error('Cloud request failed '+r.status+': '+await r.text());return r;
}
async function sql(statements){return (await gateway('/database',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({statements:statements.map(sql=>({sql}))})})).json();}
function insert(table,row){return `INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.values(row).map(quote).join(',')})`;}
const bytes=await readFile(archive),files=unzipSync(bytes),json=name=>JSON.parse(strFromU8(files[name]));
const manifest=json('manifest.json');
for(const item of manifest.files){const data=files[item.path];if(!data||data.length!==item.size||digest(data)!==item.sha256)throw Error('Backup integrity failed: '+item.path);}
const existing=await sql(['SELECT COUNT(*) AS count FROM submissions']);
if(Number(existing[0].results[0].count)!==0)throw Error('Destination has data. Refusing to overwrite it.');
const snapshot=json('answers.json'),attachments=json('attachments.json'),history=json('history-index.json');
if(json('shared-records-and-conflicts.json').records?.length)throw Error('Shared records require an explicit compatible mapping before import.');
const statements=[];
for(const file of attachments){
 const data=files[file.archivePath];if(!data||data.length!==file.size||digest(data)!==file.sha256)throw Error('Evidence integrity failed: '+file.id);
 const storageKey=`files/${file.systemId}/${file.id}`;
 await gateway('/object?key='+encodeURIComponent(storageKey),{method:'PUT',body:data,headers:{'content-type':file.mime}});
 const stored=await gateway('/object?key='+encodeURIComponent(storageKey));if(digest(new Uint8Array(await stored.arrayBuffer()))!==file.sha256)throw Error('Cloud evidence mismatch');
 statements.push(insert('attachments',{id:file.id,system_id:file.systemId,field_id:file.fieldId,original_name:file.originalName,safe_name:file.safeName,mime:file.mime,size:file.size,sha256:file.sha256,storage_key:storageKey,state:file.state,replaces_id:file.replacesId,version:file.version,actor:'import:legacy-backup',created_at:file.createdAt,mutation_key:'legacy-file:'+file.id}));
}
for(const system of snapshot.systems){
 statements.push(insert('submissions',{id:system.id,revision:system.revision,answers:JSON.stringify(system.answers),status:system.status,review:JSON.stringify(system.review??{}),updated_at:system.updatedAt??snapshot.createdAt,last_mutation:null}));
}
let revisions=0;
for(const system of history)for(const revision of system.revisions){
 const saved=json(`history/${system.id}/${revision.revision}.json`);
 statements.push(insert('revisions',{id:system.id+':'+saved.revision,system_id:system.id,revision:saved.revision,answers:JSON.stringify(saved.answers),status:saved.status,review:JSON.stringify(saved.review??{}),schema_version:saved.schemaVersion,content_hash:saved.contentHash,actor:'import:legacy-backup',created_at:saved.createdAt,mutation_key:'legacy-revision:'+system.id+':'+saved.revision}));revisions++;
}

// A single transaction preserves the complete snapshot, including every revision and file reference.
await sql(statements);
const imported=await sql(['SELECT id,answers,revision,status,review FROM submissions ORDER BY id']);
const stable=value=>JSON.stringify(value&&typeof value==='object'?Array.isArray(value)?value.map(x=>JSON.parse(stable(x))):Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,JSON.parse(stable(v))])):value);
for(const original of snapshot.systems){const current=imported[0].results.find(row=>row.id===original.id);if(!current||current.revision!==original.revision||stable(JSON.parse(current.answers))!==stable(original.answers)||stable(JSON.parse(current.review))!==stable(original.review??{}))throw Error('Post-import verification failed: '+original.id);}
const report={archiveSha256:digest(bytes),systems:snapshot.systems.length,attachments:attachments.length,revisions,verifiedAt:new Date().toISOString(),verifiedOriginalAnswers:true,verifiedEvidenceBytes:true};
console.log(JSON.stringify(report,null,2));
if(process.argv[3])await writeFile(process.argv[3],JSON.stringify(report,null,2)+'\n');
