// Only the application server can call this bridge. No browser credentials or CORS access.
const base=Deno.env.get('SUPABASE_URL')!;
const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const adminHeaders={'apikey':service,'Authorization':'Bearer '+service};
async function rpc(name:string,body:unknown){return fetch(base+'/rest/v1/rpc/'+name,{method:'POST',headers:{...adminHeaders,'Content-Type':'application/json'},body:JSON.stringify(body)});}
Deno.serve(async req=>{
 try{
  const key=req.headers.get('x-forms-key')??'';
  if(!/^[a-f0-9]{64}$/.test(key))return new Response('Unauthorized',{status:401});
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key))),b=>b.toString(16).padStart(2,'0')).join('');
  const auth=await rpc('forms_gateway_authorize',{key_hash:hash});
  if(!auth.ok||await auth.json()!==true)return new Response('Unauthorized',{status:401});
  const url=new URL(req.url);
  if(url.pathname.endsWith('/database')&&req.method==='POST'){
   const body=await req.text();if(body.length>8*1024*1024)return new Response('Too large',{status:413});
   const response=await rpc('forms_gateway_batch',JSON.parse(body));
   if(!response.ok){console.error('Database bridge',await response.text());return new Response('Database operation failed',{status:500});}
   return new Response(response.body,{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  }
  const objectKey=url.searchParams.get('key')??'';
  if(!/^files\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(objectKey))return new Response('Invalid object key',{status:400});
  const objectUrl=base+'/storage/v1/object/evidence/'+objectKey;
  if(url.pathname.endsWith('/sign-upload')&&req.method==='POST'){
   const response=await fetch(base+'/storage/v1/object/upload/sign/evidence/'+objectKey,{method:'POST',headers:{...adminHeaders,'Content-Type':'application/json'},body:'{}'});
   if(!response.ok)return new Response('Upload authorization failed',{status:502});
   const data=await response.json();return Response.json({url:base+'/storage/v1'+data.url});
  }
  if(req.method==='DELETE'){
   const response=await fetch(base+'/storage/v1/object/evidence',{method:'DELETE',headers:{...adminHeaders,'Content-Type':'application/json'},body:JSON.stringify({prefixes:[objectKey]})});
   return new Response(response.body,{status:response.status});
  }
  if(req.method==='GET'){
   const response=await fetch(objectUrl,{headers:adminHeaders});
   return new Response(response.body,{status:response.status,headers:{'Content-Type':response.headers.get('content-type')??'application/octet-stream','Cache-Control':'no-store'}});
  }
  if(req.method==='PUT'){
   const bytes=await req.arrayBuffer();if(bytes.byteLength>25*1024*1024)return new Response('Too large',{status:413});
   const response=await fetch(objectUrl,{method:'POST',headers:{...adminHeaders,'Content-Type':req.headers.get('content-type')??'application/octet-stream','x-upsert':'true'},body:bytes});
   if(!response.ok)return new Response('Upload failed',{status:502});
   return Response.json({size:bytes.byteLength});
  }
  return new Response('Not found',{status:404});
 }catch(error){console.error('Bridge failure',error instanceof Error?error.message:'unknown');return new Response('Operation failed',{status:500});}
});
