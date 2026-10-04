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
import { createPageUrl } from "../../utils";

export default function SendInvoiceTextDialog({ open, onOpenChange, invoice, client, onSuccess }) {
  const { settings, profile } = useAuth();
  
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [portalLink, setPortalLink] = useState("");
  const [saving, setSaving] = useState(false);
  const sendIntent = useRef(null);

  useEffect(() => {
    if (open && invoice && client) {
      setPhone(client.phone || "");

      // 1. Setup Variables
      const cName = client.name ? client.name.split(' ')[0] : 'there';
      const iNum = invoice.invoice_number || "Draft";
      const bDue = (invoice.balance_due || 0).toLocaleString("en-US", { minimumFractionDigits: 2 });
      
      // Generate the locked portal link for PublicInvoiceView
      const link = `${window.location.origin}${createPageUrl(`PublicInvoiceView?id=${invoice.id}`)}`;
      setPortalLink(link);

      // 2. Pull template from settings or use default
      const defaultTemplate = "Hi {{client_name}}, your invoice {{invoice_number}} for ${{balance_due}} is ready. Tap the link below to view and pay securely.";
      const rawTemplate = settings?.templates?.invoice_sms || defaultTemplate;

      // 3. Inject dynamic variables
      const personalizedMessage = rawTemplate
        .replace(/{{client_name}}/g, cName)
        .replace(/{{invoice_number}}/g, iNum)
        .replace(/{{balance_due}}/g, bDue);
      
      setMessage(personalizedMessage.trim());
    }
  }, [open, invoice, client, settings]);

  const handleSend = async (e) => {
    e.preventDefault();

    if (!phone.trim()) {
      toast.error("Phone number is required");
      return;
    }

    setSaving(true);
    const loadingToast = toast.loading("Sending SMS...");

    // COMBINE MESSAGE AND LINK SAFELY BEHIND THE SCENES
    const finalSmsPayload = `${message}\n\n${portalLink}`;

    try {
      // ⚡ 2. TRIGGER SUPABASE EDGE FUNCTION
      const signature = JSON.stringify([invoice.id, phone.trim(), finalSmsPayload]);
      if (sendIntent.current?.signature !== signature) sendIntent.current = { signature, requestId: crypto.randomUUID(), accepted: false };
      if (!sendIntent.current.accepted) {
        const { data, error: fnError } = await supabase.functions.invoke('send-sms', {
          body: { phone_number: phone.trim(), message_body: finalSmsPayload, document_type: "invoice", document_id: invoice.id, request_id: sendIntent.current.requestId }
        });
        if (fnError || data?.success !== true) throw new Error(data?.error || fnError?.message || "SMS acceptance could not be confirmed");
        sendIntent.current.accepted = true;
      }
      // Provider acceptance precedes the status change; retries never send another accepted SMS.
      const { error: statusError } = await supabase.from("invoices").update({ status: "Sent" }).eq("id", invoice.id).eq("company_id", profile.company_id).eq("status", "Draft");
      if (statusError) throw new Error("SMS was sent, but document status could not be saved. Retry to update the status.");
      sendIntent.current = null;

      toast.success(`Invoice successfully texted to ${phone}!`, { id: loadingToast });
      onSuccess?.();
      onOpenChange(false);
    } catch (error) {
      console.error("Error sending text:", error);
      toast.error(`Failed to send text: ${error.message}`, { id: loadingToast });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:max-w-lg bg-slate-50 p-0 overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* HEADER */}
        <DialogHeader className="px-6 py-4 bg-white border-b border-slate-200 shrink-0">
          <DialogTitle className="text-xl font-black text-slate-900 flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-amber-500" /> Text Invoice (SMS)
          </DialogTitle>
        </DialogHeader>

        {/* SCROLLABLE FORM AREA */}
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
                  {/* Editable Area */}
                  <Textarea 
                    value={message} 
                    onChange={(e) => setMessage(e.target.value)} 
                    rows={4} 
                    className="resize-none font-medium text-sm leading-relaxed border-0 shadow-none focus-visible:ring-0 rounded-none bg-white w-full" 
                  />
                  
                  {/* Locked Link Area */}
                  <div className="px-3 py-2.5 bg-slate-100 border-t border-slate-200 flex items-center gap-2 w-full overflow-hidden">
                    <LinkIcon className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    <span className="text-xs text-slate-500 font-medium truncate flex-1 min-w-0 select-all">{portalLink}</span>
                    <Lock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                  </div>
                </div>

                <p className="text-[10px] text-slate-400 font-medium">Standard SMS messaging rates apply. The secure payment link is attached to the bottom of your message.</p>
              </div>
            </Card>
          </div>

          {/* STICKY FOOTER */}
          <div className="flex justify-end gap-3 p-4 bg-white border-t border-slate-200 shrink-0">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving} className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold px-6">
              {saving ? "Sending..." : <><Send className="h-4 w-4 mr-2" /> Send Text</>}
            </Button>
          </div>

        </form>
      </DialogContent>
    </Dialog>
  );
}