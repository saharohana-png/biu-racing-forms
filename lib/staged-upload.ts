import 'server-only';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {requireAccess,ApiError,MAX_FILE_BYTES,bucket} from './server';
import {signedUpload,removeStagedFile} from './cloud-storage';
import {getFields} from './catalog';
type Ticket={key:string;subject:string;id:string;size:number;name:string;mime:string;expires:number};
function sign(value:string){const secret=process.env.FORMS_SESSION_KEY;if(!secret)throw Error('Upload signing unavailable');return createHmac('sha256',secret).update('upload:'+value).digest('hex');}
export async function prepareUpload(id:string,input:Record<string,unknown>){
 const member=await requireAccess(id,true);
 if(!getFields(id).some(f=>f.id===input.fieldId))throw new ApiError(400,'השדה לא נמצא.');
 if(!Number.isSafeInteger(input.size)||Number(input.size)<=0||Number(input.size)>MAX_FILE_BYTES||typeof input.name!=='string'||input.name.length>255)throw new ApiError(413,'קובץ לא תקין או גדול מ־25 MiB.');
 const ticket:Ticket={key:'files/'+id+'/stage-'+crypto.randomUUID(),subject:member.subject,id,size:Number(input.size),name:input.name,mime:typeof input.mime==='string'?input.mime:'application/octet-stream',expires:Date.now()+15*60000};
 const payload=Buffer.from(JSON.stringify(ticket)).toString('base64url');
 return {...await signedUpload(ticket.key),ticket:payload+'.'+sign(payload)};
}
export async function stagedForm(id:string,input:Record<string,unknown>){
 const member=await requireAccess(id,true),value=input.ticket;
 if(typeof value!=='string'||value.length>4096)throw new ApiError(400,'אישור ההעלאה חסר.');
 const [payload,signature,...rest]=value.split('.');
 if(rest.length||!/^[a-f0-9]{64}$/.test(signature??'')||!timingSafeEqual(Buffer.from(signature),Buffer.from(sign(payload))))throw new ApiError(403,'אישור העלאה לא תקין.');
 const ticket=JSON.parse(Buffer.from(payload,'base64url').toString()) as Ticket;
 if(ticket.subject!==member.subject||ticket.id!==id||ticket.expires<Date.now())throw new ApiError(403,'אישור ההעלאה פג. יש לנסות להעלות שוב.');
 const object=await bucket().get(ticket.key);if(!object)throw new ApiError(404,'ההעלאה לא הושלמה.');
 const bytes=await object.arrayBuffer();if(bytes.byteLength!==ticket.size)throw new ApiError(400,'הקובץ לא התקבל במלואו.');
 const form=new FormData();
 for(const key of ['fieldId','baseRevision','mutationId','replaces'])if(typeof input[key]==='string')form.set(key,input[key]);
 form.set('file',new File([bytes],ticket.name,{type:ticket.mime}));
 return {form,cleanup:()=>removeStagedFile(ticket.key)};
}
