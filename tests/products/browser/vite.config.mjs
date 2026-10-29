import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
const path=x=>fileURLToPath(new URL(x,import.meta.url));
export default defineConfig({root:path('./'),base:'/products-preview/',plugins:[react()],resolve:{alias:[
 {find:'@/api/supabaseClient',replacement:path('./mockDb.js')},
 {find:'@/lib/AuthContext',replacement:path('./mockAuth.jsx')},
 {find:'@/lib/AuthStateContext',replacement:path('./mockAuth.jsx')},
 {find:'@',replacement:path('../../../src')},
]},css:{postcss:path('../../../')},build:{outDir:path('../../../dist/products-preview'),emptyOutDir:true},server:{host:'0.0.0.0',port:3017,strictPort:true,fs:{allow:[path('../../../')]}}});
