import {pipeline,env} from '@huggingface/transformers';
import {LOCAL_MODEL_ID,LOCAL_MODEL_REVISION} from './local-translation-config';
import {needsTranslation,prepareTranslation,restoreTranslation} from './local-translation.mjs';
env.allowLocalModels=false;
env.useBrowserCache=true;
// A single CPU worker also works without cross-origin isolation or a GPU.
if(env.backends.onnx.wasm)env.backends.onnx.wasm.numThreads=1;
let translator:Promise<unknown>|undefined;
type TranslationFunction=(text:string,options:Record<string,unknown>)=>Promise<{translation_text:string}[]>;
let sequence=Promise.resolve();
self.onmessage=(event:MessageEvent<{id:string;text:string}>)=>{
 const {id,text}=event.data;
 sequence=sequence.catch(()=>{}).then(async()=>{
  try{
   if(!needsTranslation(text)){self.postMessage({id,text});return;}
   const prepared=prepareTranslation(text);
   let output=prepared.text;
   if(needsTranslation(output)){
    translator??=pipeline('translation',LOCAL_MODEL_ID,{revision:LOCAL_MODEL_REVISION,dtype:'q8',device:'wasm',
      progress_callback:(progress:unknown)=>self.postMessage({id,progress})}).catch(error=>{translator=undefined;throw error;});
    const translate=await translator as TranslationFunction;
    const result=await translate(prepared.text,{max_new_tokens:256,do_sample:false});
    output=result[0]?.translation_text??'';
   }
   const restored=restoreTranslation(prepared,output);
   if(!restored.ok)throw new Error('PROTECTED_TEXT_CHANGED');
   self.postMessage({id,text:restored.text});
  }catch(error){self.postMessage({id,error:error instanceof Error?error.message:'LOCAL_TRANSLATION_FAILED'});}
 });
};
