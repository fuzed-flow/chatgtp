function sameId(left, right) {
  return left !== null && left !== undefined && right !== null && right !== undefined && String(left) === String(right);
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function getDocumentContactName(record = {}, clients = [], leads = []) {
  const client = record.client_id ? clients.find(item => sameId(item.id, record.client_id)) : null;
  if (client) {
    const fullName = [clean(client.first_name), clean(client.surname)].filter(Boolean).join(" ");
    return clean(client.name) || fullName || clean(client.primary_contact_name) || "Unnamed Client";
  }

  const lead = record.lead_id ? leads.find(item => sameId(item.id, record.lead_id)) : null;
  if (lead) return clean(lead.contact_name) || clean(lead.name) || "Unnamed Lead";

  if (record.client_id) return "Unknown Client";
  if (record.lead_id) return "Unknown Lead";
  return "No client or lead linked";
}
