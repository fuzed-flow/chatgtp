export const HELP_COLLECTIONS = [
  { id: 'getting-started', title: 'Getting started', description: 'Set up your account, invite your team, and find your way around.', areas: ['Account', 'Settings', 'Team'], icon: 'compass' },
  { id: 'sales', title: 'Leads, clients & quotes', description: 'Move an enquiry from first contact to an approved quote.', areas: ['Leads', 'Clients', 'Quotes', 'Templates', 'Pricebook'], icon: 'file' },
  { id: 'projects', title: 'Projects & planning', description: 'Organize phases, schedules, drawings, and project changes.', areas: ['Projects', 'Project Phases', 'Client Timeline', 'Plans & Elevations', 'Change Orders', 'Resource Library', 'Warranty', 'Documents'], icon: 'building' },
  { id: 'field', title: 'Field work & tasks', description: 'Keep assigned work, daily logs, and time entries up to date.', areas: ['Employee Portal', 'Contractor Portal', 'Tasks', 'Daily Logs', 'Timesheets'], icon: 'hardhat' },
  { id: 'materials', title: 'Materials & purchasing', description: 'Manage inventory, project materials, vendors, and purchase orders.', areas: ['Inventory', 'Project Materials', 'Vendors', 'Purchase Orders'], icon: 'package' },
  { id: 'business', title: 'Business & reporting', description: 'Work with invoices, payments, reports, and staff records.', areas: ['Invoices', 'Payments', 'Reports', 'HR'], icon: 'chart' },
  { id: 'portals', title: 'Client communication', description: 'Share project information and understand client access.', areas: ['Client Portal'], icon: 'users' },
  { id: 'support', title: 'Help & troubleshooting', description: 'Understand alerts, solve common issues, and get help.', areas: ['Notifications', 'Help & Support'], icon: 'lifebuoy' },
];

export const FEATURED_HELP = ['guide-getting-started', 'guide-mobile-navigation', 'guide-troubleshooting'];

export function isPublicHelpRoute(pathname) {
  return /^\/(?:ClientPortal|ContractorPortal|contractor-portal|PublicQuoteView|PublicInvoiceView|PublicPOView|PublicChangeOrderView|DocumentResponse|WarrantyResponse)(?:\/|$)/i.test(String(pathname || '').split(/[?#]/, 1)[0]);
}

export function helpArticleUrl(slug, browseParams) {
  const params = new URLSearchParams(browseParams);
  params.set('article', slug);
  return `/HelpArticles?${params.toString()}`;
}

export function helpBrowseUrl(browseParams) {
  const params = new URLSearchParams(browseParams);
  params.delete('article');
  const query = params.toString();
  return `/HelpArticles${query ? `?${query}` : ''}`;
}

export function helpReadMinutes(article) {
  if (Number.isFinite(article.read_minutes) && article.read_minutes > 0) return article.read_minutes;
  return Math.max(1, Math.ceil(String(article.answer_long || article.answer_short || '').split(/\s+/).length / 200));
}

export function helpVerifiedDate(date) {
  if (!date) return null;
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return null;
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(value);
}

export function getHelpSections(markdown) {
  const sections = [];
  const used = new Map();
  let fence = null;
  String(markdown || '').split('\n').forEach((line, index) => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1][0];
      else if (fence === marker[1][0]) fence = null;
      return;
    }
    if (fence) return;
    const match = line.match(/^\s{0,3}##\s+(.+?)(?:\s+#+)?\s*$/);
    if (!match) return;
    const title = match[1].replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '').trim();
    const base = `section-${title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'article'}`;
    const count = used.get(base) || 0;
    used.set(base, count + 1);
    sections.push({ id: `${base}${count ? `-${count + 1}` : ''}`, title, line: index + 1 });
  });
  return sections;
}

export function relatedHelpArticles(article, articles) {
  const ids = new Set(article.related_slugs || []);
  const explicit = articles.filter(item => item.slug !== article.slug && ids.has(item.slug));
  const sameTopic = articles.filter(item => item.slug !== article.slug && !ids.has(item.slug) && item.feature_area === article.feature_area)
    .sort((a, b) => Number(b.article_type === 'guide') - Number(a.article_type === 'guide') || (b.priority || 0) - (a.priority || 0));
  return [...explicit, ...sameTopic].slice(0, 4);
}
