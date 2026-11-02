import test from 'node:test';import assert from 'node:assert/strict';import sharp from 'sharp';
import {GET} from '../../api/client-portal-icon.js';
const logo='https://ochqexofahdssmarnict.supabase.co/storage/v1/object/public/logos/company.svg';
const image=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100"><rect width="400" height="100" fill="red"/></svg>');
const request=(size,extra={})=>new Request('https://app.fuzedflow.com/api/client-portal-icon?'+new URLSearchParams({logo,label:'Sample Company',size:String(size),...extra}));

test('company icons are square PNGs with the full logo contained and no cropping',async()=>{
  const original=globalThis.fetch;const calls=[];
  globalThis.fetch=async(url,options)=>{calls.push({url,options});return new Response(image,{headers:{'Content-Type':'image/svg+xml'}});};
  try{for(const size of [32,180,192,512]){
    const response=await GET(request(size));assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');
    const buffer=Buffer.from(await response.arrayBuffer()),metadata=await sharp(buffer).metadata();assert.equal(metadata.width,size);assert.equal(metadata.height,size);
    const {data,info}=await sharp(buffer).raw().toBuffer({resolveWithObject:true});const pixel=(x,y)=>[...data.subarray((y*size+x)*info.channels,(y*size+x)*info.channels+3)];
    assert.deepEqual(pixel(0,0),[255,255,255]);assert.deepEqual(pixel(Math.floor(size/2),Math.floor(size/2)),[255,0,0]);
  }assert.ok(calls.every(call=>call.url===logo&&call.options.redirect==='error'));}finally{globalThis.fetch=original;}
});

test('desktop ICO contains the company PNG with valid dimensions and directory offsets',async()=>{
  const original=globalThis.fetch;globalThis.fetch=async()=>new Response(image);
  try{const response=await GET(request(256,{format:'ico'}));assert.equal(response.headers.get('content-type'),'image/x-icon');const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.readUInt16LE(2),1);assert.equal(bytes.readUInt16LE(4),1);assert.equal(bytes.readUInt32LE(18),22);assert.equal(bytes.readUInt32LE(14),bytes.length-22);assert.equal((await sharp(bytes.subarray(22)).metadata()).width,256);}finally{globalThis.fetch=original;}
});

test('external targets, invalid images and missing logos fall back to company initials without external requests',async()=>{
  const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return new Response('not an image');};
  try{const bad=request(192,{logo:'http://169.254.169.254/latest/meta-data/'});assert.equal((await GET(bad)).status,200);assert.equal(calls,0);
    const fallback=await GET(request(192));assert.equal((await sharp(Buffer.from(await fallback.arrayBuffer())).metadata()).width,192);assert.equal(calls,1);
    assert.equal((await GET(request(999))).status,400);assert.equal((await GET(request(192,{format:'ico'}))).status,400);
  }finally{globalThis.fetch=original;}
});

test('oversized bodies and SVG external resources are not rendered',async()=>{
  const original=globalThis.fetch;let variant='large';
  globalThis.fetch=async()=>variant==='large'?new Response(image,{headers:{'content-length':String(6*1024*1024)}}):new Response('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><image href="file:///etc/passwd"/></svg>');
  try{assert.equal((await GET(request(192))).status,200);variant='external-svg';assert.equal((await GET(request(192))).status,200);}finally{globalThis.fetch=original;}
});
