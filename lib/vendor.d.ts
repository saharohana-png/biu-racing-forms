declare module 'bidi-js' {
  const factory:()=>{getEmbeddingLevels(text:string,direction?:'rtl'|'ltr'):unknown;getReorderedString(text:string,levels:unknown):string};
  export default factory;
}
