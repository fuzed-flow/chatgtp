import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { clientPortalStartUrl, portalInstallMetadata, clientPortalManifest, portalDesktopShortcut, applyPortalInstallMetadata, publicCompanyLogo } from '../../src/lib/portalInstall.js';
import { GET as manifestEndpoint } from '../../api/client-portal-manifest.js';
const client='00000000-0000-4000-8000-000000000001';
const logo='https://ochqexofahdssmarnict.supabase.co/storage/v1/object/public/logos/company.png';
const href=`https://app.fuzedflow.com/ClientPortal?id=${client}&tab=communications&portal_token=private-token&quote_token=private-quote&utm_source=email#section`;
const company={name:'Sample Company',logo_url:logo};
const metadata=portalInstallMetadata({href,clientId:client,company});

test('installed portal keeps private capabilities and client identity while stripping tracking and fragments',()=>{
  const start=new URL(metadata.startUrl,'https://app.fuzedflow.com');
  assert.equal(start.pathname,'/ClientPortal');assert.equal(start.searchParams.get('id'),client);assert.equal(start.searchParams.get('portal_token'),'private-token');assert.equal(start.searchParams.get('quote_token'),'private-quote');assert.equal(start.searchParams.get('tab'),'communications');
  assert.equal(start.searchParams.has('utm_source'),false);assert.equal(start.hash,'');
  assert.throws(()=>clientPortalStartUrl(href,'different-client'));
  assert.throws(()=>clientPortalStartUrl('https://app.fuzedflow.com/Login?id='+client,client));
});

test('manifest has a stable per-client ID, company icons, exact shortcut name and no staff workspace shortcuts',()=>{
  const manifest=clientPortalManifest(new URL(metadata.manifestUrl,'https://app.fuzedflow.com').searchParams);
  assert.equal(manifest.name,'Client Portal');assert.equal(manifest.short_name,'Client Portal');assert.equal(manifest.id,`/ClientPortal?id=${client}`);assert.equal(manifest.scope,'/ClientPortal');
  assert.equal(manifest.start_url,metadata.startUrl);assert.equal(manifest.display,'standalone');assert.equal(manifest.shortcuts,undefined);
  assert.deepEqual(manifest.icons.map(icon=>icon.sizes),['192x192','512x512']);assert.ok(manifest.icons.every(icon=>icon.src.includes(encodeURIComponent(logo))));
  const rotated=new URL(metadata.manifestUrl,'https://app.fuzedflow.com');rotated.searchParams.set('start',metadata.startUrl.replace('private-token','rotated-token'));
  assert.equal(clientPortalManifest(rotated.searchParams).id,manifest.id);
});

test('manifest endpoint validates same-origin portal destinations and never caches private start links',async()=>{
  const response=manifestEndpoint(new Request(new URL(metadata.manifestUrl,'https://app.fuzedflow.com')));
  assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/application\/manifest\+json/);assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.equal(response.headers.get('referrer-policy'),'no-referrer');assert.equal((await response.json()).name,'Client Portal');
  for(const bad of ['https://evil.invalid/ClientPortal?id='+client,'//evil.invalid/ClientPortal?id='+client,'/Login?id='+client,'/ClientPortal?id=other']){
    const url=new URL(metadata.manifestUrl,'https://app.fuzedflow.com');url.searchParams.set('start',bad);assert.equal(manifestEndpoint(new Request(url)).status,400);
  }
  assert.equal(manifestEndpoint(new Request('https://app.fuzedflow.com/api/client-portal-manifest')).status,400);
  assert.equal(manifestEndpoint(new Request(new URL(metadata.manifestUrl,'https://app.fuzedflow.com'),{method:'HEAD'})).body,null);
  assert.equal(manifestEndpoint(new Request(new URL(metadata.manifestUrl,'https://app.fuzedflow.com'),{method:'POST'})).status,405);
});

test('branding head changes restore the staff manifest, icon, app name and title exactly on portal exit',()=>{
  const dom=new JSDOM('<title>Fuzed Flow</title><link rel="manifest" href="/manifest.json"><link rel="apple-touch-icon" href="/apple.png"><link rel="icon" href="/favicon.png"><meta name="application-name" content="FuzedFlow"><meta name="apple-mobile-web-app-title" content="FuzedFlow">');
  const doc=dom.window.document,before=doc.head.innerHTML;const restore=applyPortalInstallMetadata(doc,metadata);
  assert.equal(doc.title,'Client Portal');assert.equal(doc.querySelector('link[rel=manifest]').getAttribute('href'),metadata.manifestUrl);assert.equal(doc.querySelector('link[rel=apple-touch-icon]').getAttribute('href'),metadata.appleIconUrl);
  assert.equal(doc.querySelector('meta[name=apple-mobile-web-app-title]').content,'Client Portal');restore();assert.equal(doc.head.innerHTML,before);dom.window.close();
});

test('Windows and Mac downloads use the exact Client Portal name and original private destination',()=>{
  const windows=portalDesktopShortcut({href,metadata,platform:'windows'});assert.equal(windows.name,'Client Portal.url');assert.ok(windows.content.includes('URL=https://app.fuzedflow.com/ClientPortal?id='+client));assert.ok(windows.content.includes('portal_token=private-token'));
  assert.ok(windows.content.includes('IconFile=https://app.fuzedflow.com/api/client-portal-icon?'));assert.ok(windows.content.includes('format=ico'));
  const mac=portalDesktopShortcut({href,metadata,platform:'mac'});assert.equal(mac.name,'Client Portal.webloc');const dom=new JSDOM(mac.content,{contentType:'text/xml'});assert.ok(dom.window.document.querySelector('string').textContent.includes('portal_token=private-token'));dom.window.close();
});

test('only the existing public company-storage origin is eligible for server-side logo fetching',()=>{
  assert.equal(publicCompanyLogo(logo),logo);
  for(const bad of ['http://127.0.0.1/logo.png','https://evil.invalid/logo.png','file:///etc/passwd','data:image/svg+xml,svg','https://ochqexofahdssmarnict.supabase.co/auth/v1/user',logo+'?token=secret',logo.replace('/logos/','/../../')])assert.equal(publicCompanyLogo(bad),null);
  const fallback=portalInstallMetadata({href,clientId:client,company:{name:'Sample Company',company_logo_url:logo}});assert.equal(fallback.logo,logo);
});

test('API functions bypass the SPA rewrite and existing app/notification-worker assets remain unchanged',async()=>{
  const config=JSON.parse(await readFile(new URL('../../vercel.json',import.meta.url),'utf8'));
  const source=config.rewrites[0].source;const pattern=new RegExp('^'+source+'$');
  assert.equal(pattern.test('/api/client-portal-icon'),false);assert.equal(pattern.test('/api/client-portal-manifest'),false);assert.equal(pattern.test('/ClientPortal'),true);assert.equal(pattern.test('/LeadDetail'),true);
  const rootManifest=JSON.parse(await readFile(new URL('../../public/manifest.json',import.meta.url),'utf8'));assert.equal(rootManifest.name,'FuzedFlow Trade Management');assert.equal(rootManifest.start_url,'/');
});
