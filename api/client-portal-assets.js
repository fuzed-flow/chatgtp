import sharp from 'sharp';
import { clientPortalManifest } from '../src/lib/clientPortalManifest.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') return res.status(405).end();
  const { client, token, kind, size } = req.query;
  if (typeof client !== 'string' || !/^[\da-f-]{36}$/i.test(client)
    || typeof token !== 'string' || token.length < 32 || token.length > 256
    || !['manifest', 'icon'].includes(kind)) return res.status(400).end();
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return res.status(503).end();
  try {
    const result = await fetch(`${url}/rest/v1/rpc/get_client_portal_bundle`, {
      method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_client: client, p_token: token }), signal: AbortSignal.timeout(10000),
    });
    if (!result.ok) return res.status(403).end();
    const { company } = await result.json();
    if (!company) return res.status(403).end();
    if (kind === 'manifest') {
      res.setHeader('Content-Type', 'application/manifest+json');
      return res.status(200).send(JSON.stringify(clientPortalManifest(client, token, company)));
    }
    const dimension = size === '192' ? 192 : 512;
    let image;
    const logo = company.logo_url || company.company_logo_url;
    if (logo) {
      const logoUrl = new URL(logo);
      // Only retrieve uploaded assets from this project's storage, never arbitrary URLs.
      if (logoUrl.origin === new URL(url).origin && logoUrl.pathname.startsWith('/storage/v1/object/public/')) {
        const response = await fetch(logoUrl, { signal: AbortSignal.timeout(10000), redirect: 'error' });
        if (response.ok && Number(response.headers.get('content-length') || 0) <= 5_000_000) {
          const bytes = Buffer.from(await response.arrayBuffer());
          if (bytes.length <= 5_000_000) image = sharp(bytes, { limitInputPixels: 16_000_000 });
        }
      }
    }
    if (!image) {
      const initials = (company.name || 'CP').replace(/[^a-z0-9 ]/gi, '').split(/\s+/).map(word => word[0] || '').join('').slice(0, 2).toUpperCase();
      image = sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" rx="80" fill="#0f172a"/><text x="256" y="300" text-anchor="middle" font-family="sans-serif" font-size="180" fill="white">${initials}</text></svg>`));
    }
    const png = await image.resize(dimension, dimension, { fit: 'contain', background: '#ffffff' }).png().toBuffer();
    res.setHeader('Content-Type', 'image/png');
    return res.status(200).send(png);
  } catch {
    return res.status(503).end();
  }
}
