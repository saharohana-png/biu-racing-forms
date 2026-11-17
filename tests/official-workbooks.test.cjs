const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const crypto = require('node:crypto');
const esbuild = require('esbuild');
const { unzipSync, strFromU8 } = require('fflate');
const built = esbuild.buildSync({entryPoints:['lib/official-workbooks.ts'],bundle:true,platform:'node',format:'cjs',target:'node22',write:false,logLevel:'silent'});
const mod = new Module(path.resolve('lib/official-workbooks-test.cjs'),module); mod.filename=path.resolve('lib/official-workbooks-test.cjs');mod.paths=module.paths;mod._compile(built.outputFiles[0].text,mod.filename);
const {buildOfficialWorkbook,getOfficialWorkbookSheet}=mod.exports;
const coverage=JSON.parse(fs.readFileSync('data/coverage.normalized.json','utf8')).entries;
const systems=JSON.parse(fs.readFileSync('data/systems.normalized.json','utf8'));
const queue=JSON.parse(fs.readFileSync('data/coordinator.normalized.json','utf8'));
const templates=JSON.parse(fs.readFileSync('private-data/official-workbook-templates.json','utf8'));
const fields=id=>id==='COORDINATOR'?queue:systems.find(s=>s.id===id).fields;
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}':JSON.stringify(value)??'null';
const hash=value=>crypto.createHash('sha256').update(typeof value==='string'?value:Buffer.from(value)).digest('hex');
const snapshot=(id,answers={},revision=7)=>({id,answers,revision,status:'draft',attachments:[],progress:{complete:0,total:0,percent:0},updatedAt:'2026-10-31T00:00:00Z',review:{fields:{}},schemaVersion:'test'});
const translation=(s,answers=s.answers)=>({systemId:s.id,sourceRevision:s.revision,sourceHash:hash(canonical(s.answers)),isCurrent:true,englishAnswers:answers,fieldStates:Object.fromEntries(Object.keys(answers).map(id=>[id,'ready']))});
const original=k=>unzipSync(Buffer.from(templates[k].base64,'base64'));
const workbookCache={};
const blank=async kind=>workbookCache[kind]??(workbookCache[kind]=await buildOfficialWorkbook({kind,snapshots:[],generatedAt:'2026-10-31T00:00:00Z'}));
const entry=id=>coverage.find(e=>e.id===id);
const entryField=e=>fields(e.systemId??'COORDINATOR').find(f=>f.id===e.fieldId);
const input=e=>({systemId:e.systemId??'COORDINATOR',fieldId:e.fieldId});
const reportEntry=(w,id)=>w.report.fields.find(f=>f.controlId===id);
const partCache=new WeakMap();
const cell=(w,e,ref=e.official.ranges[0])=>{if(!partCache.has(w))partCache.set(w,unzipSync(w.bytes));const p=templates[w.report.kind].sheets.find(s=>s.name===e.official.sheet).path;return new RegExp('<c\\b[^>]*r="'+ref+'"[^>]*?(?:/>|>[\\s\\S]*?</c>)').exec(strFromU8(partCache.get(w)[p]))?.[0]??'';};
const buildAnswer=async (e,value,status='answered',translated=value,options={})=>{const i=input(e),s=snapshot(i.systemId,{[i.fieldId]:{status,value,sourceReview:'pending'}});return buildOfficialWorkbook({kind:e.official.document.toLowerCase(),snapshots:[s],translations: options.noTranslation?[]:[{...translation(s,{[i.fieldId]:{...s.answers[i.fieldId],value:translated}}),...options.translation}]});};

