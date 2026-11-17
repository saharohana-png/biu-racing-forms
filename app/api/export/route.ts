import { guard,session,readSystem,listFiles,getFileRecord,getRevisionIndex,getReviewHistory,getSharedRecords,ApiError,database,bucket } from '@/lib/server';
import { systems,getSystem,coverage,coordinatorQueue,sourceSummary,schemaVersion } from '@/lib/catalog';
import { zip,textEntry,sha256,type ArchiveEntry } from '@/lib/archive';
import { makeReport } from '@/lib/report';
import { renderPDF } from '@/lib/pdf';
import rawCoverage from '@/data/formal-field-coverage.json';
import rawMatrix from '@/data/leaf-example-matrix.json';
import rawPlan from '@/data/system-form-plan.json';
import { dataExport } from '@/lib/data-export';
export const dynamic='force-dynamic';
export async function GET(request:Request){return guard(request,async()=>{
  const member=await session(),params=new URL(request.url).searchParams,wanted=params.get('system')??'all',format=params.get('format')??'zip';
  if(!['zip','json'].includes(format))throw new ApiError(400,'פורמט הייצוא אינו נתמך.');
  if(wanted==='all'&&member.role!=='coordinator')throw new ApiError(403,'הפעולה מיועדת לרכז המסמכים.');
  const ids=wanted==='all'?[...systems.map(s=>s.id),'COORDINATOR']:[wanted];
  if(format==='json'){
    for(const id of ids){
      if(!getSystem(id))throw new ApiError(404,'המערכת לא נמצאה.');
      if(id==='COORDINATOR'?member.role!=='coordinator':!member.systemIds.includes(id))throw new ApiError(403,'אין הרשאה למערכת הזו.');
    }
    const createdAt=new Date().toISOString();
    const stream=await dataExport(database(),ids,createdAt,await getSharedRecords());
    return new Response(stream,{headers:{'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="BIU_Racing_2027_data_${wanted}_${createdAt.slice(0,10)}.json"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  }
  const snapshots=await Promise.all(ids.map(id=>readSystem(id)));
  // Capture already-authorized resources before returning the response. Lazy
  // streaming must not call request-header authentication outside its context.
  const db=database(),storage=bucket();
  const createdAt=new Date().toISOString(),entries:ArchiveEntry[]=[];
  const add=async(name:string,data:unknown)=>entries.push(await textEntry(name,JSON.stringify(data,null,2)));
  await add('answers.json',{schemaVersion,createdAt,systems:snapshots});
  await add('field-definitions.json',ids.map(id=>getSystem(id)));
  await add('formal-field-coverage.json',coverage);
  await add('source-registry/formal-field-coverage.json',rawCoverage);
  await add('source-registry/leaf-example-matrix.json',rawMatrix);
  await add('source-registry/system-form-plan.json',rawPlan);
  await add('source-context.json',sourceSummary);
  await add('shared-records-and-conflicts.json',await getSharedRecords());
  await add('coordinator-queue.json',coordinatorQueue);
  await add('missing-and-interfaces.json',snapshots.map(s=>({id:s.id,missing:s.progress.missing,interfaces:getSystem(s.id)?.interfaces,openDependencies:Object.entries(s.answers).filter(([,a])=>a.status==='unknown'||a.dependency).map(([id,a])=>({id,status:a.status,reason:a.reason,dependency:a.dependency}))})));
  const indexes=await Promise.all(snapshots.map(async s=>({id:s.id,revisions:await getRevisionIndex(s.id,s.revision),reviews:(await getReviewHistory(s.id)).filter(review=>review.revision<=s.revision)})));
  await add('history-index.json',indexes);
  const report=makeReport(snapshots,createdAt);
  entries.push(await textEntry('report.html',report.html));
  // A combined PDF of all systems exceeds the Worker CPU budget. The full
  // archive retains the printable HTML, answers, files and revision history.
  if(wanted!=='all'){
    const pdf=await renderPDF(report.lines);entries.push({name:'report.pdf',bytes:pdf,size:pdf.length,sha256:await sha256(pdf)});
  }
  const attachmentIndex=[];
  for(const id of ids){for(const file of await listFiles(id)){
    if(file.state!=='complete')continue;
    const record=await getFileRecord(file.id),extension=file.safeName.match(/\.[A-Za-z0-9]+$/)?.[0]??'.bin',name=`files/${file.id}${extension}`;
    entries.push({name,loadStream:async()=>{const object=await storage.get(record.storageKey);if(!object)throw new Error('Missing evidence during export: '+file.id);return object.body;},size:file.size,sha256:file.sha256});attachmentIndex.push({...file,archivePath:name});
  }}
  await add('attachments.json',attachmentIndex);
  const readingGuide=wanted==='all'?'פתחו report.html לקריאה או להדפסה. PDF נכלל בייצוא של מערכת בודדת; החבילה המלאה כוללת את כל התוכן ב־HTML.':'פתחו report.html או report.pdf לקריאה.';
  entries.push(await textEntry('README.txt',`BIU Racing | תיק החשמל 2027\nחבילה פרטית ועצמאית. ${readingGuide} answers.json כולל תשובות ומזהים קבועים; field-definitions.json כולל את ההגדרות; history-index.json ו־history/ שומרים גרסאות ובדיקות; files/ מכיל את הקבצים המקוריים, גם בגרסאות קודמות. source-registry/ מכיל את מיפוי המקור המלא, הנוסחאות ומטריצת הדוגמאות. manifest.json מכיל גדלים וחותמות SHA-256.\nתבניות ההגשה לאיטליה 2027 ודוגמאות חסרות נשארות להשלמה. החבילה אינה הגשה לתחרות ואינה אישור הנדסי.\n`));
  const count=indexes.reduce((n,i)=>n+i.revisions.length,0);
  if(count+entries.length>65000)throw new ApiError(413,'מספר גרסאות התיעוד גדול מדי לחבילה אחת. יש לייצא כל מערכת בנפרד.');
  let estimated=entries.reduce((n,e)=>n+e.size+2048,0);
  for(const snapshot of snapshots){const estimate=await database().prepare('SELECT COALESCE(SUM(length(CAST(answers AS BLOB))+length(CAST(review AS BLOB))+2048),0) AS bytes FROM revisions WHERE system_id=? AND revision<=?').bind(snapshot.id,snapshot.revision).first<{bytes:number}>();estimated+=estimate?.bytes??0;}
  if(estimated>3.5*1024*1024*1024)throw new ApiError(413,'חבילת כל הגרסאות גדולה ממגבלת הייצוא הבטוחה. יש לייצא מערכות בנפרד; שום קובץ לא הושמט.');
  const manifest=entries.map(e=>({path:e.name,size:e.size,sha256:e.sha256}));
  async function* generate(){
    for(const entry of entries)yield entry;
    for(const snapshot of snapshots){let after=0;for(;;){
      const page=await db.prepare('SELECT revision,answers,status,review,schema_version AS schemaVersion,content_hash AS contentHash,created_at AS createdAt FROM revisions WHERE system_id=? AND revision>? AND revision<=? ORDER BY revision LIMIT 10').bind(snapshot.id,after,snapshot.revision).all<{revision:number;answers:string;review:string;status:string;schemaVersion:string;contentHash:string;createdAt:string}>();
      if(!page.results.length)break;
      for(const row of page.results){const revision={...row,answers:JSON.parse(row.answers),review:JSON.parse(row.review)};const entry=await textEntry(`history/${snapshot.id}/${row.revision}.json`,JSON.stringify(revision));manifest.push({path:entry.name,size:entry.size,sha256:entry.sha256});yield entry;after=row.revision;}
    }}
    yield await textEntry('manifest.json',JSON.stringify({format:'BIU-ELECTRICAL-EXPORT',version:1,schemaVersion,createdAt,scope:ids,files:manifest},null,2));
  }
  return new Response(zip(generate()),{headers:{'Content-Type':'application/zip','Content-Disposition':`attachment; filename="BIU_Racing_2027_${wanted==='all'?'all':wanted}_${createdAt.slice(0,10)}.zip"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
});}
