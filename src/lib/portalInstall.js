const BASE = 'https://portal.invalid';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const PORTAL_PARAMS = ['id', 'portal_token', 'quote_token', 'invoice_token', 'co_token', 'tab', 'update', 'closeout'];
const LOGO_ORIGIN = 'https://ochqexofahdssmarnict.supabase.co';

export function companyPortalName(value) {
  return String(value || 'Your Company').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'Your Company';
}

export function companyPortalInitials(value) {
  return companyPortalName(value).split(/\s+/).slice(0, 2).map(word => Array.from(word)[0]).join('').toUpperCase();
}

export function publicCompanyLogo(value) {
  try {
    const url = new URL(value);
    if (url.origin !== LOGO_ORIGIN || url.username || url.password || url.search || url.hash
      || !url.pathname.startsWith('/storage/v1/object/public/') || url.href.length > 1800) return null;
    return url.href;
  } catch { return null; }
}

export function clientPortalStartUrl(href, clientId) {
  if (!UUID.test(clientId || '')) throw new Error('A saved client portal is required.');
  const url = new URL(href, BASE);
  if (url.pathname !== '/ClientPortal' || url.searchParams.get('id') !== clientId || url.href.length > 5000) {
    throw new Error('Open this client’s private portal link before saving it.');
  }
  const result = new URL('/ClientPortal', BASE);
  for (const key of PORTAL_PARAMS) {
    const value = url.searchParams.get(key);
    if (value) result.searchParams.set(key, value);
  }
  return result.pathname + result.search;
}

export function portalIconUrl({ logo, companyName, size = 192, format = 'png' }) {
  const params = new URLSearchParams({ label: companyPortalName(companyName), size: String(size) });
  const safeLogo = publicCompanyLogo(logo);
  if (safeLogo) params.set('logo', safeLogo);
  if (format === 'ico') params.set('format', 'ico');
  return `/api/client-portal-icon?${params}`;
}

export function portalInstallMetadata({ href, clientId, company }) {
  const companyName = companyPortalName(company?.name);
  const logo = publicCompanyLogo(company?.logo_url) || publicCompanyLogo(company?.company_logo_url);
  const startUrl = clientPortalStartUrl(href, clientId);
  const params = new URLSearchParams({ client: clientId, company: companyName, start: startUrl });
  if (logo) params.set('logo', logo);
  return {
    companyName, logo, startUrl,
    manifestUrl: `/api/client-portal-manifest?${params}`,
    iconUrl: portalIconUrl({ logo, companyName }),
    appleIconUrl: portalIconUrl({ logo, companyName, size: 180 }),
    faviconUrl: portalIconUrl({ logo, companyName, size: 32 }),
    desktopIconUrl: portalIconUrl({ logo, companyName, size: 256, format: 'ico' }),
  };
}

export function clientPortalManifest(params) {
  const clientId = params.get('client');
  const rawStart = params.get('start') || '';
  const start = new URL(rawStart, BASE);
  if (!rawStart.startsWith('/ClientPortal?') || start.origin !== BASE) throw new Error('Invalid client portal start link.');
  const startUrl = clientPortalStartUrl(start.href, clientId);
  const companyName = companyPortalName(params.get('company'));
  const logo = publicCompanyLogo(params.get('logo'));
  return {
    id: `/ClientPortal?id=${encodeURIComponent(clientId)}`,
    name: 'Client Portal', short_name: 'Client Portal',
    description: `${companyName} client portal`,
    start_url: startUrl, scope: '/ClientPortal', display: 'standalone',
    theme_color: '#0B1538', background_color: '#ffffff',
    icons: [192, 512].map(size => ({ src: portalIconUrl({ logo, companyName, size }), sizes: `${size}x${size}`, type: 'image/png', purpose: 'any' })),
  };
}

export function portalDesktopShortcut({ href, metadata, platform }) {
  const origin = new URL(href).origin;
  const url = new URL(metadata.startUrl, origin).href;
  const icon = new URL(metadata.desktopIconUrl, origin).href;
  if (platform === 'mac') {
    const xml = url.replace(/[<>&"']/g, value => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[value]));
    return { name: 'Client Portal.webloc', type: 'application/x-apple-webloc', content: `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>URL</key><string>${xml}</string></dict></plist>\n` };
  }
  return { name: 'Client Portal.url', type: 'application/internet-shortcut', content: `[InternetShortcut]\r\nURL=${url}\r\nIconFile=${icon}\r\nIconIndex=0\r\n` };
}

export function applyPortalInstallMetadata(doc, metadata) {
  const originalTitle = doc.title;
  const restores = [];
  const change = (selector, tag, attributes, key, value) => {
    let element = doc.head.querySelector(selector);
    const created = !element;
    if (created) {
      element = doc.createElement(tag);
      Object.entries(attributes).forEach(([name, content]) => element.setAttribute(name, content));
      doc.head.appendChild(element);
    }
    const before = element.getAttribute(key);
    element.setAttribute(key, value);
    restores.push(() => {
      if (created) element.remove();
      else if (before === null) element.removeAttribute(key);
      else element.setAttribute(key, before);
    });
  };
  doc.title = 'Client Portal';
  change('link[rel="manifest"]', 'link', { rel: 'manifest' }, 'href', metadata.manifestUrl);
  change('link[rel="apple-touch-icon"]', 'link', { rel: 'apple-touch-icon', sizes: '180x180' }, 'href', metadata.appleIconUrl);
  change('link[rel="icon"]', 'link', { rel: 'icon', type: 'image/png', sizes: '32x32' }, 'href', metadata.faviconUrl);
  change('meta[name="apple-mobile-web-app-title"]', 'meta', { name: 'apple-mobile-web-app-title' }, 'content', 'Client Portal');
  change('meta[name="application-name"]', 'meta', { name: 'application-name' }, 'content', 'Client Portal');
  return () => { restores.reverse().forEach(restore => restore()); doc.title = originalTitle; };
}
