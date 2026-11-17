import {validateLiterals} from './local-translation.mjs';
/** Structural protection is not a claim of semantic or engineering approval. */
export function validateLocalTranslation(source:string,english:unknown):string{
 if(typeof english!=='string'||!english.trim()||english.length>Math.max(2000,source.length*6)||!validateLiterals(source,english).ok)throw new Error('INVALID_LOCAL_TRANSLATION');
 return (source.match(/^\s*/)?.[0]??'')+english.trim()+(source.match(/\s*$/)?.[0]??'');
}
