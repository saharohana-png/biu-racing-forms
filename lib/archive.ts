/** Small streaming ZIP writer (STORE). Original evidence is streamed, not buffered. */
export type ArchiveEntry = {name: string; bytes?: Uint8Array; stream?: ReadableStream<Uint8Array>; loadStream?:()=>Promise<ReadableStream<Uint8Array>>; sha256: string; size: number};
const encoder = new TextEncoder();
const crcTable = Array.from({length:256}, (_,n) => {let c=n; for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crcStep(crc:number, data:Uint8Array) {for(const b of data)crc=crcTable[(crc^b)&255]^(crc>>>8);return crc;}
function header(length:number) {const a=new Uint8Array(length);return {a,v:new DataView(a.buffer)};}
export async function sha256(bytes:Uint8Array) {return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as BufferSource)),b=>b.toString(16).padStart(2,'0')).join('');}
export async function textEntry(name:string,text:string):Promise<ArchiveEntry> {const bytes=encoder.encode(text);return {name,bytes,size:bytes.length,sha256:await sha256(bytes)};}
export function zip(entries:Iterable<ArchiveEntry>|AsyncIterable<ArchiveEntry>):ReadableStream<Uint8Array> {
  async function* chunks() {
    const central:Uint8Array[]=[]; let offset=0;
    for await(const entry of entries) {
      if(offset+entry.size+2048>0xffffffff||central.length>=65534)throw new Error('Archive exceeds supported ZIP size; export individual systems');
      if(!/^[a-zA-Z0-9_./-]+$/.test(entry.name)||entry.name.includes('..')||entry.name.startsWith('/'))throw new Error('Unsafe archive name');
      const name=encoder.encode(entry.name),start=offset;
      const h=header(30+name.length);h.v.setUint32(0,0x04034b50,true);h.v.setUint16(4,20,true);h.v.setUint16(6,0x0808,true);h.v.setUint16(26,name.length,true);h.a.set(name,30);yield h.a;offset+=h.a.length;
      let crc=0xffffffff,size=0;
      if(entry.bytes){crc=crcStep(crc,entry.bytes);size+=entry.bytes.length;yield entry.bytes;}
      else if(entry.stream||entry.loadStream){const stream=entry.stream??await entry.loadStream!();const reader=stream.getReader();try{for(;;){const next=await reader.read();if(next.done)break;crc=crcStep(crc,next.value);size+=next.value.length;yield next.value;}}finally{reader.releaseLock();}}
      if(size!==entry.size)throw new Error('Evidence size changed during export');
      crc=(crc^0xffffffff)>>>0;offset+=size;
      const d=header(16);d.v.setUint32(0,0x08074b50,true);d.v.setUint32(4,crc,true);d.v.setUint32(8,size,true);d.v.setUint32(12,size,true);yield d.a;offset+=16;
      const c=header(46+name.length);c.v.setUint32(0,0x02014b50,true);c.v.setUint16(4,20,true);c.v.setUint16(6,20,true);c.v.setUint16(8,0x0808,true);c.v.setUint32(16,crc,true);c.v.setUint32(20,size,true);c.v.setUint32(24,size,true);c.v.setUint16(28,name.length,true);c.v.setUint32(42,start,true);c.a.set(name,46);central.push(c.a);
    }
    const centralStart=offset;for(const c of central){yield c;offset+=c.length;}
    const end=header(22);end.v.setUint32(0,0x06054b50,true);end.v.setUint16(8,central.length,true);end.v.setUint16(10,central.length,true);end.v.setUint32(12,offset-centralStart,true);end.v.setUint32(16,centralStart,true);yield end.a;
  }
  const iterator=chunks();return new ReadableStream({async pull(controller){try{const n=await iterator.next();if(n.done)controller.close();else controller.enqueue(n.value);}catch(error){console.error('Export stream failed',error instanceof Error?error.message:'unknown');controller.error(error);}},async cancel(){await iterator.return(undefined);}});
}
