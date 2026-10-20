import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Send, FileText, Link as LinkIcon, Mail } from "lucide-react";
import { toast } from "sonner";
import { createPageUrl } from "../../utils";
import { generateQuotePDF } from "../pdf/PDFGenerator";
import { useDocumentEmailSend } from "@/lib/emailCopy";
import { buildPublicChangeOrderUrl, issueChangeOrderShareToken } from "@/lib/changeOrderSharing";

export default function SendChangeOrderEmailDialog({ open, onOpenChange, changeOrderId, coName, clientName, clientEmail, onSuccess }) {
  const { profile, settings } = useAuth();
  
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [signature, setSignature] = useState("");
  const [attachPdf, setAttachPdf] = useState(true);
  
  const [coData, setCoData] = useState(null);
  const [companyData, setCompanyData] = useState(null);
  const [shareToken, setShareToken] = useState("");
  const [readyDocumentId, setReadyDocumentId] = useState(null);
  const setupLoading = readyDocumentId !== changeOrderId;
  const {
    saving, sendCopy, setSendCopy, copyEmail, copyAvailable, inputsLocked,
    hasRetry, copyPending, retryExpired, errorMessage, handleOpenChange, send,
  } = useDocumentEmailSend({
    open,
    documentId: changeOrderId,
    documentType: "change_order",
    companyEmail: companyData?.settings?.email,
    onOpenChange,
    onSuccess,
    successMessage: "Change Order successfully emailed!",
    loadingMessage: "Generating PDF and sending email...",
  });
  const setupContext = useRef({ profile, settings, inputsLocked });
  setupContext.current = { profile, settings, inputsLocked };
  const setupDocumentRef = useRef(null);

  useEffect(() => {
    const { profile, settings, inputsLocked } = setupContext.current;
    if (!open || !changeOrderId) return;
    if (inputsLocked && setupDocumentRef.current === changeOrderId) return;
    setupDocumentRef.current = changeOrderId;

    let isMounted = true;
    setReadyDocumentId(null);
    setEmail("");
    setSubject("");
    setMessage("");
    setSignature("");
    setAttachPdf(true);
    setCompanyData(null);
    setCoData(null);
    setShareToken("");

    const fetchSetupData = async () => {
      // 1. Deep fetch: Grab the Change Order AND reach through to the Project to get the Client ID
      const { data: changeOrder, error: loadError } = await supabase
        .from("change_orders")
        .select(`*, projects(client_id)`)
        .eq("id", changeOrderId)
        .single();

      if (!isMounted) return;
      if (loadError || !changeOrder) throw new Error("Change order unavailable");
      setCoData(changeOrder);

      // 2. Fetch the actual Company Data
      let cpyName = "Our Company";
      if (profile?.company_id) {
        let cData = null;
        try {
          const { data, error } = await supabase
            .from("companies")
            .select("name, logo_url, company_logo_url, settings")
            .eq("id", profile.company_id)
            .single();
          if (!error) cData = data;
        } catch { /* Company branding is optional; copies stay disabled when unavailable. */ }

        if (!isMounted) return;
        if (cData) {
          setCompanyData(cData);
          cpyName = cData.name || cpyName;
        }
      }

      // 3. Resolve Client Name & Email securely
      let resolvedEmail = clientEmail;
      let resolvedName = clientName;
      
      // Extract the Client ID from the nested project data
      let clientId = null;
      if (changeOrder?.projects) {
        clientId = Array.isArray(changeOrder.projects) ? changeOrder.projects[0]?.client_id : changeOrder.projects?.client_id;
      }

      // If the props were empty, fetch the client directly using the ID we just found
      if ((!resolvedEmail || !resolvedName) && clientId) {
        const { data: clientObj } = await supabase
          .from("clients")
          .select("name, email")
          .eq("id", clientId)
          .single();

        if (clientObj) {
          if (!resolvedEmail) resolvedEmail = clientObj.email;
          if (!resolvedName) resolvedName = clientObj.name;
        }
      }

      if (!isMounted) return;

      // 4. Populate Form State
      setEmail(resolvedEmail || "");
      setAttachPdf(true);
      
      const cNum = changeOrder?.change_order_number || "Draft";
      setSubject(`Change Order ${cNum} from ${cpyName}`);

      const cName = resolvedName ? resolvedName.split(' ')[0] : 'there';
      const myName = profile?.full_name || "Your Fuzed Flow Team";

      const defaultBody = "Hi {{client_name}},\n\nWe have submitted a scope modification request, Change Order {{co_number}}, for your project.\n\nPlease tap the link below to review the adjustment details and sign off on the variation.";
      const rawBody = settings?.templates?.co_email_body || defaultBody;

      const personalizedBody = rawBody
        .replace(/{{client_name}}/g, cName)
        .replace(/{{co_number}}/g, cNum);
      
      setMessage(personalizedBody.trim());

      const defaultSignature = "Thank you for your business,\n{{my_name}}\n{{company_name}}";
      const rawSignature = settings?.templates?.email_signature || defaultSignature;
      const personalizedSig = rawSignature
        .replace(/{{my_name}}/g, myName)
        .replace(/{{company_name}}/g, cpyName);

      setSignature(personalizedSig.trim());
      const token = await issueChangeOrderShareToken(changeOrderId);
      if (!isMounted) return;
      setShareToken(token);
      setReadyDocumentId(changeOrderId);
    };

    fetchSetupData().catch(() => {
      if (isMounted) toast.error("Could not load the change order. Close this dialog and reopen it.");
    });

    return () => { isMounted = false; };
  }, [open, changeOrderId, clientName, clientEmail, profile?.company_id]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (setupLoading || saving || retryExpired) return;
    if (!email.trim()) { toast.error("Please enter a valid email"); return; }

    await send(async () => {
      // ⚡ 1. EXTRACT CLIENT ID FIRST
      let clientId = null;
      if (coData?.projects) {
        clientId = Array.isArray(coData.projects) ? coData.projects[0]?.client_id : coData.projects?.client_id;
      }

      const customMessageHtml = (message || "").replace(/\n/g, '<br>');
      const sigHtml = (signature || "").replace(/\n/g, '<br>');
      const portalUrl = buildPublicChangeOrderUrl(changeOrderId, shareToken);
      
      // ⚡ 2. SECURELY ATTACH CLIENT ID TO PORTAL LINK
      const baseClientPortalUrl = clientId 
        ? `${window.location.origin}${createPageUrl(`ClientPortal?id=${clientId}&co_token=${encodeURIComponent(shareToken)}`)}`
        : `${window.location.origin}${createPageUrl('ClientPortal')}`;
      
      const brandColor = companyData?.settings?.pdf?.brand_color || "#f59e0b";
      const cpyName = companyData?.name || "Your Contractor";
      const logoUrl = companyData?.logo_url || companyData?.company_logo_url || "";
      const logoHtml = logoUrl ? `<img src="${logoUrl}" alt="${cpyName} Logo" style="max-height: 50px; width: auto; object-fit: contain; margin-bottom: 20px;" />` : '';
      
      const coTitle = coData?.title || `Change Order ${coData?.change_order_number || ''}`;

      const emailHtml = `
        <div style="background-color: #f8fafc; padding: 40px 20px; font-family: 'Segoe UI', Inter, Helvetica, Arial, sans-serif; color: #1e293b;">
          <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
            
            <div style="padding: 40px 30px 20px; text-align: center; border-bottom: 1px solid #f1f5f9;">
              ${logoHtml}
              <h1 style="margin: 0; font-size: 24px; font-weight: 800; color: #0f172a; letter-spacing: -0.5px;">Your Change Order is Ready</h1>
            </div>
            
            <div style="padding: 40px 30px;">
              <div style="font-size: 16px; line-height: 1.6; color: #334155; margin-bottom: 30px;">
                ${customMessageHtml}
              </div>
              
              <div style="background-color: #f8fafc; border-radius: 8px; padding: 30px; border: 1px solid #e2e8f0; text-align: center;">
                <p style="margin: 0 0 10px 0; font-size: 13px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">
                  CHANGE ORDER DETAILS
                </p>
                <p style="margin: 0 0 25px 0; font-size: 18px; font-weight: 700; color: #0f172a;">
                  ${coTitle}
                </p>
                
                <a href="${portalUrl}" target="_blank" style="font-size: 16px; font-weight: 700; font-family: Helvetica, Arial, sans-serif; color: #ffffff; background-color: ${brandColor}; text-decoration: none; border-radius: 999px; padding: 14px 32px; display: inline-block; margin-bottom: 15px; border: 1px solid ${brandColor};">
                  View & Accept Change Order
                </a>
                <br/>
                
                <a href="${baseClientPortalUrl}" target="_blank" style="font-size: 15px; font-weight: 600; font-family: Helvetica, Arial, sans-serif; color: #475569; background-color: transparent; text-decoration: none; border-radius: 999px; padding: 12px 24px; border: 1px solid #cbd5e1; display: inline-block;">
                  Access Client Portal
                </a>
              </div>
            </div>
          </div>
          
          <div style="max-width: 600px; margin: 30px auto 0; text-align: center; color: #64748b;">
            <div style="font-size: 14px; line-height: 1.5; margin-bottom: 20px;">
              ${sigHtml}
            </div>
            <p style="margin: 0; font-size: 12px; font-weight: 500; color: #94a3b8;">
              &#128274; 256-Bit Encrypted Link • Sent securely via <span style="background-color: #fde68a; color: #92400e; padding: 2px 6px; border-radius: 4px; font-weight: bold;">FuzedFlow</span>
            </p>
            <p style="margin: 8px 0 0 0; font-size: 12px; color: #94a3b8;">
              &copy; ${new Date().getFullYear()} ${cpyName}. All rights reserved.
            </p>
          </div>
        </div>
      `;

      const payload = {
        to_email: email.trim(),
        subject: subject,
        html_body: emailHtml,
        client_id: clientId || null
      };

      if (attachPdf) {
         const { data: fullCo } = await supabase.from("change_orders").select("*").eq("id", changeOrderId).single();
         const { data: phases } = await supabase.from("change_order_phases").select("*").eq("change_order_id", changeOrderId);
         const { data: items } = await supabase.from("change_order_line_items").select("*").eq("change_order_id", changeOrderId);

         if (fullCo && companyData) {
           const pdfQuoteConfig = { ...fullCo, returnBase64: true };
           const mockClient = { name: clientName, email: email.trim() };
           
           const base64Pdf = await generateQuotePDF(pdfQuoteConfig, mockClient, phases || [], items || [], companyData);
           
           payload.attachments = [
             {
               content: base64Pdf,
               filename: `${fullCo.change_order_number || 'Change_Order'}.pdf`,
               type: "application/pdf"
             }
           ];
         }
      }

      return payload;
    });
  };

  const copyToClipboard = () => {
    if (!shareToken) return;
    const link = buildPublicChangeOrderUrl(changeOrderId, shareToken);
    navigator.clipboard.writeText(link);
    toast.success("Client portal link copied!");
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[95vw] sm:max-w-xl bg-slate-50 p-0 overflow-hidden flex flex-col max-h-[90dvh]">
        <DialogHeader className="px-6 py-4 bg-white border-b border-slate-200 shrink-0">
          <DialogTitle className="text-xl font-black text-slate-900 flex items-center gap-2">
            <Mail className="h-5 w-5 text-amber-500" /> Email Change Order
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSend} className="flex flex-col flex-1 overflow-hidden">
          <div className="p-6 space-y-4 overflow-y-auto flex-1">
            <div className="flex items-center justify-between bg-amber-50 border border-amber-200 p-3 rounded-lg">
              <div className="flex items-center gap-2 text-amber-900">
                <LinkIcon className="h-4 w-4" />
                <span className="text-sm font-semibold">Client Portal Link</span>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={copyToClipboard} disabled={setupLoading || saving} className="bg-white border-amber-200 hover:bg-amber-100 text-amber-800">
                Copy Link
              </Button>
            </div>

            <Card className="p-5 border-slate-200 shadow-sm space-y-4 bg-white">
              <div>
                <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Client Email *</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={inputsLocked || setupLoading} className="font-medium text-slate-900" autoFocus />
              </div>

              <div>
                <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Subject Line</Label>
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} disabled={inputsLocked || setupLoading} className="font-semibold text-slate-900" />
              </div>

              <div className="space-y-4 border border-slate-200 rounded-lg p-1 bg-slate-50">
                <div className="bg-white rounded-md p-1 border border-transparent focus-within:border-amber-400 focus-within:ring-2 focus-within:ring-amber-500/20 transition-all">
                  <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-2 mt-2 block">Message Body</Label>
                  <Textarea value={message} onChange={(e) => setMessage(e.target.value)} disabled={inputsLocked || setupLoading} rows={6} className="resize-y min-h-[100px] font-medium border-0 focus-visible:ring-0 shadow-none pb-2 text-slate-800" />
                </div>
                <div className="px-3 pb-3">
                  <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">Signature</Label>
                  <Textarea value={signature} onChange={(e) => setSignature(e.target.value)} disabled={inputsLocked || setupLoading} rows={3} className="resize-none font-medium text-slate-600 bg-slate-100/50 border-slate-200 focus-visible:ring-amber-500" />
                </div>
              </div>

              <div className="space-y-3 pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-slate-400" />
                    <Label className="text-sm font-medium text-slate-700 cursor-pointer" htmlFor="attach-pdf">Attach PDF copy to email</Label>
                  </div>
                  <Switch id="attach-pdf" checked={attachPdf} onCheckedChange={setAttachPdf} disabled={inputsLocked || setupLoading} />
                </div>
              </div>
            </Card>
          </div>

          {errorMessage && <p role="alert" className="px-4 pb-3 text-sm text-red-700">{errorMessage}</p>}
          <div className="flex flex-col gap-3 p-4 bg-white border-t border-slate-200 shrink-0 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <label htmlFor="change-order-send-copy" className="flex min-h-11 items-center gap-2 text-sm font-medium text-slate-700 cursor-pointer">
                <input id="change-order-send-copy" type="checkbox" checked={sendCopy} onChange={(e) => setSendCopy(e.target.checked)} disabled={!copyAvailable || inputsLocked || setupLoading} className="h-4 w-4 accent-amber-500 focus-visible:outline-amber-600" aria-describedby="change-order-copy-hint" />
                Send me a copy
              </label>
              <p id="change-order-copy-hint" className="text-xs text-slate-500 break-words">{setupLoading ? "Loading company email..." : copyAvailable ? `Copy to: ${copyEmail}` : "Add a valid company email in Settings to receive a copy."}</p>
            </div>
            <div className="flex justify-end gap-3 shrink-0">
              <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)} disabled={saving}>{copyPending ? "Close" : "Cancel"}</Button>
              <Button type="submit" disabled={saving || retryExpired || setupLoading} className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold px-6 shadow-sm">
                {saving ? (copyPending ? "Sending copy..." : "Sending...") : <><Send className="h-4 w-4 mr-2" /> {copyPending ? "Retry copy" : hasRetry ? "Retry send" : "Send Email"}</>}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { MessageSquare, Send, Link as LinkIcon, Lock } from "lucide-react";
