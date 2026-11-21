export function portalAssetUrl(clientId, token, kind = 'manifest', size = 512) {
  const params = new URLSearchParams({ client: clientId, token, kind });
  if (kind === 'icon') params.set('size', String(size));
  return `/api/client-portal-assets?${params}`;
}

export function clientPortalManifest(clientId, token, company) {
  return {
    id: `/ClientPortal?id=${encodeURIComponent(clientId)}`,
    name: `${company.name || 'Your Contractor'} Client Portal`,
    short_name: 'Client Portal',
    description: `Your project documents and updates from ${company.name || 'your contractor'}.`,
    start_url: `/ClientPortal?${new URLSearchParams({ id: clientId, portal_token: token })}`,
    scope: '/ClientPortal',
    display: 'standalone',
    theme_color: '#0f172a',
    background_color: '#ffffff',
    icons: [192, 512].map(size => ({ src: portalAssetUrl(clientId, token, 'icon', size), sizes: `${size}x${size}`, type: 'image/png', purpose: 'any' })),
  };
}
