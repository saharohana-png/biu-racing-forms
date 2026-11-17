import { getFields, schemaVersion } from './catalog';
import { computeProgress, referencedAttachmentIds, type Answers, type Attachment, type Review, type SystemSnapshot } from './progress';

type Submission = { id:string; answers:string; revision:number; status:SystemSnapshot['status']; review:string; updatedAt:string|null };
type Revision = { revision:number; answers:string; status:string; review:string; schemaVersion:string; contentHash:string; createdAt:string };
type ReviewEvent = { id:string; systemId:string; revision:number; action:string; reason:string; fieldIds:string; role:string; createdAt:string };

/** The route must authorize every ID before calling this read-only exporter. */
export async function dataExport(db:D1Database, ids:string[], createdAt:string, sharedRecords:unknown) {
  if(!ids.length)throw new Error('Empty export scope');
  const slots=ids.map(()=>'?').join(',');
  // Read each collection once. Re-running authentication per system/file can
  // exhaust the Worker request budget on an otherwise modest full-site export.
  const [submissions,files,reviewEvents]=await db.batch([
    db.prepare(`SELECT id,answers,revision,status,review,updated_at AS updatedAt FROM submissions WHERE id IN (${slots})`).bind(...ids),
    db.prepare(`SELECT id,system_id AS systemId,field_id AS fieldId,original_name AS originalName,safe_name AS safeName,mime,size,sha256,state,replaces_id AS replacesId,version,created_at AS createdAt FROM attachments WHERE system_id IN (${slots}) AND state='complete' ORDER BY created_at,id`).bind(...ids),
    db.prepare(`SELECT id,system_id AS systemId,revision,action,reason,field_ids AS fieldIds,role,created_at AS createdAt FROM review_events WHERE system_id IN (${slots}) ORDER BY created_at,id`).bind(...ids),
  ]);
  const rows=new Map((submissions.results as unknown as Submission[]).map(row=>[row.id,row]));
  const allFiles=files.results as unknown as Attachment[];
  const events=reviewEvents.results as unknown as ReviewEvent[];
  const encoder=new TextEncoder();
  async function* chunks(){
    yield JSON.stringify({format:'BIU-ELECTRICAL-DATA',version:1,schemaVersion,createdAt,scope:ids,includesBinaryFiles:false,sharedRecords}).slice(0,-1)+',"systems":[';
    for(let i=0;i<ids.length;i++){
      const id=ids[i],row=rows.get(id),answers:Answers=JSON.parse(row?.answers??'{}'),review:Review=JSON.parse(row?.review??'{}');
      const revision=row?.revision??0,systemFiles=allFiles.filter(file=>file.systemId===id);
      const referenced=referencedAttachmentIds(getFields(id),answers),attachments=systemFiles.filter(file=>referenced.has(file.id));
      const snapshot:SystemSnapshot={id,answers,revision,status:row?.status??'draft',updatedAt:row?.updatedAt??null,review,attachments,progress:computeProgress(getFields(id),answers,attachments,review),schemaVersion};
      const reviews=events.filter(event=>event.systemId===id&&event.revision<=revision).map(event=>({...event,fieldIds:JSON.parse(event.fieldIds)}));
      if(i)yield ',';
      yield JSON.stringify({...snapshot,files:systemFiles,reviews}).slice(0,-1)+',"revisions":[';
      let after=0,first=true;
      for(;;){
        const page=await db.prepare('SELECT revision,answers,status,review,schema_version AS schemaVersion,content_hash AS contentHash,created_at AS createdAt FROM revisions WHERE system_id=? AND revision>? AND revision<=? ORDER BY revision LIMIT 10').bind(id,after,revision).all<Revision>();
        if(!page.results.length)break;
        for(const saved of page.results){
          if(!first)yield ',';first=false;
          yield JSON.stringify({...saved,answers:JSON.parse(saved.answers),review:JSON.parse(saved.review)});
          after=saved.revision;
        }
        if(page.results.length<10)break;
      }
      yield ']}';
    }
    yield ']}';
  }
  const iterator=chunks();
  return new ReadableStream<Uint8Array>({
    async pull(controller){try{const next=await iterator.next();if(next.done)controller.close();else controller.enqueue(encoder.encode(next.value));}catch(error){console.error('Data export failed',error instanceof Error?error.message:'unknown');controller.error(error);}},
    async cancel(){await iterator.return(undefined);},
  });
}
