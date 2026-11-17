import { spawnSync } from 'node:child_process';
const cli = './node_modules/wrangler/bin/wrangler.js';
for (const args of [
 ['d1','migrations','apply','biu-racing-forms','--local'],
 ['d1','execute','biu-racing-forms','--local','--command',"INSERT OR IGNORE INTO workspace(id,owner_subject,created_at) VALUES('2027','local:coordinator',datetime('now'));"],
]) { const result=spawnSync(process.execPath,[cli,...args],{stdio:'inherit'}); if(result.status!==0)process.exit(result.status||1); }
