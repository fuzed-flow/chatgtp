const ROLE_VALUES = ['owner', 'admin', 'manager', 'office', 'employee', 'subcontractor'];

export const APP_ROLES = Object.freeze([...ROLE_VALUES]);
export const OFFICE_ROLES = Object.freeze(['owner', 'admin', 'manager', 'office']);
export const ADMIN_ROLES = Object.freeze(['owner', 'admin']);
export const BILLING_ROLES = Object.freeze(['owner', 'admin', 'office']);
export const FIELD_ROLES = Object.freeze(['employee', 'subcontractor']);

const ROLE_SET = new Set(ROLE_VALUES);

// `user` was used by the retired Team Settings form. Current invitations,
// database constraints, and help content all use `employee` instead.
export function normalizeRole(role) {
  const value = typeof role === 'string' ? role.trim().toLowerCase() : '';
  if (!value || value === 'user') return 'employee';
  return ROLE_SET.has(value) ? value : 'employee';
}

export function normalizeProfileRole(profile) {
  if (!profile) return profile;
  return {
    ...profile,
    role: normalizeRole(profile.role || profile.user_role),
  };
}

export function hasModulePermission(profile, requiredPermission, permissionExemptRoles = [], planId = 'business') {
  if (!requiredPermission) return true;
  if (!profile || profile.is_active === false) return false;

  const role = normalizeRole(profile.role || profile.user_role);
  if (ADMIN_ROLES.includes(role) || permissionExemptRoles.includes(role)) return true;
  if (!['manager', 'office'].includes(role)) return false;

  // Per-user module permissions are a Business-plan feature. Older or
  // downgraded accounts can retain a stale permissions array, but it must not
  // hide their role's default navigation on plans where that array cannot be
  // managed. The database authorization helper applies the same rule.
  if (planId !== 'business') return true;

  const permissions = Array.isArray(profile.permissions) ? profile.permissions : [];
  return permissions.length === 0 || permissions.includes(requiredPermission);
}

const access = (requiredPermission, allowedRoles = OFFICE_ROLES, permissionExemptRoles = []) => Object.freeze({
  allowedRoles,
  ...(requiredPermission ? { requiredPermission } : {}),
  ...(permissionExemptRoles.length ? { permissionExemptRoles } : {}),
});

const PROJECT_PAGES = ['PMDashboard', 'PMProjectWorkspace', 'PMProjects', 'PMTimeline', 'ProjectDetail', 'ClientUpdates', 'ProjectCloseouts'];
const QUOTE_PAGES = ['Quotes', 'QuoteBuilder', 'QuoteView'];
const CHANGE_ORDER_PAGES = ['ChangeOrders', 'ChangeOrderBuilder', 'ChangeOrderView'];
const PURCHASE_ORDER_PAGES = ['PurchaseOrders', 'PurchaseOrderDetail', 'PurchaseOrderView'];
const INVOICE_PAGES = ['Invoices', 'InvoiceBuilder', 'InvoiceView'];

const ROUTE_ACCESS = {
  Dashboard: access('dashboard'),
  LeadTracker: access('leads'),
  LeadDetail: access('leads'),
  Clients: access('clients'),
  ClientDetail: access('clients'),
  Templates: access('templates'),
  Approvals: access('approvals'),
  DailyLogs: access('DailyLogs'),
  Tasks: access('tasks'),
  Vendors: access('vendors'),
  Products: access('products'),
  Inventory: access('inventory'),
  ClientForms: access('client_forms'),
  Reports: access('reports'),
  SalesPerformance: access('reports'),
  StrategicGoals: access('reports'),
  AdminSettings: access('settings', ['owner', 'admin', 'manager']),
  Settings: access('settings', ['owner', 'admin', 'manager']),
  HumanResources: access('human_resources', BILLING_ROLES),
  EmployeePortal: access(null, APP_ROLES),
  Timesheet: access(null, APP_ROLES),
  Warranty: access('projects', APP_ROLES, FIELD_ROLES),
  DocumentRequests: access(null, APP_ROLES),
};

for (const page of PROJECT_PAGES) ROUTE_ACCESS[page] = access('projects');
for (const page of QUOTE_PAGES) ROUTE_ACCESS[page] = access('quotes');
for (const page of CHANGE_ORDER_PAGES) ROUTE_ACCESS[page] = access('change_orders');
for (const page of PURCHASE_ORDER_PAGES) ROUTE_ACCESS[page] = access('purchase_orders');
for (const page of INVOICE_PAGES) ROUTE_ACCESS[page] = access('invoices', BILLING_ROLES);

export function getRouteAccess(page) {
  // Route registration is centralized, so an omitted access declaration must
  // fail closed instead of silently granting a future page to every office
  // role.
  return ROUTE_ACCESS[page] || access(null, []);
}
