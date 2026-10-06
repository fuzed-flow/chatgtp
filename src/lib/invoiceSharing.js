import { supabase } from "@/api/supabaseClient";

export function buildPublicInvoiceUrl(origin, invoiceId, token) {
  if (!origin || !invoiceId || !token) throw new Error("A secure invoice link requires an invoice and token.");
  const url = new URL("/PublicInvoiceView", origin);
  url.searchParams.set("id", invoiceId);
  url.searchParams.set("token", token);
  return url.toString();
}

export function buildClientPortalInvoiceUrl(origin, clientId, token) {
  if (!origin || !clientId || !token) throw new Error("A secure portal link requires a client and invoice token.");
  const url = new URL("/ClientPortal", origin);
  url.searchParams.set("id", clientId);
  url.searchParams.set("tab", "invoices");
  url.searchParams.set("invoice_token", token);
  return url.toString();
}

export async function issueInvoiceShareToken(invoiceId) {
  if (!invoiceId) throw new Error("Save the invoice before creating a client link.");
  const { data, error } = await supabase.rpc("issue_invoice_share_token", { p_invoice: invoiceId });
  if (error || typeof data !== "string" || !/^[a-f0-9]{64}$/i.test(data)) {
    throw error || new Error("A secure invoice link could not be created.");
  }
  return data;
}

export async function getPublicInvoiceBundle(invoiceId, token) {
  if (!invoiceId || !token) throw new Error("This invoice link is incomplete.");
  const { data, error } = await supabase.rpc("get_public_invoice_bundle", {
    p_invoice: invoiceId,
    p_token: token,
  });
  if (error || !data?.invoice) throw error || new Error("This invoice is unavailable.");
  return data;
}

export async function trackPublicInvoiceView(invoiceId, token) {
  const { error } = await supabase.rpc("track_public_invoice_view", {
    p_invoice: invoiceId,
    p_token: token,
  });
  if (error) throw error;
}

export async function getClientPortalInvoices(clientId, token) {
  if (!clientId || !token) return [];
  const { data, error } = await supabase.rpc("get_client_portal_invoices", {
    p_client: clientId,
    p_token: token,
  });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export function publicInvoiceErrorMessage(error, fallback = "This invoice is unavailable. Ask your contractor to resend the secure link.") {
  const message = String(error?.message || "");
  if (/invalid|unavailable|permission|42501/i.test(message)) return "This secure invoice link is invalid or no longer available.";
  return fallback;
}
