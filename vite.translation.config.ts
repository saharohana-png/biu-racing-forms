import {defineConfig} from 'vite';
// Build the browser worker independently so RSC/HMR transforms cannot inject
// window-only development code into the worker's dependency graph.
export default defineConfig({
 publicDir:false,base:"/translation/",
 build:{outDir:'public/translation',emptyOutDir:true,target:'es2022',sourcemap:false,
  assetsInlineLimit:0,rolldownOptions:{input:'lib/translation.worker.ts',output:{format:'es',entryFileNames:'translation.worker.js'}},
 },
 define:{'process.env.NODE_ENV':JSON.stringify('production')},
});
