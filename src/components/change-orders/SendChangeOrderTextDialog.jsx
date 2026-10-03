import React, { useState, useEffect } from "react";
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

export default function SendChangeOrderTextDialog({ open, onOpenChange, changeOrderId, coName, clientName, clientPhone, onSuccess }) {
  const { settings } = useAuth();
  
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [portalLink, setPortalLink] = useState("");
  const [saving, setSaving] = useState(false);
  const [coData, setCoData] = useState(null);

  useEffect(() => {
    if (open && changeOrderId) {
      // ⚡ DEEP FETCH TO GET CLIENT ID FROM ATTACHED PROJECT
      supabase.from("change_orders").select("change_order_number, title, projects(client_id)").eq("id", changeOrderId).single()
        .then(({ data }) => setCoData(data));
    }
  }, [open, changeOrderId]);

  useEffect(() => {
    if (open && changeOrderId) {
      setPhone(clientPhone || "");

      const link = `${window.location.origin}${createPageUrl(`PublicChangeOrderView?id=${changeOrderId}`)}`;
      setPortalLink(link);

      const cName = clientName ? clientName.split(' ')[0] : 'there';
      const cNum = coData?.change_order_number || "Draft";

      const defaultTemplate = "Hi {{client_name}}, Change Order {{co_number}} has been requested for your project. Tap the link to authorize the adjustment:";
      const rawTemplate = settings?.templates?.co_sms || defaultTemplate;

      const personalizedMessage = rawTemplate
        .replace(/{{client_name}}/g, cName)
        .replace(/{{co_number}}/g, cNum);
      
      setMessage(personalizedMessage.trim());
    }
  }, [open, changeOrderId, coData, clientName, clientPhone, settings]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!phone.trim()) { toast.error("Phone number is required"); return; }

    setSaving(true);
    const loadingToast = toast.loading("Sending SMS...");
    const finalSmsPayload = `${message}\n\n${portalLink}`;

    try {
      // ⚡ EXTRACT CLIENT ID SAFELY
      let clientId = null;
      if (coData?.projects) {
        clientId = Array.isArray(coData.projects) ? coData.projects[0]?.client_id : coData.projects?.client_id;
      }

      await supabase.from("change_orders").update({ status: "Sent" }).eq("id", changeOrderId);
      
      // ⚡ TRIGGER SUPABASE EDGE FUNCTION
      const { data, error: fnError } = await supabase.functions.invoke('send-sms', { 
        body: { 
          phone_number: phone.trim(), 
          message_body: finalSmsPayload,
          client_id: clientId || null
        } 
      });

      if (fnError) throw new Error(fnError.message || "Failed to trigger SMS function");

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
            <Button type="submit" disabled={saving} className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold px-6">
              {saving ? "Sending..." : <><Send className="h-4 w-4 mr-2" /> Send Text</>}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}