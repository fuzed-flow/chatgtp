import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { MessageSquare, Send, Link as LinkIcon, Lock } from "lucide-react";
import { toast } from "sonner";

function buildSecureInvoiceUrl(invoiceId, token) {
  const url = new URL("/PublicInvoiceView", window.location.origin);
  url.searchParams.set("id", invoiceId);
  url.searchParams.set("token", token);
  return url.toString();
}

async function readFunctionError(error, data) {
  let message = data?.error || error?.message || "SMS acceptance could not be confirmed.";
  try {
    const response = await error?.context?.json?.();
    if (typeof response?.error === "string") message = response.error;
  } catch { /* Keep the transport error when the response body is unavailable. */ }
  const result = new Error(message);
  result.status = error?.context?.status;
  return result;
}

export default function SendInvoiceTextDialog({ open, onOpenChange, invoice, client, onSuccess }) {
  const { settings, profile } = useAuth();
  
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [portalLink, setPortalLink] = useState("");
  const [saving, setSaving] = useState(false);
  const [retryMode, setRetryMode] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const sendIntent = useRef(null);
  const inputsLocked = saving || Boolean(retryMode);

  useEffect(() => {
    if (open && invoice?.id && client) {
      setPhone(client.phone || "");
      setPortalLink("");
      setRetryMode(null);
      setErrorMessage("");
      sendIntent.current = null;

      // 1. Setup Variables
      const cName = client.name ? client.name.split(' ')[0] : 'there';
      const iNum = invoice.invoice_number || "Draft";
      const bDue = (invoice.balance_due || 0).toLocaleString("en-US", { minimumFractionDigits: 2 });
      
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
  }, [open, invoice?.id, invoice?.invoice_number, invoice?.balance_due, client?.id, client?.name,
    client?.phone, settings?.templates?.invoice_sms]);

  const handleOpenChange = nextOpen => {
    if (!nextOpen && (saving || retryMode === "delivery" || retryMode === "status")) return;
    onOpenChange(nextOpen);
  };

  const editFailedDelivery = () => {
    sendIntent.current = null;
    setPortalLink("");
    setRetryMode(null);
    setErrorMessage("");
  };

  const handleSend = async (e) => {
    e.preventDefault();

    if (!phone.trim()) {
      toast.error("Phone number is required");
      return;
    }

    setSaving(true);
    setErrorMessage("");
    const loadingToast = toast.loading("Sending SMS...");

    try {
      let intent = sendIntent.current;
      if (!intent) {
        // Create and freeze the complete send intent immediately before delivery.
        // A retry must reuse the same token, payload and request ID so an uncertain
        // transport response cannot create a duplicate text message.
        const { data: shareToken, error: shareError } = await supabase.rpc("issue_invoice_share_token", {
          p_invoice: invoice.id,
        });
        if (shareError || typeof shareToken !== "string" || !/^[a-f0-9]{64}$/i.test(shareToken)) {
          throw new Error("A secure invoice link could not be created. Please try again.");
        }
        const secureLink = buildSecureInvoiceUrl(invoice.id, shareToken);
        setPortalLink(secureLink);
        const finalSmsPayload = `${message}\n\n${secureLink}`;
        intent = {
          requestId: crypto.randomUUID(),
          accepted: false,
          payload: {
            phone_number: phone.trim(),
            message_body: finalSmsPayload,
            document_type: "invoice",
            document_id: invoice.id,
          },
        };
        sendIntent.current = intent;
      }

      if (!intent.accepted) {
        const { data, error: fnError } = await supabase.functions.invoke('send-sms', {
          body: { ...intent.payload, request_id: intent.requestId }
        });
        if (fnError || data?.success !== true) {
          const deliveryError = await readFunctionError(fnError, data);
          if (deliveryError.status === 400) {
            sendIntent.current = null;
            setRetryMode(null);
          } else if (/still being confirmed|check communication history|could not be confirmed/i.test(deliveryError.message)) {
            setRetryMode("check");
          } else if (/delivery failed|provider rejected/i.test(deliveryError.message)) {
            setRetryMode("failed");
          } else {
            setRetryMode("delivery");
          }
          throw deliveryError;
        }
        intent.accepted = true;
      }

      setRetryMode("status");
      // Provider acceptance precedes the status change; retries never send another accepted SMS.
      const { error: statusError } = await supabase.from("invoices").update({ status: "Sent" }).eq("id", invoice.id).eq("company_id", profile.company_id).eq("status", "Draft");
      if (statusError) throw new Error("SMS was sent, but document status could not be saved. Retry to update the status.");
      sendIntent.current = null;
      setRetryMode(null);

      toast.success(`Invoice successfully texted to ${intent.payload.phone_number}!`, { id: loadingToast });
      onSuccess?.();
      onOpenChange(false);
    } catch (error) {
      console.error("Error sending text:", error);
      setErrorMessage(error.message || "The invoice text could not be sent.");
      toast.error(`Failed to send text: ${error.message}`, { id: loadingToast });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[95vw] sm:max-w-lg bg-slate-50 p-0 overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* HEADER */}
        <DialogHeader className="px-6 py-4 bg-white border-b border-slate-200 shrink-0">
          <DialogTitle className="text-xl font-black text-slate-900 flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-amber-500" /> Text Invoice (SMS)
          </DialogTitle>
          <DialogDescription className="sr-only">Send a private invoice link to the client's mobile phone.</DialogDescription>
        </DialogHeader>

        {/* SCROLLABLE FORM AREA */}
        <form onSubmit={handleSend} className="flex flex-col flex-1 overflow-hidden">
          
          <div className="p-6 space-y-4 overflow-y-auto flex-1">
            <Card className="p-5 border-slate-200 shadow-sm space-y-4 bg-white">
              
              <div className="w-full">
                <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Mobile Phone Number *</Label>
                <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 123-4567" className="font-medium text-slate-900 w-full" autoFocus disabled={inputsLocked} />
              </div>

              <div className="space-y-2 w-full">
                <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Text Message</Label>
                
                <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50 focus-within:ring-2 focus-within:ring-amber-500 transition-all flex flex-col w-full">
                  {/* Editable Area */}
                  <Textarea 
                    value={message} 
                    onChange={(e) => setMessage(e.target.value)} 
                    rows={4} 
                    disabled={inputsLocked}
                    className="resize-none font-medium text-sm leading-relaxed border-0 shadow-none focus-visible:ring-0 rounded-none bg-white w-full" 
                  />
                  
                  {/* Locked Link Area */}
                  <div className="px-3 py-2.5 bg-slate-100 border-t border-slate-200 flex items-center gap-2 w-full overflow-hidden">
                    <LinkIcon className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    <span className="text-xs text-slate-500 font-medium truncate flex-1 min-w-0 select-all">
                      {portalLink || "A private invoice link will be generated when you send."}
                    </span>
                    <Lock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                  </div>
                </div>

                <p className="text-[10px] text-slate-400 font-medium">Standard SMS messaging rates apply. The secure payment link is attached to the bottom of your message.</p>
              </div>
            </Card>
            {errorMessage && (
              <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                {errorMessage}
              </div>
            )}
          </div>

          {/* STICKY FOOTER */}
          <div className="flex justify-end gap-3 p-4 bg-white border-t border-slate-200 shrink-0">
            {retryMode === "failed" && (
              <Button type="button" variant="outline" onClick={editFailedDelivery} disabled={saving}>Edit and retry</Button>
            )}
            {(retryMode === "check" || retryMode === "delivery") ? (
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Close &amp; check history</Button>
            ) : (
              <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)} disabled={saving || retryMode === "status"}>Cancel</Button>
            )}
            <Button type="submit" disabled={saving || retryMode === "check"} className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold px-6">
              {saving ? "Sending..." : <><Send className="h-4 w-4 mr-2" /> {retryMode === "status" ? "Retry status" : retryMode ? "Retry text" : "Send Text"}</>}
            </Button>
          </div>

        </form>
      </DialogContent>
    </Dialog>
  );
}
