import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const metadata=JSON.parse(await readFile('data/template-metadata.json','utf8'));
const manifest=JSON.parse(await readFile('data/source-manifest.json','utf8'));
const output={...metadata};
for(const kind of ['esf','ases','ses']) {
 const template=metadata[kind];
 const source=manifest.sources.find(s=>s.sha256===template.sha256);
 if(!source)throw Error('No pinned official source: '+kind);
 const response=await fetch(source.url,{signal:AbortSignal.timeout(90000)});
 if(!response.ok)throw Error('Official template unavailable: '+kind+' ('+response.status+')');
 const bytes=Buffer.from(await response.arrayBuffer());
 if(createHash('sha256').update(bytes).digest('hex')!==template.sha256)throw Error('Official template changed: '+kind+'. Review the new template before updating the mapping.');
 output[kind]={...template,base64:bytes.toString('base64')};
 console.log('Verified official template:',kind,bytes.length,'bytes');
}
await mkdir('private-data',{recursive:true});
await writeFile('private-data/official-workbook-templates.json',JSON.stringify(output));
try{await access('private-data/example-images.json')}catch{await writeFile('private-data/example-images.json','{}\n')}
