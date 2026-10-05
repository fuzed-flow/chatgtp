const DESTINATIONS = new Set(["QuoteBuilder", "InvoiceBuilder", "ChangeOrderBuilder", "ProjectDetail", "PMProjectWorkspace", "Tasks", "EmployeePortal", "HumanResources", "AdminSettings", "PurchaseOrderDetail", "Inventory", "Vendors", "ClientDetail", "DailyLogs", "PMTimeline", "Approvals", "LeadDetail", "Warranty", "DocumentRequests", "Contact", "HelpArticles", "FAQ"]);

export function notificationLink(notification, role) {
  const fieldRole = ["employee", "subcontractor"].includes(role);
  const value = fieldRole ? notification.metadata?.employee_url : notification.action_url;
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  try {
    const url = new URL(value, "https://fuzedflow.local");
    if (url.origin !== "https://fuzedflow.local" || !DESTINATIONS.has(url.pathname.slice(1))) return null;
    if (fieldRole && !["/EmployeePortal", "/Warranty", "/DocumentRequests", "/Contact", "/HelpArticles", "/FAQ"].includes(url.pathname)) return null;
    return url.pathname + url.search;
  } catch { return null; }
}
