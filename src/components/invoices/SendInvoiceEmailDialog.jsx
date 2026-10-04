import React, { useState, useEffect } from "react";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Mail, Send } from "lucide-react";
import { toast } from "sonner";
import { createPageUrl } from "../../utils";

// ⚡ Added 'clientId' as an accepted prop
export default function SendInvoiceEmailDialog({ open, onOpenChange, invoiceId, invoiceNumber, clientName, clientEmail, clientId, onSuccess }) {
  const { profile, settings: authSettings } = useAuth();
  
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [signature, setSignature] = useState("");
  const [saving, setSaving] = useState(false);
  
  const [companyData, setCompanyData] = useState(null);
  const [invoiceData, setInvoiceData] = useState(null);
  
  // ⚡ Store a resolved client ID state
  const [resolvedClientId, setResolvedClientId] = useState(clientId || null);

  // --- INITIALIZATION & DYNAMIC TEMPLATING ---
  useEffect(() => {
    if (!open || !invoiceId) return;

    let isMounted = true;

    const fetchSetupData = async () => {
      // 1. Fetch invoice details
      const { data: iData } = await supabase
        .from("invoices")
        .select("invoice_number, title, client_id, company_id")
        .eq("id", invoiceId)
        .single();

      if (!isMounted) return;
      setInvoiceData(iData);
      
      // Update our resolved client ID fallback
      if (iData?.client_id) setResolvedClientId(iData.client_id);

      // 2. BULLETPROOF BRAND FETCHING
      const targetCompanyId = iData?.company_id || profile?.company_id;
      let compData = null;
      
      if (targetCompanyId) {
        const { data, error } = await supabase
          .from("companies")
          .select("name, logo_url, company_logo_url, settings")
          .eq("id", targetCompanyId)
          .single();

        if (!error) {
          compData = data;
          if (isMounted) setCompanyData(data);
        }
      }

      // 3. Resolve Email and Name
      let resolvedEmail = clientEmail;
      let resolvedName = clientName;

      // If we don't have the email from props, fetch it using our resolved ID
      const activeClientId = clientId || iData?.client_id;
      
      if ((!resolvedEmail || !resolvedName) && activeClientId) {
        const { data: cData } = await supabase
          .from("clients")
          .select("name, email")
          .eq("id", activeClientId)
          .single();

        if (cData) {
          if (!resolvedEmail) resolvedEmail = cData.email;
          if (!resolvedName) resolvedName = cData.name;
        }
      }

      if (!isMounted) return;

      // 4. Populate Form State
      setEmail(resolvedEmail || "");

      const iNum = iData?.invoice_number || invoiceNumber || "Draft";
      const iTitle = iData?.title || `Invoice ${iNum}`;
      
      const finalCompanyName = compData?.name || authSettings?.company_name || authSettings?.name || "Our Company";
      setSubject(`Your Invoice From ${finalCompanyName} is Ready`);

      const cName = resolvedName ? resolvedName.split(' ')[0] : 'there';
      const myName = profile?.full_name || "Your Fuzed Flow Team";

      // 5. Build Dynamic Message Body for Invoices
      const defaultBody = "Hi {{client_name}},\n\nYour invoice {{invoice_number}} is ready for review.\n\nYou can view the detailed breakdown and securely submit your payment using the interactive link below. Let us know if you have any questions!";
      const rawBody = authSettings?.templates?.invoice_email_body || defaultBody;

      const personalizedBody = rawBody
        .replace(/{{client_name}}/g, cName)
        .replace(/{{invoice_number}}/g, iNum)
        .replace(/{{invoice_title}}/g, iTitle);
      
      setMessage(personalizedBody.trim());

      // 6. Build Dynamic Signature
      const defaultSignature = "Thank you for your business,\n{{my_name}}\n{{company_name}}";
      const rawSignature = authSettings?.templates?.email_signature || defaultSignature;
      
      const personalizedSig = rawSignature
        .replace(/{{my_name}}/g, myName)
        .replace(/{{company_name}}/g, finalCompanyName);

      setSignature(personalizedSig.trim());
    };

    fetchSetupData();

    return () => {
      isMounted = false;
    };
  }, [open, invoiceId, clientEmail, clientName, invoiceNumber, clientId, authSettings, profile]);

  // --- SENDING LOGIC & HTML EMAIL GENERATION ---
  const handleSend = async (e) => {
    if (e) e.preventDefault();
    if (!email) {
      toast.error("Please provide an email address.");
      return;
    }

    try {
      setSaving(true);
      
      const customMessageHtml = (message || "").replace(/\n/g, '<br>');
      const sigHtml = (signature || "").replace(/\n/g, '<br>');
      const baseUrl = window.location.origin;
      
      // ⚡ GUARANTEED CLIENT ID
      const targetClientId = clientId || resolvedClientId || invoiceData?.client_id;
      
      // Invoice-specific routing
      const invoiceUrl = `${baseUrl}${createPageUrl(`PublicInvoiceView?id=${invoiceId}`)}`;
      
      // ⚡ FALLBACK ROUTING: If for some reason we still don't have an ID, it sends them to the base portal instead of an 'undefined' crash page
      const portalUrl = targetClientId 
        ? `${baseUrl}${createPageUrl(`ClientPortal?id=${targetClientId}`)}`
        : `${baseUrl}${createPageUrl(`ClientPortal`)}`; 
      
      const companyName = companyData?.name || authSettings?.company_name || authSettings?.name || "Your Contractor";
      const logoUrl = companyData?.logo_url || companyData?.company_logo_url || "https://ochqexofahdssmarnict.supabase.co/storage/v1/object/public/logos/fuzed-flow-logo.png";
      const displayTitle = invoiceData?.title || `Invoice ${invoiceData?.invoice_number || invoiceNumber}`;
      
      // Extract color safely from JSON, default to FuzedFlow Amber
      const buttonColor = companyData?.settings?.pdf?.brand_color || "#f59e0b";

      // 🚀 PREMIUM SAAS EMAIL TEMPLATE
      const emailHtml = `
        <div style="background-color: #f8fafc; padding: 40px 20px; font-family: 'Segoe UI', Inter, Helvetica, Arial, sans-serif; color: #1e293b;">
          <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
            
            <div style="padding: 30px; text-align: center; border-bottom: 1px solid #f1f5f9;">
              <img src="${logoUrl}" alt="${companyName} Logo" style="max-height: 50px; width: auto; object-fit: contain; margin-bottom: 15px;" />
              <h1 style="margin: 0; font-size: 24px; font-weight: 800; color: #0f172a; letter-spacing: -0.5px;">Your Invoice is Ready</h1>
            </div>
            
            <div style="padding: 40px 30px;">
              <div style="font-size: 16px; line-height: 1.6; color: #334155; margin-bottom: 30px;">
                ${customMessageHtml}
              </div>
              
              <div style="background-color: #f8fafc; border-radius: 8px; padding: 30px; border: 1px solid #e2e8f0; text-align: center;">
                <p style="margin: 0 0 10px 0; font-size: 14px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">
                  Billing Details
                </p>
                <p style="margin: 0 0 25px 0; font-size: 18px; font-weight: 700; color: #0f172a;">
                  ${displayTitle}
                </p>
                
                <a href="${invoiceUrl}" target="_blank" style="font-size: 16px; font-weight: 700; font-family: Helvetica, Arial, sans-serif; color: #ffffff; background-color: ${buttonColor}; text-decoration: none; border-radius: 999px; padding: 16px 32px; display: inline-block; margin-bottom: 15px; border: 1px solid ${buttonColor};">
                  View & Pay Invoice
                </a>
                <br/>
                
                <a href="${portalUrl}" target="_blank" style="font-size: 14px; font-weight: 600; font-family: Helvetica, Arial, sans-serif; color: #475569; background-color: transparent; text-decoration: none; border-radius: 999px; padding: 12px 24px; border: 1px solid #cbd5e1; display: inline-block;">
                  Access Client Portal
                </a>
              </div>
            </div>
          </div>
          
          <div style="max-width: 600px; margin: 30px auto 0; text-align: center; color: #94a3b8;">
            <div style="font-size: 14px; line-height: 1.5; margin-bottom: 20px; color: #64748b;">
              ${sigHtml}
            </div>
            <p style="margin: 0; font-size: 12px; font-weight: 500;">
              &#128274; 256-Bit Encrypted Link • Sent securely via FuzedFlow
            </p>
            <p style="margin: 5px 0 0 0; font-size: 12px;">
              &copy; ${new Date().getFullYear()} ${companyName}. All rights reserved.
            </p>
          </div>
        </div>
      `;

      // 4. Send via Supabase Edge Function
      const { data, error } = await supabase.functions.invoke('send-email', {
        body: {
          to_email: email,
          subject: subject,
          html_body: emailHtml,
          client_id: targetClientId || null
        }
      });

      if (error) {
        throw new Error(error.message || "Failed to send email via Edge Function");
      }

      // 5. Update Status in Supabase
      await supabase.from("invoices").update({ status: "Sent" }).eq("id", invoiceId);
      
      toast.success("Invoice sent successfully!");
      onOpenChange(false);
      if (onSuccess) onSuccess();

    } catch (error) {
      console.error("Error sending email:", error);
      toast.error("Failed to send invoice. Please check console for details.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] bg-white border-slate-200">
        
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-bold text-slate-900">
            <Mail className="w-5 h-5 text-amber-500" />
            Send Invoice via Email
          </DialogTitle>
          <DialogDescription className="hidden">
            Send a secure invoice email with your custom branding.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSend} className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-slate-700 font-bold">To (Client Email)</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="client@example.com"
              required
              className="border-slate-300 focus-visible:ring-amber-500"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="subject" className="text-slate-700 font-bold">Subject</Label>
            <Input
              id="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
              className="border-slate-300 focus-visible:ring-amber-500"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="message" className="text-slate-700 font-bold">Message</Label>
            <Textarea
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={6}
              required
              className="border-slate-300 focus-visible:ring-amber-500"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="signature" className="text-slate-700 font-bold">Email Signature</Label>
            <Textarea
              id="signature"
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              rows={3}
              className="border-slate-300 focus-visible:ring-amber-500"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 mt-6 border-t border-slate-100">
            <Button 
              type="button" 
              variant="outline" 
              onClick={() => onOpenChange(false)}
              disabled={saving}
              className="font-bold"
            >
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={saving}
              className="bg-amber-500 hover:bg-amber-600 text-white font-bold px-6 shadow-md"
            >
              {saving ? (
                <span className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Sending Email...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Send className="w-4 h-4" /> Send Email
                </span>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}