import React, { useEffect, useRef, useState } from "react";
import { FileText, Mail, MessageSquare, Send } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/api/supabaseClient";
import { generateClientUpdatePDF } from "@/components/pdf/PDFGenerator";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { clientUpdatePortalUrl, escapeEmailHtml } from "@/lib/clientUpdates";

async function edgeFunctionError(error, fallback) {
  let message = error?.message || fallback;
  try {
    const payload = await error?.context?.json?.();
    if (payload?.error) message = payload.error;
  } catch { /* Retain the transport error. */ }
  return new Error(message);
}

function emailTemplate({ company, update, project, client, message, portalUrl }) {
  const brand = company?.settings?.pdf?.brand_color || "#f59e0b";
  const logo = company?.logo_url || company?.company_logo_url;
  const safeCompany = escapeEmailHtml(company?.name || "Your contractor");
  const safeTitle = escapeEmailHtml(update.title);
  const safeProject = escapeEmailHtml(project?.name || "Your project");
  const safeMessage = escapeEmailHtml(message).replace(/\r?\n/g, "<br>");
  const firstName = escapeEmailHtml((client?.name || "there").split(" ")[0]);
  return `
    <div style="background:#f8fafc;padding:40px 20px;font-family:Inter,'Segoe UI',Arial,sans-serif;color:#1e293b">
      <div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden">
        <div style="background:#0f172a;border-left:6px solid ${brand};padding:28px 30px;color:#fff">
          ${logo ? `<img src="${escapeEmailHtml(logo)}" alt="${safeCompany} logo" style="max-height:48px;max-width:180px;object-fit:contain;margin-bottom:18px">` : ""}
          <div style="font-size:12px;font-weight:800;letter-spacing:1.8px;text-transform:uppercase;color:${brand}">Project update</div>
          <h1 style="font-size:25px;line-height:1.25;margin:8px 0 4px">${safeTitle}</h1>
          <div style="font-size:14px;color:#cbd5e1">${safeProject}</div>
        </div>
        <div style="padding:32px 30px">
          <p style="margin:0 0 18px;font-size:16px">Hi ${firstName},</p>
          <div style="font-size:15px;line-height:1.7;color:#475569">${safeMessage}</div>
          <div style="margin:28px 0;padding:22px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;text-align:center">
            <p style="margin:0 0 16px;font-size:14px;color:#64748b">Review completed work, important notes, and what is coming next.</p>
            <a href="${escapeEmailHtml(portalUrl)}" style="display:inline-block;background:${brand};color:#0f172a;text-decoration:none;font-weight:800;padding:13px 24px;border-radius:999px">View Project Update</a>
          </div>
          <p style="margin:0;font-size:13px;line-height:1.6;color:#64748b">A professionally formatted PDF copy is attached for your records.</p>
        </div>
      </div>
      <p style="max-width:620px;margin:20px auto 0;text-align:center;font-size:12px;color:#94a3b8">Sent securely by ${safeCompany} through FuzedFlow</p>
    </div>`;
}

