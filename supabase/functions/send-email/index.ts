import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const documents = {
  quote: { table: "quotes", number: "quote_number", label: "Quote", fields: "quote_number,client_id,lead_id" },
  change_order: { table: "change_orders", number: "change_order_number", label: "Change Order", fields: "change_order_number,client_id,project_id" },
  invoice: { table: "invoices", number: "invoice_number", label: "Invoice", fields: "invoice_number,client_id" },
};

// Keep company-contact validation aligned with src/lib/emailCopy.js.
function validCompanyEmail(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const email = value.trim();
  const localPart = email.split("@")[0];
  return email.length <= 254 && localPart.length <= 64
    && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(email)
    && !localPart.startsWith(".") && !localPart.endsWith(".") && !localPart.includes("..");
}

function subjectText(value: unknown) {
  return typeof value === "string" ? value.replace(/[\r\n]+/g, " ").trim() : "";
}

async function copyContext(supabase: any, companyId: string, body: any) {
  if (!Object.prototype.hasOwnProperty.call(documents, body.document_type)
    || !uuidPattern.test(body.document_id || "") || !uuidPattern.test(body.request_id || "")) {
    throw new Error("A saved document and valid send request are required for a company copy.");
  }
  const definition = documents[body.document_type as keyof typeof documents];
  const { data: company, error: companyError } = await supabase.from("companies")
    .select("name,settings").eq("id", companyId).single();
  if (companyError || !company || !validCompanyEmail(company.settings?.email)) {
    throw new Error("Add a valid company email in Settings to receive a copy.");
  }
  const { data: document, error: documentError } = await supabase.from(definition.table)
    .select(definition.fields).eq("id", body.document_id).eq("company_id", companyId).single();
  if (documentError || !document) throw new Error("The document was not found in your company.");

  let clientId = document.client_id || null;
  if (body.document_type === "change_order" && document.project_id) {
    const { data: project, error } = await supabase.from("projects")
      .select("client_id").eq("id", document.project_id).eq("company_id", companyId).single();
    if (error || !project) throw new Error("The document's project was not found in your company.");
    clientId = project.client_id || clientId;
  }
  let clientName = "";
  if (clientId) {
    const { data: client, error } = await supabase.from("clients")
      .select("name").eq("id", clientId).eq("company_id", companyId).single();
    if (error || !client) throw new Error("The document's client was not found in your company.");
    clientName = subjectText(client.name);
  } else if (body.document_type === "quote" && document.lead_id) {
    const { data: lead, error } = await supabase.from("leads")
      .select("contact_name").eq("id", document.lead_id).eq("company_id", companyId).single();
    if (error || !lead) throw new Error("The document's lead was not found in your company.");
    clientName = subjectText(lead.contact_name);
  }
  const companyName = subjectText(company.name);
  const number = subjectText(document[definition.number]).replace(/^#+\s*/, "");
  if (!companyName || !number || !clientName) {
    throw new Error("Save the company name, document number and client name before requesting a copy.");
  }
  return {
    recipient: company.settings.email.trim(), clientId,
    subject: `[COPY] ${definition.label} from ${companyName} - ${definition.label} #${number} for ${clientName}`,
  };
}

async function sendViaResend(payload: any, apiKey: string, idempotencyKey?: string) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json",
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST", headers, body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error("The email provider could not accept the email. Please retry.");
  if (!uuidPattern.test(data?.id || "")) throw new Error("Email delivery could not be confirmed. Please retry.");
  return data;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let originalAttempted = false;
  try {
    const body = await req.json();
    const { to_email, subject, html_body, client_id, attachment_url, reply_to, attachments, company_id: payloadCompanyId } = body;

    if (!to_email || !subject || !html_body) {
      throw new Error("Missing required email fields.");
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) throw new Error("Sign in before sending an email.");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseAnonKey || !serviceKey) {
      throw new Error("Email service configuration is unavailable.");
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const token = authHeader.replace("Bearer ", "").trim();

    let companyId;
    let userId = null;

    // Existing reminders authenticate with the actual service key and company ID.
    if (token === serviceKey) {
      if (!payloadCompanyId) {
        throw new Error("Automated requests must include company_id.");
      }
      companyId = payloadCompanyId;
    } else {
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);

      if (authError || !user) {
        throw new Error("Your session expired. Sign in before sending an email.");
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("company_id,is_active")
        .eq("id", user.id)
        .single();

      if (profileError || !profile?.company_id || profile.is_active === false) {
        throw new Error("An active company account is required to send an email.");
      }

      companyId = profile.company_id;
      userId = user.id;
    }

    if (body.request_id !== undefined && !uuidPattern.test(body.request_id || "")) {
      throw new Error("The send request identifier is invalid.");
    }
    // Resolve and validate all copy details before delivering the client's email.
    const copy = body.send_copy_to_company === true ? await copyContext(supabase, companyId, body) : null;
    const operationKey = body.request_id ? `fuzedflow/${companyId}/${body.request_id}` : null;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) throw new Error("Email service configuration is unavailable.");

    const emailPayload: any = {
      from: "FuzedFlow <alerts@mail.fuzedflow.com>",
      to: to_email,
      subject: subject,
      html: html_body,
      reply_to: reply_to
    };

    const finalAttachments = [];

    // Legacy support for Quote URLs
    if (attachment_url) {
      finalAttachments.push({ filename: 'Document.pdf', path: attachment_url });
    }

    // New support for raw Base64 PDFs
    if (attachments && Array.isArray(attachments)) {
      finalAttachments.push(...attachments);
    }

    if (finalAttachments.length > 0) {
      emailPayload.attachments = finalAttachments;
    }

    originalAttempted = true;
    const resendData = await sendViaResend(emailPayload, resendApiKey, operationKey ? `${operationKey}/original` : undefined);

    // Provider IDs are trusted UUIDs. Replaying a send must not duplicate outreach.
    // Logging failure never changes an already accepted email into a send failure.
    try {
      const { error } = await supabase.from("client_communications").upsert({
        id: resendData.id, company_id: companyId, client_id: copy ? copy.clientId : (client_id || null),
        type: "Email", direction: "outbound", subject, message: html_body,
        status: "sent", sent_by: userId,
      }, { onConflict: "id", ignoreDuplicates: true });
      if (error) console.warn("Email accepted; communication history could not be recorded.");
    } catch {
      console.warn("Email accepted; communication history could not be recorded.");
    }

    let copyStatus = "not_requested";
    let copyResendId;
    let copyError;
    if (copy) {
      try {
        const copyData = await sendViaResend({ ...emailPayload, to: copy.recipient, subject: copy.subject },
          resendApiKey, `${operationKey}/copy`);
        copyStatus = "sent";
        copyResendId = copyData.id;
      } catch {
        copyStatus = "failed";
        copyError = "The client email was sent, but the company copy could not be confirmed. Retry the copy.";
      }
    }

    return new Response(
      JSON.stringify({ success: true, resend_id: resendData.id, copy_status: copyStatus, copy_resend_id: copyResendId, copy_error: copyError }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );

  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: originalAttempted ? 502 : 400 }
    );
  }
});
