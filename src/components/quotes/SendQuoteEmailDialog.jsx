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

export default function SendQuoteEmailDialog({ open, onOpenChange, quoteId, quoteName, clientName, clientEmail, onSuccess }) {
  const { profile, settings: authSettings } = useAuth();
  
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [signature, setSignature] = useState("");
  const [saving, setSaving] = useState(false);
  
  const [companyData, setCompanyData] = useState(null);
  const [quoteData, setQuoteData] = useState(null);

  // --- INITIALIZATION & DYNAMIC TEMPLATING ---
  useEffect(() => {
    if (!open || !quoteId) return;

    let isMounted = true;

    const fetchSetupData = async () => {
      // 1. Fetch quote details (👇 ADDED lead_id HERE)
      const { data: qData } = await supabase
        .from("quotes")
        .select("quote_number, title, client_id, lead_id, company_id") 
        .eq("id", quoteId)
        .single();

      if (!isMounted) return;
      setQuoteData(qData);

      // 2. BULLETPROOF BRAND FETCHING
      const targetCompanyId = qData?.company_id || profile?.company_id;
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

      // Check Clients Table First...
      if ((!resolvedEmail || !resolvedName) && qData?.client_id) {
        const { data: cData } = await supabase
          .from("clients")
          .select("name, email")
          .eq("id", qData.client_id)
          .single();

        if (cData) {
          if (!resolvedEmail) resolvedEmail = cData.email;
          if (!resolvedName) resolvedName = cData.name;
        }
      } 
      // 👇 NEW: Check Leads Table if no client exists!
      else if ((!resolvedEmail || !resolvedName) && qData?.lead_id) {
        const { data: lData } = await supabase
          .from("leads")
          .select("contact_name, contact_email")
          .eq("id", qData.lead_id)
          .single();

        if (lData) {
          if (!resolvedEmail) resolvedEmail = lData.contact_email;
          if (!resolvedName) resolvedName = lData.contact_name;
        }
      }

      // 4. Populate Form State
      setEmail(resolvedEmail || "");

      const qNum = qData?.quote_number || "Draft";
      const qTitle = qData?.title || quoteName || "Project";
      
      const finalCompanyName = compData?.name || authSettings?.company_name || authSettings?.name || "Our Company";
      setSubject(`Your Quote From ${finalCompanyName} is Ready To View`);

      const cName = resolvedName ? resolvedName.split(' ')[0] : 'there';
      const myName = profile?.full_name || "Your Fuzed Flow Team";

      // 5. Build Dynamic Message Body
      const defaultBody = "Hi {{client_name}},\n\nPlease find your project quote {{quote_number}} for {{quote_title}} ready for review.\n\nYou can review the line items, choose optional additions, and securely sign off on the package using the interactive link below.";
      const rawBody = authSettings?.templates?.quote_email_body || defaultBody;

      const personalizedBody = rawBody
        .replace(/{{client_name}}/g, cName)
        .replace(/{{quote_number}}/g, qNum)
        .replace(/{{quote_title}}/g, qTitle);
      
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
  }, [open, quoteId, clientEmail, clientName, quoteName, authSettings, profile]);

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
      const quoteUrl = `${baseUrl}${createPageUrl(`PublicQuoteView?id=${quoteId}`)}`;
      const portalUrl = `${baseUrl}${createPageUrl(`ClientPortal?id=${quoteData?.client_id}`)}`; 
      
      const companyName = companyData?.name || authSettings?.company_name || authSettings?.name || "Your Contractor";
      const logoUrl = companyData?.logo_url || companyData?.company_logo_url || "https://ochqexofahdssmarnict.supabase.co/storage/v1/object/public/logos/fuzed-flow-logo.png";
      const displayTitle = quoteName || quoteData?.title || 'Project Quote';
      
      // Extract color safely from JSON, default to FuzedFlow Amber
      const buttonColor = companyData?.settings?.pdf?.brand_color || "#f59e0b";

      // 🚀 PREMIUM SAAS EMAIL TEMPLATE
      const emailHtml = `
        <div style="background-color: #f8fafc; padding: 40px 20px; font-family: 'Segoe UI', Inter, Helvetica, Arial, sans-serif; color: #1e293b;">
          <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
            
            <div style="padding: 30px; text-align: center; border-bottom: 1px solid #f1f5f9;">
              <img src="${logoUrl}" alt="${companyName} Logo" style="max-height: 50px; width: auto; object-fit: contain; margin-bottom: 15px;" />
              <h1 style="margin: 0; font-size: 24px; font-weight: 800; color: #0f172a; letter-spacing: -0.5px;">Your Quote is Ready</h1>
            </div>
            
            <div style="padding: 40px 30px;">
              <div style="font-size: 16px; line-height: 1.6; color: #334155; margin-bottom: 30px;">
                ${customMessageHtml}
              </div>
              
              <div style="background-color: #f8fafc; border-radius: 8px; padding: 30px; border: 1px solid #e2e8f0; text-align: center;">
                <p style="margin: 0 0 10px 0; font-size: 14px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">
                  Quote Details
                </p>
                <p style="margin: 0 0 25px 0; font-size: 18px; font-weight: 700; color: #0f172a;">
                  ${displayTitle}
                </p>
                
                <a href="${quoteUrl}" target="_blank" style="font-size: 16px; font-weight: 700; font-family: Helvetica, Arial, sans-serif; color: #ffffff; background-color: ${buttonColor}; text-decoration: none; border-radius: 999px; padding: 16px 32px; display: inline-block; margin-bottom: 15px; border: 1px solid ${buttonColor};">
                  View & Accept Quote
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
      // Safely pull the exact company email from the database settings JSON
      const companyEmail = companyData?.settings?.email || authSettings?.email || profile?.email;
      const replyToEmail = companyEmail || "info@fuzedflow.com";

      const { data, error } = await supabase.functions.invoke('send-email', {
        body: {
          to_email: email,
          subject: subject,
          html_body: emailHtml,
          client_id: quoteData?.client_id || null,
          reply_to: replyToEmail // 🚨 Now perfectly passes info@lbprojects.ca!
        }
      });

      if (error) {
        throw new Error(error.message || "Failed to send email via Edge Function");
      }

      // 5. Update Status
      await supabase.from("quotes").update({ status: "Sent" }).eq("id", quoteId);
      
      toast.success("Email sent successfully!");
      onOpenChange(false);
      if (onSuccess) onSuccess();

    } catch (error) {
      console.error("Error sending email:", error);
      toast.error("Failed to send email. Please check your backend CORS settings.");
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
            Send Quote via Email
          </DialogTitle>
          <DialogDescription className="hidden">
            Send a secure quote email with your custom branding.
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