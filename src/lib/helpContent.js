export const FIELD_HELP_AREAS = ['Account', 'Employee Portal', 'Timesheets', 'Inventory', 'Daily Logs', 'Tasks', 'Notifications', 'Help & Support'];

export function canReadHelp(article, role = 'employee') {
  if (['owner', 'admin'].includes(role)) return true;
  if (article.requires_admin || article.audience === 'admin') return false;
  if (['manager', 'office'].includes(role)) return true;
  return article.audience !== 'office' && FIELD_HELP_AREAS.includes(article.feature_area);
}

export function helpPageRoute(route, role) {
  if (!route || !/^\/[a-zA-Z]/.test(route) || route.startsWith('//') || /[\\\s]/.test(route)) return null;
  const pathname = route.split(/[?#]/, 1)[0];
  if (['employee', 'subcontractor', 'user'].includes(role)) {
    if (['/EmployeePortal', '/HelpArticles', '/FAQ', '/Contact', '/Tutorials', '/login', '/signup'].includes(pathname)) return route;
    const fieldRoutes = { '/Timesheet': '/EmployeePortal?tab=timesheets', '/Inventory': '/EmployeePortal?tab=inventory', '/DailyLogs': '/EmployeePortal?tab=daily_logs', '/Tasks': '/EmployeePortal?tab=tasks' };
    return fieldRoutes[pathname] || null;
  }
  if (role === 'office' && pathname === '/AdminSettings') return null;
  if (role === 'manager' && ['/Invoices', '/HumanResources'].includes(pathname)) return null;
  return route;
}

const normalize = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function findHelpArticles(articles, query, category = 'all') {
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  return articles.filter(article => {
    if (category !== 'all' && article.feature_area !== category) return false;
    const text = normalize([article.question, article.answer_short, article.answer_long, article.feature_area, ...(article.search_terms || [])].join(' '));
    return terms.every(term => text.includes(term));
  }).sort((a, b) => {
    const score = article => terms.filter(term => normalize(article.question).includes(term)).length;
    return score(b) - score(a) || (b.priority || 0) - (a.priority || 0) || a.question.localeCompare(b.question);
  });
}
