// Local engineering translation preprocessing. No network access.
// Preserving literals is not a proof that the whole translation is correct.
const HEBREW=/[\u0590-\u05ff]/;
const TECH=/https?:\/\/[^\s<>"'\u0590-\u05ff]+|[A-Za-z][A-Za-z0-9_./:+-]*|[+-]?\d+(?:[.,]\d+)*(?:[eE][+-]?\d+)?|[≤≥<>±Ωµμ°%]/g;
const NUMBERS=/[+-]?\d+(?:[.,]\d+)*(?:[eE][+-]?\d+)?/g;
const RE=/[.*+?^${}()|[\]\\]/g;
const escape=s=>s.replace(RE,'\\$&');
const count=(s,token)=>[...s.matchAll(new RegExp(`(?<![A-Za-z0-9_])${escape(token)}(?![A-Za-z0-9_])`,'g'))].length;
const frequencies=xs=>[...new Set(xs)].sort().map(x=>[x,xs.filter(y=>x===y).length]);
export const needsTranslation=s=>HEBREW.test(s);

export function literalSpans(text){
 const spans=[];
 for(const m of text.matchAll(TECH)){
   const value=m[0].replace(/[.:;,!?]+$/u,'');
   if(value)spans.push({start:m.index,end:m.index+value.length,value,kind:'literal'});
 }
 // Preserve a unit expression or an existing English phrase as one placeholder.
 const merged=[];
 for(const span of spans){
   const previous=merged.at(-1);
   if(previous&&/^[ \t]*$/u.test(text.slice(previous.end,span.start))){
     previous.end=span.end;previous.value=text.slice(previous.start,previous.end);
   }else merged.push({...span});
 }
 return merged;
}

// Deliberately small and contextual. These are never broad replacements for
// everyday נגד (against), כניסה (entrance) or הסכמה (agreement).
export function glossarySpans(text){
 const spans=[];
 const add=(pattern,target,plural=false)=>{
   for(const m of text.matchAll(pattern))spans.push({start:m.index,end:m.index+m[0].length,value:target,kind:'glossary',source:m[0],plural});
 };
 add(/(?<![א-ת])(?:ה)?מגעונים(?![א-ת])/gu,'contactors',true);
 add(/(?<![א-ת])(?:ה)?מגעון(?![א-ת])/gu,'contactor');
 add(/(?<![א-ת])ערך הנגד(?![א-ת])/gu,'resistor value');
 // The complete measured-resistor phrase avoids treating Hebrew של as an
 // English possessive. Preserve the exact original numeric/unit expression.
 for(const m of text.matchAll(/(?<![א-ת])נגד של ([+-]?\d+(?:[.,]\d+)*[ \t]*(?:[kMµμm]?Ω|ohms?))(?![A-Za-zא-ת])/gu)){
   spans.push({start:m.index,end:m.index+m[0].length,value:`${m[1]} resistor`,kind:'glossary',source:m[0],plural:false});
 }
 // כניסה is input only when directly followed by a Latin signal identifier.
 add(/(?<![א-ת])הכניסה(?= [A-Za-z][A-Za-z0-9_]*)/gu,'input');
 // A narrow reviewed-schema construction plus circuit/CAD context. Merely
 // mentioning TSAL must not turn "יש הסכמה" (there is agreement) into schematic.
 if(/Altium|TSAL|AIR[+-]|מחבר|מעגל/u.test(text))add(/(?<![א-ת])הסכמה(?= (?:של [^.\n]{1,32} )?(?:טרם |עדיין לא )?נבדקה)/gu,'schematic');
 add(/מופרד גלוונית(?![א-ת])/gu,'galvanically isolated');
 return spans;
}

export function prepareTranslation(text,{glossary=true}={}){
 const terms=glossary?glossarySpans(text):[];
 const literals=literalSpans(text).filter(l=>!terms.some(t=>t.start<=l.start&&t.end>=l.end));
 const spans=[...literals,...terms].sort((a,b)=>a.start-b.start||b.end-a.end);
 const used=new Set([...text.matchAll(/\bP\d+s?\b/g)].map(m=>m[0].replace(/s$/,'')));
 const replacements=[];let cursor=0;let nextId=0;let masked='';
 for(const span of spans){
   if(span.start<cursor)throw Error('Overlapping protected spans');
   while(used.has(`P${nextId}`))nextId++;
   const marker=`P${nextId++}`;used.add(marker);
   masked+=text.slice(cursor,span.start)+marker;
   replacements.push({...span,marker});cursor=span.end;
 }
 masked+=text.slice(cursor);
 return {source:text,text:masked,replacements};
}

export function restoreTranslation(prepared,translated){
 const failures=[];
 const {replacements,source}=prepared;
 for(const r of replacements){
   const variants=r.kind==='glossary'&&r.plural?`${r.marker}s?`:r.marker;
   const expression=new RegExp(`\\b(?:${variants})\\b`,'g');
   const matches=[...translated.matchAll(expression)];
   if(matches.length!==1)failures.push(`placeholder_count:${r.marker}:${matches.length}`);
 }
 const expected=new Set(replacements.map(r=>r.marker));
 for(const m of translated.matchAll(/\b(P\d+)([A-Za-z0-9_]*)\b/g)){
   const r=replacements.find(r=>r.marker===m[1]);
   if(!expected.has(m[1])||(m[2]&&!(m[2]==='s'&&r?.kind==='glossary'&&r.plural)))failures.push(`unexpected_placeholder:${m[0]}`);
 }
 if(failures.length)return {ok:false,text:translated,failures};
 const restored=translated.replace(/\b(P\d+)(s?)\b/g,(m,marker)=>replacements.find(r=>r.marker===marker).value);
 const validation=validateLiterals(source,restored);
 return {ok:validation.ok,text:restored,failures:validation.failures};
}

export function validateLiterals(source,target){
 const failures=[];
 if(HEBREW.test(target))failures.push('remaining_hebrew');
 for(const [token,n] of frequencies(literalSpans(source).map(s=>s.value))){
   const actual=count(target,token);
   if(actual!==n)failures.push(`literal:${token}:${n}->${actual}`);
 }
 if(JSON.stringify(frequencies(source.match(NUMBERS)||[]))!==JSON.stringify(frequencies(target.match(NUMBERS)||[])))failures.push('numeric_multiset');
 return {ok:!failures.length,failures};
}
