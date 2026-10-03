import React, { useState, useEffect } from "react";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Send, FileText, Building2, Link as LinkIcon } from "lucide-react";
import { toast } from "sonner";
import { generatePOPDF } from "../pdf/PDFGenerator";
// ⚡ NEW: Imported the URL generator
import { createPageUrl } from "../../utils"; 

export default function SendPODialog({ open, onOpenChange, poId, poData, vendorData, itemsData, companyData, onSuccess }) {
  const { profile, settings } = useAuth();
  
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [signature, setSignature] = useState("");
  const [attachPdf, setAttachPdf] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setEmail(vendorData?.email || "");
      setAttachPdf(true);
      
      const vName = vendorData?.name || vendorData?.company_name || 'Vendor';
      const pNum = poData?.po_number || "Draft";
      setSubject(`Purchase Order ${pNum} from ${companyData?.name || settings?.name || "our team"}`);

      // 1. Setup Variables
      const myName = profile?.full_name || "Your Pro-Trades Team";
      const compName = companyData?.name || settings?.name || "";

      // 2. Pull template or default (⚡ Updated to mention the link)
      const defaultBody = "Hello {{vendor_name}},\n\nPlease find Purchase Order {{po_number}} from our team.\n\nYou can click the secure link below to view the full details, or review the attached PDF.\n\nPlease confirm receipt of this order and reply with an estimated delivery or fulfillment date.";
      const rawBody = settings?.templates?.po_email_body || defaultBody;

      // 3. Inject Tokens
      const personalizedBody = rawBody
        .replace(/{{vendor_name}}/g, vName)
        .replace(/{{po_number}}/g, pNum);
      
      setMessage(personalizedBody.trim());

      // 4. Generate Signature
      const defaultSignature = "Thank you for your business,\n{{my_name}}\n{{company_name}}";
      const rawSignature = settings?.templates?.email_signature || defaultSignature;
      
      const personalizedSig = rawSignature
        .replace(/{{my_name}}/g, myName)
        .replace(/{{company_name}}/g, compName);

      setSignature(personalizedSig.trim());
    }
  }, [open, vendorData, poData, settings, profile, companyData]);

  // ⚡ NEW: Helper to copy the link to clipboard right from the dialog
  const copyToClipboard = () => {
    const link = `${window.location.origin}${createPageUrl(`PublicPOView?id=${poId}`)}`;
    navigator.clipboard.writeText(link);
    toast.success("PO link copied!");
  };

  const handleSend = async (e) => {
    e.preventDefault();

    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error("Please enter a valid email address");
      return;
    }

    setSaving(true);
    const loadingToast = toast.loading("Dispatching Purchase Order to Vendor...");

    try {
      // 1. Format the email HTML body
      const customMessageHtml = (message || "").replace(/\n/g, '<br>');
      const sigHtml = (signature || "").replace(/\n/g, '<br>');
      
      const cpyName = companyData?.name || "Our Company";
      const logoUrl = companyData?.logo_url || companyData?.company_logo_url || "";
      const logoHtml = logoUrl ? `<img src="${logoUrl}" alt="${cpyName} Logo" style="max-height: 50px; width: auto; object-fit: contain; margin-bottom: 20px;" />` : '';
      const brandColor = companyData?.settings?.pdf?.brand_color || "#f59e0b";

      // ⚡ NEW: Generate the exact portal URL for the email button
      const portalUrl = `${window.location.origin}${createPageUrl(`PublicPOView?id=${poId}`)}`;

      const emailHtml = `
        <div style="background-color: #f8fafc; padding: 40px 20px; font-family: 'Segoe UI', Inter, Helvetica, Arial, sans-serif; color: #1e293b;">
          <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
            
            <div style="padding: 40px 30px 20px; text-align: center; border-bottom: 1px solid #f1f5f9;">
              ${logoHtml}
              <h1 style="margin: 0; font-size: 24px; font-weight: 800; color: #0f172a; letter-spacing: -0.5px;">New Purchase Order</h1>
            </div>
            
            <div style="padding: 40px 30px;">
              <div style="font-size: 16px; line-height: 1.6; color: #334155; margin-bottom: 30px;">
                ${customMessageHtml}
              </div>
              
              <div style="background-color: #f8fafc; border-radius: 8px; padding: 30px; border: 1px solid #e2e8f0; text-align: center;">
                <p style="margin: 0 0 10px 0; font-size: 13px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">
                  PURCHASE ORDER DETAILS
                </p>
                <p style="margin: 0 0 25px 0; font-size: 18px; font-weight: 700; color: #0f172a;">
                  PO ${poData?.po_number || ''}
                </p>
                
                <!-- ⚡ NEW: The Secure Link Button -->
                <a href="${portalUrl}" target="_blank" style="font-size: 16px; font-weight: 700; font-family: Helvetica, Arial, sans-serif; color: #ffffff; background-color: ${brandColor}; text-decoration: none; border-radius: 999px; padding: 14px 32px; display: inline-block; margin-bottom: 15px; border: 1px solid ${brandColor};">
                  View Purchase Order
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

      // 2. Build Payload for Edge Function
      const payload = {
        to_email: email.trim(),
        subject: subject,
        html_body: emailHtml,
        client_id: null // Vendors aren't clients, so we leave this null
      };

      // 3. Generate and attach the PDF if requested
      if (attachPdf && poData) {
        // Ensure PDF Generator is aware it needs to return a base64 string
        const pdfPoConfig = { ...poData, returnBase64: true };
        const base64Pdf = await generatePOPDF(pdfPoConfig, vendorData, itemsData || [], companyData);
        
        payload.attachments = [
          {
            content: base64Pdf,
            filename: `${poData.po_number || 'Purchase_Order'}.pdf`,
            type: "application/pdf"
          }
        ];
      }

      // 4. Trigger the Supabase Edge Function
      const { data, error: fnError } = await supabase.functions.invoke("send-email", { body: payload });

      if (fnError) throw new Error(fnError.message || "Failed to trigger email function");

      // 5. Update PO Status to Sent
      const { error: poError } = await supabase
        .from("purchase_orders")
        .update({ status: "Sent" })
        .eq("id", poId);

      if (poError) throw poError;

      toast.success(`Purchase Order successfully dispatched to ${email}!`, { id: loadingToast });
      
      onSuccess?.();
      onOpenChange(false);
    } catch (error) {
      console.error("Error sending PO:", error);
      toast.error(`Failed to send Purchase Order: ${error.message}`, { id: loadingToast });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:max-w-xl bg-slate-50 p-0 overflow-hidden flex flex-col max-h-[90vh]">
        <DialogHeader className="px-6 py-4 bg-white border-b border-slate-200 shrink-0">
          <DialogTitle className="text-xl font-black text-slate-900 flex items-center gap-2">
            <Building2 className="h-5 w-5 text-amber-500" /> Send PO {poData?.po_number}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSend} className="flex flex-col flex-1 overflow-hidden">
          <div className="p-6 space-y-4 overflow-y-auto flex-1">
            
            {/* ⚡ NEW: Quick Copy Link Banner */}
            <div className="flex items-center justify-between bg-amber-50 border border-amber-200 p-3 rounded-lg">
              <div className="flex items-center gap-2 text-amber-900">
                <LinkIcon className="h-4 w-4" />
                <span className="text-sm font-semibold">Vendor Portal Link</span>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={copyToClipboard} className="bg-white border-amber-200 hover:bg-amber-100 text-amber-800">
                Copy Link
              </Button>
            </div>

            <Card className="p-5 border-slate-200 shadow-sm space-y-4 bg-white">
              <div>
                <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Vendor Email *</Label>
                <Input type="email" placeholder="vendor@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className="font-medium text-slate-900 bg-white" autoFocus />
              </div>

              <div>
                <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Subject Line</Label>
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} className="font-semibold text-slate-900" />
              </div>

              <div className="space-y-4 border border-slate-200 rounded-lg p-1 bg-slate-50">
                <div className="bg-white rounded-md p-1 border border-transparent focus-within:border-amber-400 focus-within:ring-2 focus-within:ring-amber-500/20 transition-all">
                  <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-2 mt-2 block">Message Body</Label>
                  <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={6} className="resize-y min-h-[100px] font-medium border-0 focus-visible:ring-0 shadow-none pb-2 text-slate-800" />
                </div>
                <div className="px-3 pb-3">
                  <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">Signature</Label>
                  <Textarea value={signature} onChange={(e) => setSignature(e.target.value)} rows={3} className="resize-none font-medium text-slate-600 bg-slate-100/50 border-slate-200 focus-visible:ring-amber-500" />
                </div>
              </div>

              <div className="space-y-3 pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-slate-400" />
                    <Label className="text-sm font-medium text-slate-700 cursor-pointer" htmlFor="attach-pdf">Attach PDF copy to email</Label>
                  </div>
                  <Switch id="attach-pdf" checked={attachPdf} onCheckedChange={setAttachPdf} />
                </div>
              </div>
            </Card>
          </div>

          <div className="flex justify-end gap-3 p-4 bg-white border-t border-slate-200 shrink-0">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving} className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold px-6 shadow-sm">
              {saving ? "Dispatching..." : <><Send className="h-4 w-4 mr-2" /> Send PO</>}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}