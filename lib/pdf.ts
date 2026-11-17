import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import bidiFactory from 'bidi-js';
import fontData from '../private-data/font-data.json';
const bidi=bidiFactory();
export type ReportLine={text:string;title?:boolean;small?:boolean};
export async function renderPDF(lines:ReportLine[]) {
  const doc=await PDFDocument.create();
  // The Unicode bidi algorithm below orders mixed Hebrew/Latin text. Force the
  // font shaper to keep that visual order instead of reversing the whole line.
  doc.registerFontkit({...fontkit,create:(data:Uint8Array)=>{
    const base=fontkit.create(data) as ReturnType<typeof fontkit.create> & {getVariation:(axes:Record<string,number>)=>ReturnType<typeof fontkit.create>};
    const face=base.getVariation({wght:400,wdth:100});
    const layout=face.layout.bind(face) as unknown as (text:string,features?:string[],script?:string,language?:string,direction?:string)=>ReturnType<typeof face.layout>;
    face.layout=(text:string,features?:string[])=>layout(text,features,undefined,undefined,'ltr');return face;
  }});
  const bytes=Uint8Array.from(atob(fontData),c=>c.charCodeAt(0));
  const font=await doc.embedFont(bytes,{subset:true});
  doc.setTitle('BIU Racing | תיק החשמל 2027');doc.setSubject('תיעוד תכן ובדיקות — ייצוא פרטי');doc.setCreator('BIU Racing');
  let page=doc.addPage([595.28,841.89]),y=795;
  const visual=(text:string)=>bidi.getReorderedString(text,bidi.getEmbeddingLevels(text,'rtl'));
  const clean=(text:string)=>text.replace(/[\u0000-\u0008\u000b-\u001f]/g,'').replace(/[\u202a-\u202e\u2066-\u2069]/g,'');
  function draw(text:string,size:number,title:boolean){
    if(y<48){page=doc.addPage([595.28,841.89]);y=795;}
    const v=visual(text),width=font.widthOfTextAtSize(v,size);
    // fontkit already supplies glyph positioning; turn off optional bidi features so
    // Unicode reordering above remains the only visual ordering operation.
    page.drawText(v,{x:Math.max(42,553-width),y,size,font,color:title?rgb(0,.322,.235):rgb(.03,.055,.05)});y-=size*1.55;
  }
  for(const item of lines){
    const size=item.title?16:item.small?9:11;
    if(item.title)y-=12;
    for(const paragraph of clean(item.text).split('\n')){
      const words=paragraph.split(/\s+/);let line='';
      for(const word of words){
        const candidate=line?line+' '+word:word;
        if(font.widthOfTextAtSize(visual(candidate),size)>511){
          if(line)draw(line,size,!!item.title);line='';
          // IDs and unbroken URLs also wrap, preserving every character.
          for(const char of word){if(font.widthOfTextAtSize(visual(line+char),size)>511){draw(line,size,!!item.title);line='';}line+=char;}
        }else line=candidate;
      }
      if(line)draw(line,size,!!item.title);else y-=5;
    }
    y-=item.title?5:4;
  }
  return doc.save();
}
