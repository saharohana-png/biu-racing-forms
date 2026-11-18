import 'server-only';
import {postgresStatement} from './sql-compat';

function configuration(){
 const url=process.env.FORMS_GATEWAY_URL,key=process.env.FORMS_GATEWAY_KEY;
 if(!url||!key)throw Error('Cloud storage is not configured');
 return {url,key};
}
async function gateway(path:string, init:RequestInit={}){
 const {url,key}=configuration();
 const response=await fetch(url+path,{...init,cache:'no-store',headers:{...init.headers,'x-forms-key':key},signal:AbortSignal.timeout(55000)});
 if(!response.ok)throw Error('Cloud storage request failed: '+response.status);
 return response;
}
export async function signedUpload(key:string){return (await gateway('/sign-upload?key='+encodeURIComponent(key),{method:'POST'})).json() as Promise<{url:string}>;}
export async function removeStagedFile(key:string){await gateway('/object?key='+encodeURIComponent(key),{method:'DELETE'});}
class Statement {
 constructor(public sql:string,public values:unknown[]=[]){ }
 bind(...values:unknown[]){return new Statement(this.sql,values);}
 async all<T=Record<string,unknown>>(){return (await batch([this]))[0] as {results:T[];success:boolean;meta:{changes:number}};}
 async first<T=Record<string,unknown>>(column?:string){const row=(await this.all<T>()).results[0];return column&&row?(row as Record<string,unknown>)[column]:row??null;}
 async run(){return (await batch([this]))[0];}
}
async function batch(statements:Statement[]){
 const response=await gateway('/database',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({statements:statements.map(s=>({sql:postgresStatement(s.sql,s.values)}))})});
 return response.json() as Promise<Array<{success:boolean;results:Record<string,unknown>[];meta:{changes:number}}>>;
}
export const cloudDatabase={prepare:(sql:string)=>new Statement(sql),batch} as unknown as D1Database;
export const cloudBucket={
 async get(key:string){
  const response=await gateway('/object?key='+encodeURIComponent(key));
  return {body:response.body,arrayBuffer:()=>response.arrayBuffer(),size:Number(response.headers.get('content-length'))};
 },
 async put(key:string,bytes:ArrayBuffer|Uint8Array,options?:{httpMetadata?:{contentType?:string}}){
  const response=await gateway('/object?key='+encodeURIComponent(key),{method:'PUT',body:bytes as BodyInit,headers:{'content-type':options?.httpMetadata?.contentType??'application/octet-stream'}});
  return response.json();
 },
} as unknown as R2Bucket;