import { toast } from "sonner";
import { buildPublicChangeOrderUrl, issueChangeOrderShareToken } from "@/lib/changeOrderSharing";

export default function SendChangeOrderTextDialog({ open, onOpenChange, changeOrderId, coName, clientName, clientPhone, onSuccess }) {
  const { settings, profile } = useAuth();
  
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [portalLink, setPortalLink] = useState("");
  const [saving, setSaving] = useState(false);
  const sendIntent = useRef(null);
  const [coData, setCoData] = useState(null);

  useEffect(() => {
    if (open && changeOrderId) {
      // ⚡ DEEP FETCH TO GET CLIENT ID FROM ATTACHED PROJECT
      supabase.from("change_orders").select("change_order_number, title, projects(client_id)").eq("id", changeOrderId).single()
        .then(({ data }) => setCoData(data));
    }
  }, [open, changeOrderId]);

  useEffect(() => {
    if (open && changeOrderId && coData) {
      setPhone(clientPhone || "");
      setPortalLink("");
      let active = true;
      issueChangeOrderShareToken(changeOrderId)
        .then(token => { if (active) setPortalLink(buildPublicChangeOrderUrl(changeOrderId, token)); })
        .catch(() => { if (active) toast.error("Could not create the secure client link."); });

      const cName = clientName ? clientName.split(' ')[0] : 'there';
      const cNum = coData?.change_order_number || "Draft";

      const defaultTemplate = "Hi {{client_name}}, Change Order {{co_number}} has been requested for your project. Tap the link to authorize the adjustment:";
      const rawTemplate = settings?.templates?.co_sms || defaultTemplate;

      const personalizedMessage = rawTemplate
        .replace(/{{client_name}}/g, cName)
        .replace(/{{co_number}}/g, cNum);
      
      setMessage(personalizedMessage.trim());
      return () => { active = false; };
    }
  }, [open, changeOrderId, coData, clientName, clientPhone, settings]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!phone.trim()) { toast.error("Phone number is required"); return; }
    if (!portalLink) { toast.error("The secure client link is still loading."); return; }

    setSaving(true);
    const loadingToast = toast.loading("Sending SMS...");
    const finalSmsPayload = `${message}\n\n${portalLink}`;

    try {
      const signature = JSON.stringify([changeOrderId, phone.trim(), finalSmsPayload]);
      if (sendIntent.current?.signature !== signature) sendIntent.current = { signature, requestId: crypto.randomUUID(), accepted: false };
      if (!sendIntent.current.accepted) {
        const { data, error: fnError } = await supabase.functions.invoke('send-sms', {
          body: { phone_number: phone.trim(), message_body: finalSmsPayload, document_type: "change_order", document_id: changeOrderId, request_id: sendIntent.current.requestId }
        });
        if (fnError || data?.success !== true) throw new Error(data?.error || fnError?.message || "SMS acceptance could not be confirmed");
        sendIntent.current.accepted = true;
      }
      // Provider acceptance precedes the status change; retries never send another accepted SMS.
      const { error: statusError } = await supabase.from("change_orders").update({
        status: "Sent", sent_at: new Date().toISOString(), automation_stage: 0, next_follow_up_date: null,
      }).eq("id", changeOrderId).eq("company_id", profile.company_id).eq("status", "Draft");
      if (statusError) throw new Error("SMS was sent, but document status could not be saved. Retry to update the status.");
      sendIntent.current = null;

      toast.success(`Change Order texted to ${phone}!`, { id: loadingToast });
      onSuccess?.();
      onOpenChange(false);
    } catch (error) {
      toast.error(`Failed to send text: ${error.message}`, { id: loadingToast });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:max-w-lg bg-slate-50 p-0 overflow-hidden flex flex-col max-h-[90vh]">
        <DialogHeader className="px-6 py-4 bg-white border-b border-slate-200 shrink-0">
          <DialogTitle className="text-xl font-black text-slate-900 flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-amber-500" /> Text Change Order (SMS)
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSend} className="flex flex-col flex-1 overflow-hidden">
          <div className="p-6 space-y-4 overflow-y-auto flex-1">
            <Card className="p-5 border-slate-200 shadow-sm space-y-4 bg-white">
              <div className="w-full">
                <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Mobile Phone Number *</Label>
                <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 123-4567" className="font-medium text-slate-900 w-full" autoFocus />
              </div>

              <div className="space-y-2 w-full">
                <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Text Message</Label>
                <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50 focus-within:ring-2 focus-within:ring-amber-500 transition-all flex flex-col w-full">
                  <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} className="resize-none font-medium text-sm leading-relaxed border-0 shadow-none focus-visible:ring-0 rounded-none bg-white w-full" />
                  <div className="px-3 py-2.5 bg-slate-100 border-t border-slate-200 flex items-center gap-2 w-full overflow-hidden">
                    <LinkIcon className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    <span className="text-xs text-slate-500 font-medium truncate flex-1 min-w-0 select-all">{portalLink}</span>
                    <Lock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                  </div>
                </div>
              </div>
            </Card>
          </div>

          <div className="flex justify-end gap-3 p-4 bg-white border-t border-slate-200 shrink-0">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving || !portalLink} className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold px-6">
              {saving ? "Sending..." : <><Send className="h-4 w-4 mr-2" /> Send Text</>}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
