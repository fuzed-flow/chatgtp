import { parseRecordDate, paymentDate } from "@/lib/reporting";
import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Send, ArrowRight, ArrowLeft, Receipt, CheckSquare } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Checkbox } from "@/components/ui/checkbox";
// ⚡ IMPORT THE NEW PDF GENERATOR
import { generateReceiptPDF } from "../pdf/PDFGenerator";

export default function SendReceiptDialog({ open, onOpenChange, payments, invoices, clients }) {
  const { profile, settings: authSettings } = useAuth();
  
  const [step, setStep] = useState(1);
  const [selectedClientId, setSelectedClientId] = useState("all");
  const [selectedPaymentIds, setSelectedPaymentIds] = useState([]);
  
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("Your Payment Receipt");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const sendIntent = useRef(null);
  
  // ⚡ STATE TO HOLD ACTUAL COMPANY DATA
  const [companyData, setCompanyData] = useState(null);

  // ⚡ FETCH COMPANY DATA ON MOUNT
  useEffect(() => {
    const fetchCompany = async () => {
      if (profile?.company_id) {
        const { data } = await supabase.from("companies").select("*").eq("id", profile.company_id).single();
        if (data) setCompanyData(data);
      }
    };
    if (open) fetchCompany();
  }, [profile, open]);

  const availablePayments = payments.filter(p => {
    if (selectedClientId === "all") return false; 
    const inv = invoices.find(i => i.id === p.invoice_id);
    return inv?.client_id === selectedClientId;
  });

  const totalSelectedAmount = availablePayments
    .filter(p => selectedPaymentIds.includes(p.id))
    .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

  const handleNextStep = () => {
    if (selectedPaymentIds.length === 0) return toast.error("Please select at least one payment.");
    
    const client = clients.find(c => c.id === selectedClientId);
    if (client) {
      // ⚡ AUTO-FILLS EMAIL (Now that we added it to the query in Step 1!)
      setEmail(client.email || "");
      
      const cName = client.name ? client.name.split(' ')[0] : 'there';
      // ⚡ USES REAL COMPANY NAME
      const cpyName = companyData?.name || authSettings?.company_name || "Our Company";
      
      setSubject(`Payment Receipt from ${cpyName}`);
      setMessage(`Hi ${cName},\n\nThank you for your recent payments! Attached is a detailed PDF receipt for your records.\n\nWe truly appreciate your business. Please let us know if you have any questions.`);
    }
    setStep(2);
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!email) return toast.error("Please provide an email address.");

    try {
      setSaving(true);
      
      const selectedPaymentsData = availablePayments.filter(p => selectedPaymentIds.includes(p.id));
      const activeClient = clients.find(c => c.id === selectedClientId);
      
      // ⚡ GENERATE THE BASE64 PDF ATTACHMENT
      const base64Pdf = await generateReceiptPDF(activeClient, selectedPaymentsData, invoices, companyData, { returnBase64: true });
      
      let paymentRowsHtml = "";
      selectedPaymentsData.forEach(p => {
        const inv = invoices.find(i => i.id === p.invoice_id);
        const dateStr = parseRecordDate(paymentDate(p)) ? format(parseRecordDate(paymentDate(p)), "MMM d, yyyy") : "Unknown Date";
        paymentRowsHtml += `
          <tr>
            <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; color: #475569; font-size: 14px;">${dateStr}</td>
            <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; color: #0f172a; font-weight: 600; font-size: 14px;">${inv?.invoice_number || 'Unknown'}</td>
            <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; color: #475569; font-size: 14px;">${p.payment_method || 'Payment'}</td>
            <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; color: #0f172a; font-weight: 700; text-align: right; font-size: 14px;">$${Number(p.amount).toLocaleString("en-US", {minimumFractionDigits: 2})}</td>
          </tr>
        `;
      });

      const customMessageHtml = (message || "").replace(/\n/g, '<br>');
      const finalCompanyName = companyData?.name || "Your Contractor";
      const brandColor = companyData?.settings?.pdf?.brand_color || "#10b981";
      
      // ⚡ ADD LOGO URL
      const logoUrl = companyData?.logo_url || companyData?.company_logo_url || "";
      const logoHtml = logoUrl 
        ? `<img src="${logoUrl}" alt="${finalCompanyName} Logo" style="max-height: 50px; width: auto; object-fit: contain; margin-bottom: 15px;" />` 
        : '';

      const emailHtml = `
        <div style="background-color: #f8fafc; padding: 40px 20px; font-family: 'Segoe UI', Inter, Helvetica, Arial, sans-serif; color: #1e293b;">
          <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
            
            <div style="padding: 30px; text-align: center; border-bottom: 1px solid #f1f5f9; background-color: #ffffff;">
              ${logoHtml}
              <h1 style="margin: 0; font-size: 24px; font-weight: 800; color: ${brandColor}; letter-spacing: -0.5px;">Payment Receipt</h1>
            </div>
            
            <div style="padding: 40px 30px;">
              <div style="font-size: 16px; line-height: 1.6; color: #334155; margin-bottom: 30px;">
                ${customMessageHtml}
              </div>
              
              <div style="border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
                <table width="100%" cellspacing="0" cellpadding="0" style="text-align: left;">
                  <thead>
                    <tr style="background-color: #f8fafc;">
                      <th style="padding: 12px; font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase;">Date</th>
                      <th style="padding: 12px; font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase;">Invoice</th>
                      <th style="padding: 12px; font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase;">Method</th>
                      <th style="padding: 12px; font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; text-align: right;">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${paymentRowsHtml}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colspan="3" style="padding: 16px 12px; font-weight: 700; color: #0f172a; text-align: right;">Total Received:</td>
                      <td style="padding: 16px 12px; font-weight: 800; color: ${brandColor}; text-align: right; font-size: 16px;">$${totalSelectedAmount.toLocaleString("en-US", {minimumFractionDigits: 2})}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
          
          <div style="max-width: 600px; margin: 30px auto 0; text-align: center; color: #94a3b8;">
            <p style="margin: 0; font-size: 12px; font-weight: 500;">Sent securely via FuzedFlow</p>
            <p style="margin: 5px 0 0 0; font-size: 12px;">&copy; ${new Date().getFullYear()} ${finalCompanyName}. All rights reserved.</p>
          </div>
        </div>
      `;

      // ⚡ ATTACH THE PDF TO THE EDGE FUNCTION PAYLOAD
      const signature = JSON.stringify([selectedClientId, selectedPaymentIds, email, subject, message]);
      if (sendIntent.current?.signature !== signature) sendIntent.current = { signature, payload: {
          to_email: email,
          subject: subject,
          html_body: emailHtml,
          client_id: selectedClientId,
          document_type: "invoice",
          document_id: selectedPaymentsData[0]?.invoice_id,
          notification_kind: "receipt",
          request_id: crypto.randomUUID(),
          track_replies: true,
          attachments: [
            {
              content: base64Pdf,
              filename: `Payment_Receipt_${format(new Date(), 'MMM_dd_yyyy')}.pdf`,
              type: "application/pdf"
            }
          ]
        } };
      const { data, error } = await supabase.functions.invoke('send-email', { body: sendIntent.current.payload });
      if (error || data?.success !== true) throw new Error(data?.error || error?.message || "Receipt delivery could not be confirmed");
      sendIntent.current = null;

      toast.success("Receipt sent with PDF attachment!");
      setStep(1);
      setSelectedPaymentIds([]);
      onOpenChange(false);

    } catch (error) {
      toast.error("Failed to send receipt. Please check console.");
      console.error(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      onOpenChange(isOpen);
      if (!isOpen) { setStep(1); setSelectedPaymentIds([]); }
    }}>
      <DialogContent className="sm:max-w-[600px] bg-white border-slate-200">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-bold text-slate-900">
            <Receipt className="w-5 h-5 text-emerald-500" />
            Send Payment Receipts
          </DialogTitle>
        </DialogHeader>

        {step === 1 ? (
          <div className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label className="text-slate-700 font-bold">1. Select Client</Label>
              <Select value={selectedClientId} onValueChange={(val) => { setSelectedClientId(val); setSelectedPaymentIds([]); }}>
                <SelectTrigger className="border-slate-300">
                  <SelectValue placeholder="Choose a client to view payments..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">-- Select a Client --</SelectItem>
                  {clients.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedClientId !== "all" && (
              <div className="space-y-2 mt-4">
                <div className="flex items-center justify-between">
                  <Label className="text-slate-700 font-bold">2. Select Payments to Include</Label>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => setSelectedPaymentIds(availablePayments.length === selectedPaymentIds.length ? [] : availablePayments.map(p => p.id))}
                    className="h-6 text-xs font-bold text-amber-700 hover:text-amber-900"
                  >
                    <CheckSquare className="h-3 w-3 mr-1" /> Select All
                  </Button>
                </div>
                
                <div className="border border-slate-200 rounded-lg max-h-[250px] overflow-y-auto p-2 bg-slate-50 space-y-1">
                  {availablePayments.length === 0 ? (
                    <p className="text-sm text-slate-500 text-center py-4 font-medium">No recorded payments found for this client.</p>
                  ) : (
                    availablePayments.map(p => {
                      const inv = invoices.find(i => i.id === p.invoice_id);
                      return (
                        <label key={p.id} className="flex items-center gap-3 p-3 bg-white rounded border border-slate-100 hover:border-blue-200 cursor-pointer shadow-sm transition-colors">
                          <Checkbox 
                            checked={selectedPaymentIds.includes(p.id)}
                            onCheckedChange={(checked) => {
                              if (checked) setSelectedPaymentIds([...selectedPaymentIds, p.id]);
                              else setSelectedPaymentIds(selectedPaymentIds.filter(id => id !== p.id));
                            }}
                          />
                          <div className="flex-1">
                            <p className="text-sm font-bold text-slate-900">{inv?.invoice_number || 'Unknown Invoice'}</p>
                            <p className="text-xs font-medium text-slate-500">
                              {parseRecordDate(paymentDate(p)) ? format(parseRecordDate(paymentDate(p)), "MMM d, yyyy") : "Unknown Date"} • {p.payment_method}
                            </p>
                          </div>
                          <div className="font-bold text-emerald-600">
                            +${Number(p.amount || 0).toLocaleString("en-US", {minimumFractionDigits: 2})}
                          </div>
                        </label>
                      );
                    })
                  )}
                </div>
                
                <div className="flex justify-between items-center py-2 px-1">
                  <span className="text-sm font-bold text-slate-600">Total Selected:</span>
                  <span className="text-lg font-black text-emerald-600">${totalSelectedAmount.toLocaleString("en-US", {minimumFractionDigits: 2})}</span>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 mt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="font-bold">Cancel</Button>
              <Button type="button" onClick={handleNextStep} disabled={selectedPaymentIds.length === 0} className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold">
                Next Step <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSend} className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label className="text-slate-700 font-bold">To (Client Email)</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="border-slate-300" />
            </div>

            <div className="space-y-2">
              <Label className="text-slate-700 font-bold">Subject</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} required className="border-slate-300" />
            </div>

            <div className="space-y-2">
              <Label className="text-slate-700 font-bold">Message</Label>
              <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} required className="border-slate-300" />
            </div>

            <div className="flex justify-between items-center pt-4 border-t border-slate-100 mt-4">
              <Button type="button" variant="ghost" onClick={() => setStep(1)} disabled={saving} className="font-bold text-slate-500">
                <ArrowLeft className="w-4 h-4 mr-2" /> Back
              </Button>
              <div className="flex gap-2">
                <Button type="submit" disabled={saving} className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold px-6">
                  {saving ? "Sending..." : <><Send className="w-4 h-4 mr-2" /> Send Receipt</>}
                </Button>
              </div>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