test('both original template checksums, complete mappings and every unmodified OOXML part are preserved',async()=>{
 for(const [kind,count] of [['esf',272],['ases',453]]){
  const t=templates[kind];assert.equal(hash(Buffer.from(t.base64,'base64')),t.sha256);
  const w=await blank(kind),after=unzipSync(w.bytes),before=original(kind);
  assert.equal(w.report.fields.length,count);assert.equal(w.report.workingSeason,2027);assert.equal(w.report.readyForSubmission,false);assert.equal(w.report.template.submission2027Verified,false);
  assert.deepEqual(Object.keys(after).sort(),Object.keys(before).sort());
  assert.equal(w.report.writtenCells.length,0);assert.equal(w.report.fields.filter(f=>f.status==='restricted').length,kind==='ases'?4:0);
  for(const p of Object.keys(before)){
   if(!w.report.changedParts.includes(p))assert.deepEqual(Buffer.from(after[p]),Buffer.from(before[p]),p);
   if(p.match(/^xl\/worksheets\/sheet\d+\.xml$/)){
    const a=strFromU8(after[p]),b=strFromU8(before[p]);
    for(const tag of ['f','mergeCells','dataValidations','sheetProtection','drawing','cols']){
     const re=new RegExp('<'+tag+'\\b[^>]*(?:/>|>[\\s\\S]*?</'+tag+'>)','g');assert.deepEqual(a.match(re),b.match(re),kind+' '+p+' '+tag);
    }
    const attrs=x=>[...x.matchAll(/<c\b([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g)].map(m=>m[1].replace(/\s+t="[^"]*"/g,'').replace(/\s*\/$/,''));assert.deepEqual(attrs(a),attrs(b));
   }
  }
  assert.match(strFromU8(after['xl/workbook.xml']),/fullCalcOnLoad="1"/);
  if(kind==='ases')assert.deepEqual(after['xl/vbaProject.bin'],before['xl/vbaProject.bin']);
 }
});

test('blank input defaults are cleared while formula and locked defaults remain identifiable',async()=>{
 const esf=await blank('esf'),ases=await blank('ases');
 assert.ok(esf.report.clearedTemplateValues.length);assert.ok(ases.report.clearedTemplateValues.length>200);
 for(const w of [esf,ases])for(const c of w.report.clearedTemplateValues){const e=w.report.fields.find(f=>f.controlId===c.controlId);assert.doesNotMatch(cell(w,{official:{sheet:e.sheet,ranges:[c.cell]}},c.cell),/<(?:v|is)\b/);}
 const locked=ases.report.preservedTemplateValues.find(c=>c.cell==='M28');assert.ok(locked);
 const formula=entry('LC-ESF-S04-O21');if(formula)assert.match(cell(esf,formula),/<f\b/);
});

test('numeric values stay typed and units, paragraphs, unknown/NA and stale template defaults cannot become final values',async()=>{
 const e=coverage.find(e=>e.inputSchema.type==='number_with_unit_and_source'&&!e.columnId&&!e.privateContact&&e.official.ranges.length===1&&!e.official.ranges[0].includes(':')&&!e.inputSchema.manual_review_before_source_export&&!entryField(e)?.needsClarification);
 assert.ok(e);
 const w=await buildAnswer(e,'20');assert.equal(reportEntry(w,e.id).status,'written');assert.match(cell(w,e),/<v>20<\/v>/);assert.equal(w.report.writtenCells[0].type,'number');assert.equal(reportEntry(w,e.id).sourceReviewPending,true);
 for(const value of ['20 Ah','20; calculated','1,2','=1+1','Infinity','1234567890123456']){const bad=await buildAnswer(e,value);assert.equal(reportEntry(bad,e.id).status,'invalid_value',value);assert.equal(bad.report.writtenCells.length,0);}
 for(const [status,expected] of [['unknown','unknown'],['na','not_applicable']]){const unknown=await buildAnswer(e,'20',status);assert.equal(reportEntry(unknown,e.id).status,expected);assert.equal(unknown.report.writtenCells.length,0);}
});

test('selects require original workbook literals and never invent Yes from a paragraph',async()=>{
 const e=coverage.find(e=>e.inputSchema.type==='select'&&!e.columnId&&!e.privateContact&&!e.inputSchema.manual_review_before_source_export&&!entryField(e)?.needsClarification&&e.inputSchema.source_literal_options?.length&&e.official.ranges.length===1&&!e.official.ranges[0].includes(':'));
 const literal=e.inputSchema.source_literal_options[0].source_value;assert.equal(reportEntry(await buildAnswer(e,literal),e.id).status,'written');
 assert.equal(reportEntry(await buildAnswer(e,'Yes, the team plans to test this'),e.id).status,'invalid_value');
});

test('free text requires an exact current ready translation, and Excel injection remains a string',async()=>{
 const e=coverage.find(e=>e.inputSchema.type==='text_with_source'&&!e.columnId&&!e.privateContact&&!e.inputSchema.manual_review_before_source_export&&!entryField(e)?.needsClarification&&e.official.ranges.length===1&&!e.official.ranges[0].includes(':'));
 assert.ok(e);
 for(const patch of [{sourceRevision:6},{sourceHash:'other'},{isCurrent:false}])assert.equal(reportEntry(await buildAnswer(e,'טקסט','answered','Text',{translation:patch}),e.id).status,'source_conflict');
 assert.equal(reportEntry(await buildAnswer(e,'טקסט','answered','Text',{noTranslation:true}),e.id).status,'translation_pending');
 assert.equal(reportEntry(await buildAnswer(e,'טקסט','answered','Text',{translation:{fieldStates:{[e.fieldId]:'failed'}}}),e.id).status,'translation_failed');
 const w=await buildAnswer(e,'טקסט','answered','=HYPERLINK("https://example.com","<script>&")');assert.equal(reportEntry(w,e.id).status,'written');assert.match(cell(w,e),/t="inlineStr"/);assert.doesNotMatch(cell(w,e),/<f\b/);assert.match(cell(w,e),/&lt;script&gt;&amp;/);
 assert.equal(reportEntry(await buildAnswer(e,'טקסט','answered','עברית שנשארה'),e.id).status,'invalid_value');
});

test('ordinary repeated columns use real slots and row IDs; overflow and incompatible translation rows stay blank',async()=>{
 const e=coverage.find(e=>e.columnId&&e.official.document==='ESF'&&e.official.ranges.length>1&&e.inputSchema.type==='repeating_table_column'&&entryField(e)?.recordKeys?.length===1&&!entryField(e)?.needsClarification&&entryField(e)?.columns.find(c=>c.id===e.columnId)?.sourceInputSchema?.type==='repeating_table_column');
 assert.ok(e);
 const rows=[{_id:'a',[e.columnId]:'מקור ראשון'},{_id:'b',[e.columnId]:'מקור שני'}],english=[{_id:'a',[e.columnId]:'First'},{_id:'b',[e.columnId]:'Second'}];
 const w=await buildAnswer(e,rows,'answered',english);assert.equal(reportEntry(w,e.id).status,'written');assert.deepEqual(reportEntry(w,e.id).rowIds,['a','b']);assert.equal(reportEntry(w,e.id).writtenCells.length,2);
 const bad=await buildAnswer(e,rows,'answered',[english[1],english[0]]);assert.equal(reportEntry(bad,e.id).status,'source_conflict');
 const overflow=Array.from({length:40},(_,i)=>({_id:String(i),[e.columnId]:'Value'}));assert.equal(reportEntry(await buildAnswer(e,overflow),e.id).status,'overflow');
});

test('ASES distributed materials columns map row ordinal to exact sourceRecordKey slots',async()=>{
 const e=coverage.find(e=>e.columnId&&e.official.document==='ASES'&&entryField(e)?.recordKeys?.length===8&&entryField(e)?.columns.find(c=>c.id===e.columnId)?.sourceInputSchema?.type==='text_with_source'&&!e.inputSchema.manual_review_before_source_export&&!entryField(e)?.needsClarification);
 assert.ok(e);
 const f=entryField(e),rows=Array.from({length:8},(_,i)=>({_id:'material-'+i,[e.columnId]:'Material '+i}));
 const w=await buildAnswer(e,rows);const mapped=coverage.filter(c=>c.fieldId===e.fieldId&&c.columnId===e.columnId);
 assert.equal(mapped.length,8);
 for(const c of mapped){const slot=f.recordKeys.indexOf(c.sourceRecordKey);assert.equal(reportEntry(w,c.id).status,'written',c.id);assert.equal(w.report.writtenCells.find(v=>v.controlId===c.id).value,'Material '+slot);}
 const overflow=await buildAnswer(e,[...rows,{_id:'extra',[e.columnId]:'Extra'}]);for(const c of mapped)assert.equal(reportEntry(overflow,c.id).status,'overflow');
});

test('ambiguous scalar repeating ranges, files and manually flagged mappings never write guesses',async()=>{
 const repeated=coverage.find(e=>!e.columnId&&e.inputSchema.type==='repeating_table_column'&&!e.privateContact);assert.ok(repeated);
 assert.equal(reportEntry(await buildAnswer(repeated,'1,2,3'),repeated.id).status,'manual_mapping');
 const evidence=coverage.find(e=>e.inputSchema.type==='file_upload_with_caption'&&!e.columnId&&!e.privateContact);assert.ok(evidence);
 assert.equal(reportEntry(await buildAnswer(evidence,'attachment-uuid'),evidence.id).status,'evidence_required');
 const manual=coverage.find(e=>e.inputSchema.manual_review_before_source_export&&!e.privateContact&&e.fieldId&&!e.columnId);assert.ok(manual);
 assert.equal(reportEntry(await buildAnswer(manual,'value'),manual.id).status,'manual_mapping');
});

test('snapshots are never mutated and partial access never fills another system',async()=>{
 const e=coverage.find(e=>e.systemId==='TSAL'&&!e.columnId),s=snapshot('TSAL',{[e.fieldId]:{status:'answered',value:'source'}}),before=JSON.stringify(s);
 const w=await buildOfficialWorkbook({kind:'esf',snapshots:[s],translations:[translation(s)]});assert.equal(JSON.stringify(s),before);assert.ok(w.report.fields.filter(f=>f.systemId&&f.systemId!=='TSAL').every(f=>f.status==='out_of_scope'));assert.deepEqual(w.report.sourceSnapshots.map(s=>s.systemId),['TSAL']);
 await assert.rejects(()=>buildOfficialWorkbook({kind:'esf',snapshots:[s,s]}),/duplicate/);
});

test('all 36 previews preserve real styles, merged ranges and dimensions while hiding formula caches',async()=>{
 let imageCount=0,formulaCount=0;
 for(const kind of ['esf','ases']){const w=await blank(kind);for(const sheet of w.sheets){
  const preview=await getOfficialWorkbookSheet({workbook:w,sheet:sheet.name});
  assert.equal(preview.name,sheet.name);assert.ok(preview.rows.length===preview.rowCount);assert.ok(preview.columns.length===preview.columnCount);assert.ok(Object.keys(preview.styles).length>0);
  for(const c of preview.cells){assert.ok(c.row<=preview.rowCount&&c.column<=preview.columnCount);if(c.formula){formulaCount++;assert.equal(c.text,'');assert.equal(c.rawValue,'');}}
  for(const merge of preview.merges){const anchor=preview.cells.find(c=>c.row===merge.row&&c.column===merge.column);if(anchor){assert.equal(anchor.rowSpan,merge.rowSpan);assert.equal(anchor.colSpan,merge.colSpan);}}
  for(const image of preview.images){imageCount++;assert.match(image.dataUrl,/^data:image\/png;base64,/);assert.ok(image.width>0&&image.height>0);assert.equal(image.source,'template');}
 }}
 assert.equal(imageCount,5);assert.equal(formulaCount,1234);
 await assert.rejects(()=>getOfficialWorkbookSheet({workbook:workbookCache.esf,sheet:'missing'}),/Unknown worksheet/);
});

test('audited BIU project identity fills only exact metadata cells, preserves saved answers and template edition',async()=>{
 const esf=await blank('esf'),ases=await blank('ases');
 assert.deepEqual(esf.report.projectMetadata.map(m=>[m.sheet,m.cell,m.value,m.lockedCellOverride]),[['Overview','L11','BIU Racing',false],['Overview','L12','Bar-Ilan University',false],['Overview','L13','2027',true]]);
 assert.deepEqual(ases.report.projectMetadata.map(m=>[m.sheet,m.cell,m.value,m.lockedCellOverride]),[['Cover Sheet','D15','Bar-Ilan University',false]]);
 assert.equal(esf.report.template.year,2023);assert.equal(ases.report.template.year,2026);
 assert.equal((await getOfficialWorkbookSheet({workbook:ases,sheet:'Read_Me'})).cells.find(c=>c.ref==='A1').text,'2026');
 const unknown=snapshot('COORDINATOR',{'LC-ESF-S01-L11':{status:'unknown',value:'',reason:'A saved decision remains unresolved'}});
 const pending=await buildOfficialWorkbook({kind:'esf',snapshots:[unknown]});assert.equal(pending.report.projectMetadata[0].status,'saved_answer_pending');assert.doesNotMatch(cell(pending,entry('LC-ESF-S01-L11')),/BIU Racing/);
 const saved=snapshot('COORDINATOR',{'LC-ESF-S01-L11':{status:'answered',value:'Approved saved team name'}});
 const written=await buildOfficialWorkbook({kind:'esf',snapshots:[saved],translations:[translation(saved)]});assert.equal(written.report.projectMetadata[0].source,'saved_answer');assert.equal(written.report.projectMetadata[0].value,'Approved saved team name');
 for(const [kind,w]of [['esf',esf],['ases',ases]]){
  const before=original(kind),after=unzipSync(w.bytes),allowed=new Set([...w.report.clearedTemplateValues,...w.report.writtenCells,...w.report.projectMetadata.filter(m=>m.source==='project_identity')].map(c=>c.sheet+'!'+c.cell));
  for(const sheet of templates[kind].sheets){
   const parse=value=>new Map([...strFromU8(value).matchAll(/<c\b([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g)].map(m=>[/\br="([^"]*)"/.exec(m[1])[1],m[0]]));const old=parse(before[sheet.path]),current=parse(after[sheet.path]);
   for(const [ref,body] of current)if(body!==old.get(ref))assert.ok(allowed.has(sheet.name+'!'+ref),'Unexpected changed cell '+sheet.name+'!'+ref);
  }
 }
});

test('theme indexes preserve white headers and black instruction text instead of reversing light/dark',async()=>{
 const view=await getOfficialWorkbookSheet({workbook:await blank('esf'),sheet:'Overview'}),header=view.cells.find(c=>c.ref==='A1'),instructions=view.cells.find(c=>c.ref==='A2');
 assert.equal(view.styles[header.styleId].color,'#FFFFFF');assert.equal(view.styles[instructions.styleId].color,'#000000');assert.equal(view.styles[instructions.styleId].verticalAlign,'top');assert.match(instructions.text,/All cells for input/);
 assert.equal(view.cells.find(c=>c.ref==='L13').text,'2027');assert.equal(view.cells.find(c=>c.ref==='L11').origin,'project_metadata');
});

test('SES preserves all 49 sheets and every ZIP part outside explicit cell writes and recalc metadata',async()=>{
 const field=fields('SES').find(f=>f.kind==='table'&&f.officialTemplate.sheet==='Cover Sheet');
 const s=snapshot('SES',{[field.id]:{status:'answered',value:[{_id:'ses1',[field.id+'-CELL']:'D14',[field.id+'-VALUE']:'Bar-Ilan University',[field.id+'-UNIT']:'',[field.id+'-SOURCE']:''}]}});
 const result=await buildOfficialWorkbook({kind:'ses',snapshots:[s]});assert.equal(result.sheets.length,49);assert.equal(result.report.fields.find(f=>f.fieldId===field.id).status,'written');
 const before=original('ses'),after=unzipSync(result.bytes);assert.deepEqual(Object.keys(before).sort(),Object.keys(after).sort());
 const allowed=new Set(result.report.changedParts);for(const name of Object.keys(before))if(!allowed.has(name))assert.deepEqual(after[name],before[name],name);
 assert.equal(result.report.readyForSubmission,false);assert.equal(result.report.template.submission2027Verified,false);
});
test('SES rejects out-of-range, merged non-anchor, duplicate and formula cells without partial writes',async()=>{
 const cover=fields('SES').find(f=>f.kind==='table'&&f.officialTemplate.sheet==='Cover Sheet');
 const rows=ref=>({_id:'bad',[cover.id+'-CELL']:ref,[cover.id+'-VALUE']:'Bad'});
 for(const bad of [[rows('A1')],[rows('E14')],[rows('D14'),{...rows('D14'),_id:'duplicate'}]]){
  const s=snapshot('SES',{[cover.id]:{status:'answered',value:bad}}),result=await buildOfficialWorkbook({kind:'ses',snapshots:[s]});
  assert.equal(result.report.writtenCells.length,0);assert.ok(['protected','invalid_value'].includes(result.report.fields.find(f=>f.fieldId===cover.id).status));
 }
 const guards=JSON.parse(fs.readFileSync('data/ses-export-guards.json')),guard=guards.find(g=>g.formulaCellsInsideEditableRanges.length);
 const field=fields('SES').find(f=>f.kind==='table'&&f.officialTemplate.sheet===guard.sheet);
 const s=snapshot('SES',{[field.id]:{status:'answered',value:[{_id:'formula',[field.id+'-CELL']:guard.formulaCellsInsideEditableRanges[0],[field.id+'-VALUE']:'999'}]}});
 const result=await buildOfficialWorkbook({kind:'ses',snapshots:[s]});assert.equal(result.report.writtenCells.length,0);assert.equal(result.report.fields.find(f=>f.fieldId===field.id).status,'protected');
 const bytes=unzipSync(result.bytes);assert.deepEqual(bytes[guard.xmlPath],original('ses')[guard.xmlPath]);
});
test('SES Hebrew waits for matching translation and rejects stale or changed row identity',async()=>{
 const field=fields('SES').find(f=>f.kind==='table'&&f.officialTemplate.sheet==='Cover Sheet');
 const answer={status:'answered',value:[{_id:'r1',[field.id+'-CELL']:'D14',[field.id+'-VALUE']:'אוניברסיטת בר אילן'}]},s=snapshot('SES',{[field.id]:answer});
 const translated={...answer,value:[{...answer.value[0],[field.id+'-VALUE']:'Bar-Ilan University'}]},ready=translation(s,{[field.id]:translated});
 for(const state of [undefined,{...ready,sourceRevision:1},{...ready,sourceHash:'wrong'}]){
  const result=await buildOfficialWorkbook({kind:'ses',snapshots:[s],translations:state?[state]:[]});assert.equal(result.report.writtenCells.length,0);assert.equal(result.report.fields.find(f=>f.fieldId===field.id).status,'translation_pending');
 }
 const good=await buildOfficialWorkbook({kind:'ses',snapshots:[s],translations:[ready]});assert.equal(good.report.writtenCells[0].value,'Bar-Ilan University');
 const changed=translation(s,{[field.id]:{...translated,value:[{...translated.value[0],_id:'other'}]}});
 assert.equal((await buildOfficialWorkbook({kind:'ses',snapshots:[s],translations:[changed]})).report.fields.find(f=>f.fieldId===field.id).status,'source_conflict');
 assert.equal(s.answers[field.id].value[0][field.id+'-VALUE'],'אוניברסיטת בר אילן');
});
test('SES evidence and missing authorization never produce invented inputs',async()=>{
 const field=fields('SES').find(f=>f.kind==='file'),s=snapshot('SES',{[field.id]:{status:'answered',value:'',attachmentIds:['test-proof']}});
 const result=await buildOfficialWorkbook({kind:'ses',snapshots:[s]});assert.equal(result.report.fields.find(f=>f.fieldId===field.id).status,'evidence_required');assert.equal(result.report.writtenCells.length,0);
 const noAccess=await buildOfficialWorkbook({kind:'ses',snapshots:[snapshot('TSAL')]});assert.ok(noAccess.report.fields.every(f=>f.status==='out_of_scope'));
});
