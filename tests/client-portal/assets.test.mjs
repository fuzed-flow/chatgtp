import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import handler from '../../api/client-portal-assets.js';
import { clientPortalManifest } from '../../src/lib/clientPortalManifest.js';

const CLIENT='00000000-0000-4000-8000-000000000003',TOKEN='a'.repeat(64);
const company={name:'Test Contractor',logo_url:'https://portal.example/storage/v1/object/public/logos/test.png'};
test('the manifest opens this client portal and uses branded icon endpoints',()=>{
  const manifest=clientPortalManifest(CLIENT,TOKEN,company);
  assert.equal(manifest.name,'Test Contractor Client Portal');
  assert.equal(manifest.scope,'/ClientPortal');
  const target=new URL(manifest.start_url,'https://app.example');
  assert.equal(target.pathname,'/ClientPortal');assert.equal(target.searchParams.get('portal_token'),TOKEN);
  assert.deepEqual(manifest.icons.map(icon=>icon.sizes),['192x192','512x512']);
});

async function request(query,{valid=true,logo=company.logo_url}={}){
  const fetchOriginal=globalThis.fetch;
  const originalUrl=process.env.VITE_SUPABASE_URL,originalKey=process.env.VITE_SUPABASE_ANON_KEY;
  process.env.VITE_SUPABASE_URL='https://portal.example';process.env.VITE_SUPABASE_ANON_KEY='synthetic-publishable-key';
  const calls=[];
  const png=await sharp({create:{width:400,height:200,channels:3,background:'#12ab34'}}).png().toBuffer();
  globalThis.fetch=async(url,options)=>{
    calls.push({url:String(url),options});
    if(String(url).includes('/rest/v1/rpc/'))return{ok:valid,json:async()=>({company:{...company,logo_url:logo}})};
    return{ok:true,headers:new Headers({'content-length':String(png.length)}),arrayBuffer:async()=>png};
  };
  const result={headers:{},statusCode:200,body:null,setHeader(key,value){this.headers[key]=value;},status(code){this.statusCode=code;return this;},send(body){this.body=body;return this;},end(){return this;}};
  try{await handler({method:'GET',query:{client:CLIENT,token:TOKEN,kind:'manifest',...query}},result);return{result,calls};}
  finally{globalThis.fetch=fetchOriginal;if(originalUrl===undefined)delete process.env.VITE_SUPABASE_URL;else process.env.VITE_SUPABASE_URL=originalUrl;if(originalKey===undefined)delete process.env.VITE_SUPABASE_ANON_KEY;else process.env.VITE_SUPABASE_ANON_KEY=originalKey;}
}
test('manifest assets require valid access and are never publicly cached',async()=>{
  const {result}=await request({});assert.equal(result.statusCode,200);
  assert.equal(result.headers['Cache-Control'],'private, no-store');
  assert.equal(result.headers['Content-Type'],'application/manifest+json');
  assert.equal(JSON.parse(result.body).name,'Test Contractor Client Portal');
  assert.equal((await request({},{valid:false})).result.statusCode,403);
  assert.equal((await request({token:'short'})).result.statusCode,400);
});
for(const size of ['192','512'])test(`the contractor logo becomes a square ${size}px installation icon`,async()=>{
  const {result}=await request({kind:'icon',size});assert.equal(result.statusCode,200);
  const metadata=await sharp(result.body).metadata();assert.equal(metadata.width,Number(size));assert.equal(metadata.height,Number(size));assert.equal(metadata.format,'png');
});
test('asset fetching never follows an arbitrary logo URL',async()=>{
  const {result,calls}=await request({kind:'icon'},{logo:'http://127.0.0.1/private'});
  assert.equal(result.statusCode,200);assert.equal(calls.length,1);
  assert.equal((await sharp(result.body).metadata()).width,512);
});