export default function ClientUpdateDeliveryDialog({ open, onOpenChange, mode, update, project, client, company, onSent }) {
  const [recipient, setRecipient] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [attachPdf, setAttachPdf] = useState(true);
  const [sendCopy, setSendCopy] = useState(false);
  const [saving, setSaving] = useState(false);
  const intent = useRef(null);

  useEffect(() => {
    if (!open || !update) return;
    const date = new Intl.DateTimeFormat("en-CA", { month: "long", day: "numeric", year: "numeric" })
      .format(new Date(`${update.update_date}T12:00:00`));
    setRecipient(mode === "email" ? client?.email || "" : client?.phone || "");
    setSubject(`Project Update - ${project?.name || "Your Project"} - ${date}`);
    setMessage(mode === "email"
      ? "Please find your latest project update, including work completed and a preview of the upcoming work."
      : `Hi ${(client?.name || "there").split(" ")[0]}, your latest update for ${project?.name || "your project"} is ready to view.`);
    setAttachPdf(true);
    setSendCopy(false);
    setSaving(false);
    intent.current = null;
  }, [open, update, project, client, mode]);

  const publish = async () => {
    if (update.status === "Published") return;
    const { error } = await supabase.from("client_updates").update({ status: "Published" }).eq("id", update.id).eq("company_id", update.company_id);
    if (error) throw error;
  };

  const handleSubmit = async event => {
    event.preventDefault();
    if (!recipient.trim()) return;
    setSaving(true);
    const loadingToast = toast.loading(mode === "email" ? "Preparing PDF and sending update..." : "Sending client update...");
    try {
      await publish();
      const portalUrl = clientUpdatePortalUrl(window.location.origin, client.id, update.id);
      const signature = JSON.stringify([mode, update.id, recipient.trim(), subject, message, attachPdf, sendCopy]);
      if (intent.current?.signature !== signature) intent.current = { signature, requestId: crypto.randomUUID(), accepted: false };

      if (!intent.current.accepted && mode === "email") {
        const attachments = [];
        if (attachPdf) {
          const content = await generateClientUpdatePDF({ ...update, status: "Published" }, project, client, company, { returnBase64: true });
          attachments.push({
            filename: `${String(project?.project_number || project?.name || "Project").replace(/[^a-z0-9_-]+/gi, "-")}-Update-${update.update_date}.pdf`,
            content,
            type: "application/pdf",
          });
        }
        const { data, error } = await supabase.functions.invoke("send-email", { body: {
          to_email: recipient.trim(),
          subject: subject.trim(),
          html_body: emailTemplate({ company, update, project, client, message, portalUrl }),
          client_id: client.id,
          document_type: "client_update",
          document_id: update.id,
          request_id: intent.current.requestId,
          reply_to: company?.settings?.email || undefined,
          send_copy_to_company: sendCopy,
          attachments,
          track_replies: true,
        }});
        if (error) throw await edgeFunctionError(error, "Email could not be sent.");
        if (data?.success !== true) throw new Error(data?.error || "Email delivery could not be confirmed.");
        intent.current.accepted = true;
      }

      if (!intent.current.accepted && mode === "sms") {
        const body = `${message.trim()}\n\n${portalUrl}`;
        const { data, error } = await supabase.functions.invoke("send-sms", { body: {
          phone_number: recipient.trim(),
          message_body: body,
          document_type: "client_update",
          document_id: update.id,
          request_id: intent.current.requestId,
        }});
        if (error) throw await edgeFunctionError(error, "Text message could not be sent.");
        if (data?.success !== true) throw new Error(data?.error || "Text delivery could not be confirmed.");
        intent.current.accepted = true;
      }

      const timestampField = mode === "email" ? "email_sent_at" : "sms_sent_at";
      const { error: statusError } = await supabase.from("client_updates")
        .update({ status: "Published", [timestampField]: new Date().toISOString() })
        .eq("id", update.id).eq("company_id", update.company_id);
      if (statusError) throw new Error("The update was sent, but its delivery status could not be saved. Retry to finish safely.");

      intent.current = null;
      toast.success(mode === "email" ? "Client update emailed successfully." : "Client update texted successfully.", { id: loadingToast });
      onSent?.();
      onOpenChange(false);
    } catch (error) {
      toast.error(error.message || "The client update could not be sent.", { id: loadingToast });
    } finally {
      setSaving(false);
    }
  };

  const copyEmail = company?.settings?.email || "";
  return (
    <Dialog open={open} onOpenChange={value => { if (!saving) onOpenChange(value); }}>
      <DialogContent className="max-h-[92dvh] w-[96vw] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-black">
            {mode === "email" ? <Mail className="h-5 w-5 text-amber-600" /> : <MessageSquare className="h-5 w-5 text-amber-600" />}
            {mode === "email" ? "Email client update" : "Text client update"}
          </DialogTitle>
          <DialogDescription>The update will be published to the Client Portal before it is sent.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5 pt-2">
          <div className="space-y-2">
            <Label htmlFor="client-update-recipient">{mode === "email" ? "Client email" : "Client mobile number"}</Label>
            <Input id="client-update-recipient" type={mode === "email" ? "email" : "tel"} value={recipient} disabled={saving} onChange={event => setRecipient(event.target.value)} required />
          </div>
          {mode === "email" && <div className="space-y-2"><Label htmlFor="client-update-subject">Subject</Label><Input id="client-update-subject" value={subject} disabled={saving} onChange={event => setSubject(event.target.value)} required /></div>}
          <div className="space-y-2"><Label htmlFor="client-update-message">Message</Label><Textarea id="client-update-message" value={message} disabled={saving} onChange={event => setMessage(event.target.value)} rows={5} required /></div>
          {mode === "email" && (
            <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-4"><Label htmlFor="client-update-attach" className="flex items-center gap-2"><FileText className="h-4 w-4 text-slate-500" />Attach branded PDF</Label><Switch id="client-update-attach" checked={attachPdf} disabled={saving} onCheckedChange={setAttachPdf} /></div>
              <div><label htmlFor="client-update-copy" className="flex min-h-10 items-center gap-2 text-sm font-medium text-slate-700"><input id="client-update-copy" type="checkbox" checked={sendCopy} disabled={saving || !copyEmail} onChange={event => setSendCopy(event.target.checked)} className="h-4 w-4 accent-amber-500" />Send me a copy</label><p className="text-xs text-slate-500">{copyEmail ? `Copy to: ${copyEmail}` : "Add a company email in Settings to enable copies."}</p></div>
            </div>
          )}
          <div className="flex justify-end gap-3 border-t border-slate-200 pt-4"><Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={saving || !recipient.trim()} className="bg-amber-500 font-bold text-slate-950 hover:bg-amber-600"><Send className="mr-2 h-4 w-4" />{saving ? "Sending..." : mode === "email" ? "Send email" : "Send text"}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
