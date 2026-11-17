#!/usr/bin/env node
/** Regenerate after any normalized system/field label change; --check never writes. */
import { readFileSync, writeFileSync } from 'node:fs';

const sourceUrl=new URL('../data/systems.normalized.json',import.meta.url);
const outputUrl=new URL('../data/systems.overview.json',import.meta.url);
const source=JSON.parse(readFileSync(sourceUrl,'utf8'));
const overview=source.map(({id,label,department,electricalDomain,interfaces,fields})=>({
 id,label,department,electricalDomain,interfaces,
 fields:fields.map(({id,label})=>({id,label})),
}));
const serialized=JSON.stringify(overview,null,2)+'\n';
if(process.argv.includes('--check')){
 let saved='';try{saved=readFileSync(outputUrl,'utf8');}catch{}
 if(saved!==serialized){
  console.error('Overview catalog is missing or stale. Run node scripts/generate-overview-catalog.mjs.');
  process.exitCode=1;
 }else console.log(`Overview catalog is current (${overview.length} systems).`);
}else{
 writeFileSync(outputUrl,serialized);
 console.log(`Generated overview catalog: ${overview.length} systems, ${Buffer.byteLength(serialized)} bytes.`);
}
