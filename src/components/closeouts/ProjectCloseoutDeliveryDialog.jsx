import React, { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Mail, MessageSquare, Send, UsersRound } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/api/supabaseClient";
import { generateProjectCloseoutPDF } from "@/components/pdf/PDFGenerator";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { escapeEmailHtml } from "@/lib/clientUpdates";
import { projectCloseoutPortalUrl } from "@/lib/projectCloseouts";

async function edgeFunctionError(error, fallback) {
  let message = error?.message || fallback;
  try { const payload = await error?.context?.json?.(); if (payload?.error) message = payload.error; } catch { /* keep transport message */ }
  return new Error(message);
}

const safeFile = value => String(value || "Project").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "Project";

function clientEmailTemplate({ company, closeout, project, client, message, portalUrl }) {
  const brand = company?.settings?.pdf?.brand_color || "#f59e0b";
  const logo = company?.logo_url || company?.company_logo_url;
  const safeCompany = escapeEmailHtml(company?.name || "Your contractor");
  return `<div style="background:#f8fafc;padding:40px 20px;font-family:Inter,'Segoe UI',Arial,sans-serif;color:#1e293b"><div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden"><div style="background:#0f172a;border-left:6px solid ${brand};padding:28px 30px;color:#fff">${logo ? `<img src="${escapeEmailHtml(logo)}" alt="${safeCompany} logo" style="max-height:48px;max-width:180px;object-fit:contain;margin-bottom:18px">` : ""}<div style="font-size:12px;font-weight:800;letter-spacing:1.8px;text-transform:uppercase;color:${brand}">Project closeout</div><h1 style="font-size:25px;line-height:1.25;margin:8px 0 4px">${escapeEmailHtml(closeout.title)}</h1><div style="font-size:14px;color:#cbd5e1">${escapeEmailHtml(project?.name || "Your project")}</div></div><div style="padding:32px 30px"><p style="margin:0 0 18px;font-size:16px">Hi ${escapeEmailHtml((client?.name || "there").split(" ")[0])},</p><div style="font-size:15px;line-height:1.7;color:#475569">${escapeEmailHtml(message).replace(/\r?\n/g, "<br>")}</div><div style="margin:28px 0;padding:22px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;text-align:center"><p style="margin:0 0 16px;font-size:14px;color:#64748b">Review the deficiency checklist, photos, assignments, and completion status.</p><a href="${escapeEmailHtml(portalUrl)}" style="display:inline-block;background:${brand};color:#0f172a;text-decoration:none;font-weight:800;padding:13px 24px;border-radius:999px">View Project Closeout</a></div><p style="margin:0;font-size:13px;line-height:1.6;color:#64748b">A branded PDF copy is attached for your records.</p></div></div><p style="max-width:620px;margin:20px auto 0;text-align:center;font-size:12px;color:#94a3b8">Sent securely by ${safeCompany} through FuzedFlow</p></div>`;
}

function vendorEmailTemplate({ company, closeout, project, vendor, message, itemCount }) {
  const brand = company?.settings?.pdf?.brand_color || "#f59e0b";
  const safeCompany = escapeEmailHtml(company?.name || "Project team");
  return `<div style="background:#f8fafc;padding:36px 18px;font-family:Inter,'Segoe UI',Arial,sans-serif;color:#1e293b"><div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden"><div style="background:#0f172a;border-left:6px solid ${brand};padding:26px 28px;color:#fff"><div style="font-size:12px;font-weight:800;letter-spacing:1.8px;text-transform:uppercase;color:${brand}">Assigned closeout deficiencies</div><h1 style="font-size:23px;margin:8px 0 4px">${escapeEmailHtml(project?.name || "Project")}</h1><div style="font-size:14px;color:#cbd5e1">${itemCount} item${itemCount === 1 ? "" : "s"} assigned to ${escapeEmailHtml(vendor.name)}</div></div><div style="padding:30px 28px"><p style="margin:0 0 18px;font-size:16px">Hi ${escapeEmailHtml(vendor.contact_name || vendor.name)},</p><div style="font-size:15px;line-height:1.7;color:#475569">${escapeEmailHtml(message).replace(/\r?\n/g, "<br>")}</div><div style="margin-top:24px;padding:18px;background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;font-size:14px;line-height:1.6;color:#9a3412">The attached PDF contains only the deficiencies assigned to your company, including photos, descriptions, due dates, and current status.</div></div></div><p style="max-width:620px;margin:18px auto 0;text-align:center;font-size:12px;color:#94a3b8">Sent by ${safeCompany} through FuzedFlow</p></div>`;
}

