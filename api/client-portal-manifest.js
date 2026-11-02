import { clientPortalManifest } from '../src/lib/portalInstall.js';

export function GET(request) {
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed.', { status: 405, headers: { Allow: 'GET, HEAD' } });
  const headers = {
    'Content-Type': 'application/manifest+json; charset=utf-8',
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
    'X-Content-Type-Options': 'nosniff',
  };
  try {
    const url = new URL(request.url);
    if (url.search.length > 7000) throw new Error('Manifest request is too large.');
    const manifest = clientPortalManifest(url.searchParams);
    return new Response(request.method === 'HEAD' ? null : JSON.stringify(manifest), { headers });
  } catch {
    // Never log capability-bearing manifest URLs or private start links.
    return new Response('This client portal link is unavailable.', { status: 400, headers });
  }
}

export const HEAD = GET;
