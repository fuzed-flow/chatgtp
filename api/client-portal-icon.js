import sharp from 'sharp';
import { companyPortalInitials, publicCompanyLogo } from '../src/lib/portalInstall.js';

const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const xml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

async function readLogo(response) {
  if (!response.ok || Number(response.headers.get('content-length')) > MAX_LOGO_BYTES) throw new Error('Logo unavailable.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Logo unavailable.');
  const chunks = [];
  let bytes = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.byteLength;
    if (bytes > MAX_LOGO_BYTES) { await reader.cancel(); throw new Error('Logo too large.'); }
    chunks.push(Buffer.from(part.value));
  }
  const buffer = Buffer.concat(chunks);
  const svg = buffer.subarray(0, 1000).toString('utf8');
  if (/<svg\b/i.test(svg)) {
    const text = buffer.toString('utf8');
    const references = [...text.matchAll(/(?:href|src)\s*=\s*(["'])(.*?)\1/gi)].map(match => match[2].trim());
    const cssUrls = [...text.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)].map(match => match[2].trim());
    if (/<!DOCTYPE|<!ENTITY|@import/i.test(text) || references.some(ref => !ref.startsWith('#') && !/^data:image\/(png|jpeg|webp);base64,/i.test(ref)) || cssUrls.some(ref => !ref.startsWith('#'))) throw new Error('Unsupported logo resources.');
  }
  return buffer;
}

export function icoFromPng(png) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
  header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
  return Buffer.concat([header, png]);
}

export async function GET(request) {
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed.', { status: 405, headers: { Allow: 'GET, HEAD' } });
  const params = new URL(request.url).searchParams;
  const size = Number(params.get('size') || 192);
  const ico = params.get('format') === 'ico';
  if (![32, 180, 192, 256, 512].includes(size) || (ico && size !== 256)) return new Response('Unsupported icon size.', { status: 400 });
  const logo = publicCompanyLogo(params.get('logo'));
  const initials = xml(companyPortalInitials(params.get('label')));
  const fallback = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="white"/><text x="256" y="310" text-anchor="middle" font-family="sans-serif" font-size="180" font-weight="700" fill="#0B1538">${initials}</text></svg>`);
  let source = fallback;
  if (logo) {
    try { source = await readLogo(await fetch(logo, { redirect: 'error', signal: AbortSignal.timeout(7000) })); }
    catch { console.warn('Client portal icon is using company initials.'); }
  }
  const render = value => sharp(value, { limitInputPixels: 16_777_216, animated: false })
    .rotate().resize(size, size, { fit: 'contain', background: '#ffffff' }).flatten({ background: '#ffffff' }).png().toBuffer();
  let png;
  try { png = await render(source); }
  catch { png = await render(fallback); }
  return new Response(request.method === 'HEAD' ? null : ico ? icoFromPng(png) : png, {
    headers: {
      'Content-Type': ico ? 'image/x-icon' : 'image/png',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

export const HEAD = GET;