export default function ProjectCloseoutDeliveryDialog({ open, onOpenChange, mode, closeout, items, project, client, vendors, company, onSent }) {
  const [recipient, setRecipient] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [attachPdf, setAttachPdf] = useState(true);
  const [sendCopy, setSendCopy] = useState(false);
  const [saving, setSaving] = useState(false);
  const intent = useRef(null);
  const vendorById = useMemo(() => Object.fromEntries((vendors || []).map(vendor => [vendor.id, vendor])), [vendors]);
  const assignments = useMemo(() => {
    const groups = new Map();
    for (const item of items || []) {
      const vendor = vendorById[item.assigned_vendor_id];
      if (!vendor) continue;
      if (!groups.has(vendor.id)) groups.set(vendor.id, { vendor, items: [] });
      groups.get(vendor.id).items.push(item);
    }
    return [...groups.values()];
  }, [items, vendorById]);
  const deliverableAssignments = assignments.filter(group => group.vendor.email);

  useEffect(() => {
    if (!open || !closeout) return;
    setRecipient(mode === "email" ? client?.email || "" : client?.phone || "");
    setSubject(mode === "vendors" ? `Closeout deficiencies - ${project?.name || "Project"}` : `Project Closeout - ${project?.name || "Your Project"}`);
    setMessage(mode === "vendors" ? "Please review the attached closeout deficiencies assigned to your company. Complete each item by its due date and contact us with any questions." : mode === "email" ? "Please find the project closeout deficiency checklist, including photos, assignments, and the current completion status." : `Hi ${(client?.name || "there").split(" ")[0]}, the closeout checklist for ${project?.name || "your project"} is ready to review.`);
    setAttachPdf(true); setSendCopy(false); setSaving(false); intent.current = null;
  }, [open, closeout, project, client, mode]);

  const publish = async () => {
    if (closeout.status !== "Draft") return;
    const { error } = await supabase.from("project_closeouts").update({ status: "Published" }).eq("id", closeout.id).eq("company_id", closeout.company_id);
    if (error) throw error;
  };

  const sendEmail = async body => {
    const { data, error } = await supabase.functions.invoke("send-email", { body });
    if (error) throw await edgeFunctionError(error, "Email could not be sent.");
    if (data?.success !== true) throw new Error(data?.error || "Email delivery could not be confirmed.");
  };

  const handleSubmit = async event => {
    event.preventDefault();
    if (mode !== "vendors" && !recipient.trim()) return;
    setSaving(true);
    const loadingToast = toast.loading(mode === "vendors" ? "Preparing and sending subcontractor packages…" : mode === "email" ? "Preparing PDF and emailing client…" : "Sending closeout link…");
    try {
      if (mode === "vendors") {
        if (!deliverableAssignments.length) throw new Error("Assign at least one deficiency to a subcontractor with an email address.");
        for (const group of deliverableAssignments) {
          const content = await generateProjectCloseoutPDF(closeout, group.items.map(item => ({ ...item, vendor: group.vendor })), project, client, company, { returnBase64: true, audience: group.vendor.name });
          await sendEmail({
            to_email: group.vendor.email, subject: subject.trim(), html_body: vendorEmailTemplate({ company, closeout, project, vendor: group.vendor, message, itemCount: group.items.length }),
            request_id: crypto.randomUUID(), reply_to: company?.settings?.email || undefined,
            attachments: [{ filename: `${safeFile(project?.project_number || project?.name)}-Closeout-${safeFile(group.vendor.name)}.pdf`, content, type: "application/pdf" }],
          });
          const ids = group.items.map(item => item.id);
          const { error: itemError } = await supabase.from("project_closeout_items").update({ subcontractor_sent_at: new Date().toISOString() }).in("id", ids).eq("company_id", closeout.company_id);
          if (itemError) throw new Error(`Email was sent to ${group.vendor.name}, but its delivery status could not be saved.`);
        }
        const { error } = await supabase.from("project_closeouts").update({ subcontractors_sent_at: new Date().toISOString() }).eq("id", closeout.id).eq("company_id", closeout.company_id);
        if (error) throw new Error("Trade packages were sent, but the closeout delivery status could not be saved.");
        toast.success(`Closeout sent to ${deliverableAssignments.length} subcontractor${deliverableAssignments.length === 1 ? "" : "s"}.`, { id: loadingToast });
      } else {
        await publish();
        const portalUrl = projectCloseoutPortalUrl(window.location.origin, client.id, closeout.id);
        const signature = JSON.stringify([mode, closeout.id, recipient.trim(), subject, message, attachPdf, sendCopy]);
        if (intent.current?.signature !== signature) intent.current = { signature, requestId: crypto.randomUUID(), accepted: false };
        if (!intent.current.accepted && mode === "email") {
          const attachments = [];
          if (attachPdf) {
            const content = await generateProjectCloseoutPDF({ ...closeout, status: closeout.status === "Completed" ? "Completed" : "Published" }, items, project, client, company, { returnBase64: true });
            attachments.push({ filename: `${safeFile(project?.project_number || project?.name)}-Closeout-${closeout.walkthrough_date}.pdf`, content, type: "application/pdf" });
          }
          await sendEmail({ to_email: recipient.trim(), subject: subject.trim(), html_body: clientEmailTemplate({ company, closeout, project, client, message, portalUrl }), client_id: client.id, document_type: "project_closeout", document_id: closeout.id, request_id: intent.current.requestId, reply_to: company?.settings?.email || undefined, send_copy_to_company: sendCopy, attachments, track_replies: true });
          intent.current.accepted = true;
        }
        if (!intent.current.accepted && mode === "sms") {
          const { data, error } = await supabase.functions.invoke("send-sms", { body: { phone_number: recipient.trim(), message_body: `${message.trim()}\n\n${portalUrl}`, document_type: "project_closeout", document_id: closeout.id, request_id: intent.current.requestId } });
          if (error) throw await edgeFunctionError(error, "Text message could not be sent.");
          if (data?.success !== true) throw new Error(data?.error || "Text delivery could not be confirmed.");
          intent.current.accepted = true;
        }
        const field = mode === "email" ? "email_sent_at" : "sms_sent_at";
        const { error } = await supabase.from("project_closeouts").update({ status: closeout.status === "Completed" ? "Completed" : "Published", [field]: new Date().toISOString() }).eq("id", closeout.id).eq("company_id", closeout.company_id);
        if (error) throw new Error("The closeout was sent, but its delivery status could not be saved. Retry to finish safely.");
        intent.current = null;
        toast.success(mode === "email" ? "Project closeout emailed successfully." : "Project closeout texted successfully.", { id: loadingToast });
      }
      onSent?.(); onOpenChange(false);
    } catch (error) { toast.error(error.message || "The closeout could not be sent.", { id: loadingToast }); }
    finally { setSaving(false); }
  };

  const copyEmail = company?.settings?.email || "";
  const title = mode === "vendors" ? "Send to assigned subcontractors" : mode === "email" ? "Email project closeout" : "Text project closeout";
  return <Dialog open={open} onOpenChange={value => { if (!saving) onOpenChange(value); }}><DialogContent className="max-h-[92dvh] w-[96vw] overflow-y-auto pt-10 sm:max-w-xl sm:pt-6"><DialogHeader className="pr-8"><DialogTitle className="flex items-center gap-2 text-xl font-black">{mode === "vendors" ? <UsersRound className="h-5 w-5 text-amber-600" /> : mode === "email" ? <Mail className="h-5 w-5 text-amber-600" /> : <MessageSquare className="h-5 w-5 text-amber-600" />}{title}</DialogTitle><DialogDescription>{mode === "vendors" ? "Each subcontractor receives a PDF containing only their assigned deficiencies." : "The closeout will be published to the Client Portal before it is sent."}</DialogDescription></DialogHeader><form className="space-y-5 pt-2" onSubmit={handleSubmit}>
    {mode === "vendors" ? <div className="space-y-2"><Label>Recipients</Label><div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-slate-50">{assignments.length ? assignments.map(group => <div key={group.vendor.id} className="flex items-center justify-between gap-4 p-3 text-sm"><div><strong className="text-slate-900">{group.vendor.name}</strong><p className="text-xs text-slate-500">{group.vendor.email || "Email address required"}</p></div><span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-700">{group.items.length} item{group.items.length === 1 ? "" : "s"}</span></div>) : <p className="p-4 text-sm text-amber-800">No deficiencies are assigned to subcontractors yet.</p>}</div>{assignments.some(group => !group.vendor.email) && <p className="text-xs text-amber-700">Subcontractors without an email address will be skipped.</p>}</div> : <div className="space-y-2"><Label htmlFor="closeout-recipient">{mode === "email" ? "Client email" : "Client mobile number"}</Label><Input id="closeout-recipient" type={mode === "email" ? "email" : "tel"} value={recipient} disabled={saving} onChange={event => setRecipient(event.target.value)} required /></div>}
    {mode !== "sms" && <div className="space-y-2"><Label htmlFor="closeout-subject">Subject</Label><Input id="closeout-subject" value={subject} disabled={saving} onChange={event => setSubject(event.target.value)} required /></div>}
    <div className="space-y-2"><Label htmlFor="closeout-message">Message</Label><Textarea id="closeout-message" value={message} disabled={saving} onChange={event => setMessage(event.target.value)} rows={5} required /></div>
    {mode === "email" && <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="flex items-center justify-between gap-4"><Label htmlFor="closeout-attach" className="flex items-center gap-2"><FileText className="h-4 w-4 text-slate-500" />Attach branded PDF</Label><Switch id="closeout-attach" checked={attachPdf} disabled={saving} onCheckedChange={setAttachPdf} /></div><div><label htmlFor="closeout-copy" className="flex min-h-10 items-center gap-2 text-sm font-medium text-slate-700"><input id="closeout-copy" type="checkbox" checked={sendCopy} disabled={saving || !copyEmail} onChange={event => setSendCopy(event.target.checked)} className="h-4 w-4 accent-amber-500" />Send me a copy</label><p className="text-xs text-slate-500">{copyEmail ? `Copy to: ${copyEmail}` : "Add a company email in Settings to enable copies."}</p></div></div>}
    <div className="flex justify-end gap-3 border-t border-slate-200 pt-4"><Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={saving || (mode === "vendors" ? !deliverableAssignments.length : !recipient.trim())} className="bg-amber-500 font-bold text-slate-950 hover:bg-amber-600"><Send className="mr-2 h-4 w-4" />{saving ? "Sending…" : mode === "vendors" ? "Send trade packages" : mode === "email" ? "Send email" : "Send text"}</Button></div>
  </form></DialogContent></Dialog>;
}
