import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";
import Stripe from "npm:stripe@22.6.0";
import { checkoutAmount, checkoutReturnUrl, currencyFactor } from "../_shared/checkout.js";
type PaymentDocument = {id:string;company_id:string;status:string;total:number;amount_paid?:number;deposit_amount?:number;deposit_paid_amount?:number;quote_number?:string;invoice_number?:string;is_template?:boolean;has_payment_schedule?:boolean};
type AccessMode = "public" | "staff";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const invoiceTokenPattern = /^[a-f0-9]{64}$/i;
const quoteTokenPattern = /^[a-z0-9_-]{32,256}$/i;

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function hasModulePermission(permissions: unknown, module: string) {
  if (permissions == null) return true;
  if (Array.isArray(permissions)) return permissions.length === 0 || permissions.includes(module);
  if (typeof permissions === "object") return Object.keys(permissions as Record<string, unknown>).length === 0 || Object.prototype.hasOwnProperty.call(permissions, module);
  return false;
}

async function hasStaffAccess(req: Request, db: any, document: PaymentDocument, kind: "quote" | "invoice") {
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!bearer) return false;
  if (serviceKey && bearer === serviceKey) return true;

  const { data: auth, error: authError } = await db.auth.getUser(bearer);
  if (authError || !auth?.user?.id) return false;
  const { data: profile, error: profileError } = await db.from("profiles")
    .select("company_id,is_active,role,permissions")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (profileError || profile?.company_id !== document.company_id || profile.is_active === false) return false;
  if (["owner", "admin"].includes(profile.role)) return true;
  if (profile.role !== "office") return false;

  const { data: company, error: companyError } = await db.from("companies")
    .select("plan_id")
    .eq("id", document.company_id)
    .maybeSingle();
  if (companyError || !company) return false;
  return company.plan_id !== "business" || hasModulePermission(profile.permissions, kind === "quote" ? "quotes" : "invoices");
}

async function hasPublicAccess(db: any, kind: "quote" | "invoice", document: PaymentDocument, token: unknown) {
  if (typeof token !== "string" || !(kind === "quote" ? quoteTokenPattern : invoiceTokenPattern).test(token)) return false;

  if (kind === "quote") {
    const { data: approval, error } = await db.from("quote_approvals")
      .select("id,approval_status")
      .eq("quote_id", document.id)
      .eq("company_id", document.company_id)
      .eq("approval_token", token)
      .maybeSingle();
    return !error && Boolean(approval) && String(approval.approval_status || "").toLowerCase() !== "revoked";
  }

  const tokenHash = await sha256(token);
  const { data: share, error } = await db.from("invoice_share_links")
    .select("id,status,revoked_at,expires_at")
    .eq("invoice_id", document.id)
    .eq("company_id", document.company_id)
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error || !share || share.status !== "Active" || share.revoked_at) return false;
  return !share.expires_at || new Date(share.expires_at).getTime() > Date.now();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });
  try {
    const body = await req.json();
    const kind = body.quote_id ? "quote" : "invoice";
    const id = body.quote_id || body.invoice_id;
    if (!/^[0-9a-f-]{36}$/i.test(id || "") || (!!body.quote_id && !!body.invoice_id)) throw new Error("Provide one valid quote or invoice ID.");
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const fields = kind === "quote" ? "id,company_id,quote_number,status,total,deposit_amount,deposit_paid_amount,is_template" : "id,company_id,invoice_number,status,total,amount_paid,has_payment_schedule";
    const { data: document, error } = await db.from(kind === "quote" ? "quotes" : "invoices").select(fields as string).eq("id", id).single<PaymentDocument>();
    if (error || !document || document.is_template === true || (kind === "invoice" && !["Sent", "Viewed", "Partial", "Partially Paid", "Overdue", "Past Due", "Issued"].includes(document.status))) throw new Error("Document unavailable.");

    // A supplied share token always selects public mode. This prevents a signed-in
    // browser from using a public link to smuggle a custom amount or return URL.
    let accessMode: AccessMode;
    if (body.token !== undefined) {
      if (!await hasPublicAccess(db, kind, document, body.token)) throw new Error("Document unavailable.");
      accessMode = "public";
    } else {
      if (!await hasStaffAccess(req, db, document, kind)) throw new Error("Document unavailable.");
      accessMode = "staff";
    }

    let amount = checkoutAmount(document, kind, undefined);
    if (kind === 'invoice' && document.has_payment_schedule) {
      const { data: schedule, error: scheduleError } = await db.from('invoice_payment_schedules').select('amount,amount_type,percentage,amount_paid,sort_order').eq('invoice_id', id).eq('company_id', document.company_id).order('sort_order');
      if (scheduleError) throw new Error('Payment schedule unavailable.');
      const due = row => (row.amount_type === 'percentage' ? Number(document.total) * Number(row.percentage || 0) / 100 : Number(row.amount || 0)) - Number(row.amount_paid || 0);
      const next = (schedule || []).find(row => due(row) > 0);
      if (next) amount = Math.min(amount, due(next));
    }
    const { data: company, error: companyError } = await db.from("companies").select("stripe_account_id,settings").eq("id", document.company_id).single();
    if (companyError || !company?.stripe_account_id) throw new Error("Online payments are not connected for this company.");
    const currency = String(company.settings?.currency || "cad").toLowerCase();
    if (!/^[a-z]{3}$/.test(currency)) throw new Error("Invalid document currency.");
    const factor = currencyFactor(currency);
    const unitAmount = Math.round(amount * factor);
    if (unitAmount <= 0) throw new Error("The payment amount is too small.");
    const appUrl = Deno.env.get("APP_URL") || "https://app.fuzedflow.com";
    const docPath = kind === "quote" ? "PublicQuoteView" : "PublicInvoiceView";
    const docUrl = new URL(`/${docPath}?id=${id}`, appUrl);
    if (accessMode === "public") docUrl.searchParams.set("token", body.token);
    const success = new URL(docUrl); success.searchParams.set("payment", "success");
    const cancel = new URL(docUrl); cancel.searchParams.set("payment", "cancelled");
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2026-08-26.dahlia", httpClient: Stripe.createFetchHttpClient() });
    const suffix = [...crypto.getRandomValues(new Uint8Array(8))].map(n => String.fromCharCode(97 + n % 26)).join("");
    const metadata = { company_id: document.company_id, [`${kind}_id`]: id, currency_factor: String(factor) };
    const session = await stripe.checkout.sessions.create({
      mode: "payment", integration_identifier: `fuzedflow_document_${suffix}`,
      line_items: [{ price_data: { currency, product_data: { name: `${kind === "quote" ? "Quote deposit" : "Invoice"} #${document[`${kind}_number`] || id}` }, unit_amount: unitAmount }, quantity: 1 }],
      metadata, payment_intent_data: { metadata },
      success_url: accessMode === "public" ? success.toString() : checkoutReturnUrl(body.success_url, success.toString(), appUrl),
      cancel_url: accessMode === "public" ? cancel.toString() : checkoutReturnUrl(body.cancel_url, cancel.toString(), appUrl),
    }, { stripeAccount: company.stripe_account_id, idempotencyKey: `${kind}:${id}:${currency}:${unitAmount}:${Math.floor(Date.now() / 600000)}` });
    return Response.json({ url: session.url, checkout_url: session.url, sessionId: session.id }, { headers: cors });
  } catch (error) {
    console.error("Document checkout failed", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: error instanceof Error ? error.message : "Unable to create checkout." }, { status: 400, headers: cors });
  }
});
