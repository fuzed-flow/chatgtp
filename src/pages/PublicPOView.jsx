import React, { useRef } from "react";
import { supabase } from "@/api/supabaseClient";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { generatePOPDF } from "../components/pdf/PDFGenerator";
import { formatCurrencyUSD } from "../components/utils/formatCurrency";

export default function PublicPOView() {
  const params = new URLSearchParams(window.location.search);
  const poId = params.get("id") || window.location.pathname.split("/").pop();
  
  const [downloading, setDownloading] = React.useState(false);

  // --- 1. DIRECT SUPABASE DATA FETCHING ---
  const { data: po, isLoading: poLoading } = useQuery({
    queryKey: ["public-po", poId],
    queryFn: async () => {
      const { data, error } = await supabase.from("purchase_orders").select("*").eq("id", poId).single();
      if (error) throw error;
      return data;
    },
    enabled: !!poId,
  });

  const { data: vendor } = useQuery({
    queryKey: ["public-po-vendor", po?.vendor_id],
    queryFn: async () => {
      if (!po?.vendor_id) return null;
      const { data, error } = await supabase.from("vendors").select("*").eq("id", po.vendor_id).single();
      if (error && error.code !== 'PGRST116') throw error;
      return data;
    },
    enabled: !!po?.vendor_id,
  });

  const { data: org } = useQuery({
    queryKey: ["public-po-company", po?.company_id],
    queryFn: async () => {
      if (!po?.company_id) return null;
      const { data, error } = await supabase.from("companies").select("*").eq("id", po.company_id).single();
      if (error && error.code !== 'PGRST116') throw error;
      return data;
    },
    enabled: !!po?.company_id,
  });

  const { data: items = [] } = useQuery({
    queryKey: ["public-po-items", poId],
    queryFn: async () => {
      // ✅ Correct table name!
      const { data, error } = await supabase.from("purchase_order_line_items").select("*").eq("purchase_order_id", poId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!poId,
  });

  // ==========================================
  // ⚡ THE VIEW TRACKER & NOTIFIER LOCK
  // ==========================================
  const notificationFired = useRef(false);

  React.useEffect(() => {
    if (!po?.id || !org?.id) return;
    if (notificationFired.current) return;

    const vendorName = vendor?.company_name || vendor?.name || "A vendor";

    const notifyTeam = async () => {
      notificationFired.current = true; 
      
      try {
        const { data: { session } } = await supabase.auth.getSession();
        // const viewer_type = session?.user ? 'internal' : 'vendor';
        
        // ⚡ TEMPORARILY DISABLED THE LOCK: It will now fire 100% of the time
        // if (viewer_type === 'vendor') {
          await supabase.functions.invoke('company-notifier', {
            body: {
              event_key: "po_viewed",
              document_uuid: po.id,
              document_id: po.po_number || "PO",
              company_id: org.id, 
              message_body: `${vendorName} just viewed Purchase Order ${po.po_number || ''}`
            }
          });
        // }
      } catch (error) {
        console.error("Silent notification failed:", error);
        notificationFired.current = false; 
      }
    };
    
    notifyTeam();
  }, [po?.id, org?.id, vendor]);

  // --- 2. BRANDING SETUP ---
  const settings = org?.settings || {};
  const brandColor = settings?.pdf?.brand_color || '#f59e0b';
  const logoUrl = org?.logo_url || org?.company_logo_url;
  
  const primaryTaxRate = (settings?.tax_rate ?? 5) / 100;
  const secondaryTaxRate = settings?.enable_secondary_tax ? ((settings?.secondary_tax_rate ?? 7) / 100) : 0;
  
  const companyAddress = settings?.address || '';
  const companyPhone = settings?.phone || '';
  const companyEmail = settings?.email || '';
  const companyWebsite = settings?.website || '';
  const taxId = settings?.tax_id || '';

  const handleDownloadPDF = async () => {
    setDownloading(true);
    const loadingId = toast.loading("Generating PO PDF...");
    try {
      const cleanPoOverride = { ...po, hero_image_url: null };
      await generatePOPDF(cleanPoOverride, vendor, items, org);
      toast.success("PDF Downloaded successfully!", { id: loadingId });
    } catch (error) {
      console.error('Error downloading PDF:', error);
      toast.error("PDF download failed", { id: loadingId });
    }
    setDownloading(false);
  };

  if (poLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <p className="text-slate-500 font-medium animate-pulse">Loading secure purchase order...</p>
    </div>
  );

  if (!po) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <p className="text-slate-500">Purchase order not found</p>
    </div>
  );

  const subtotal = items.reduce((sum, item) => sum + (item.line_total || 0), 0);
  const primaryTaxAmount = subtotal * primaryTaxRate;
  const secondaryTaxAmount = subtotal * secondaryTaxRate;
  const total = subtotal + primaryTaxAmount + secondaryTaxAmount;

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <div className="max-w-4xl mx-auto py-8 px-4">
        
        <div className="text-center mb-10 flex flex-col items-center">
          {logoUrl && (
            <div className="h-20 w-48 mb-6 flex justify-center">
              <img src={logoUrl} alt="Logo" className="h-full w-full object-contain" />
            </div>
          )}
          {!logoUrl && (
              <h1 className="text-3xl font-black text-slate-900" style={{ color: brandColor }}>{org?.name || "Fuzed Flow"}</h1>
          )}
          
          <div className="text-sm text-slate-500 mt-3 space-y-1 max-w-md">
            {companyAddress && <p>{companyAddress}</p>}
            <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-2">
              {companyPhone && <p>Phone: {companyPhone}</p>}
              {companyEmail && <p>Email: {companyEmail}</p>}
              {companyWebsite && <p>{companyWebsite}</p>}
            </div>
            {taxId && <p className="mt-1">Tax ID: {taxId}</p>}
          </div>

          <h2 className="text-2xl font-bold text-slate-900 mt-10 mb-2">Purchase Order</h2>
          <p className="text-slate-600 font-medium">PO #{po.po_number || 'Draft'}</p>
        </div>

        <Card className="p-4 sm:p-8 mb-6 bg-white shadow-xl border-slate-200">
          <div className="grid md:grid-cols-2 gap-6 mb-8 pb-6 border-b border-slate-100">
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase mb-2 tracking-wider">Vendor</p>
              <p className="text-lg font-black text-slate-900">{vendor?.company_name || vendor?.name || 'Unknown Vendor'}</p>
              {vendor?.email && <p className="text-sm font-medium text-slate-600 mt-1">{vendor.email}</p>}
              {vendor?.phone && <p className="text-sm font-medium text-slate-600">{vendor.phone}</p>}
              
              {po.shipping_address && (
                <div className="mt-4">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Ship To</p>
                  <p className="text-sm font-medium text-slate-600 whitespace-pre-line">{po.shipping_address}</p>
                </div>
              )}
            </div>
            <div className="text-left md:text-right mt-4 md:mt-0">
              <p className="text-xs font-bold text-slate-400 uppercase mb-2 tracking-wider">Purchase Order Details</p>
              <div className="space-y-1.5">
                <div className="text-sm">
                  <span className="text-slate-500 font-medium">Date:</span>
                  <span className="font-bold text-slate-900 ml-2">
                    {po.order_date ? format(new Date(po.order_date), "MMM d, yyyy") : "—"}
                  </span>
                </div>
                {po.expected_delivery_date && (
                  <div className="text-sm">
                    <span className="text-slate-500 font-medium">Expected Delivery:</span>
                    <span className="font-bold text-slate-900 ml-2">
                      {format(new Date(po.expected_delivery_date), "MMM d, yyyy")}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {po.purpose && (
            <div className="mb-6 p-4 rounded-lg border" style={{ backgroundColor: `${brandColor}05`, borderColor: `${brandColor}30` }}>
              <p className="text-xs font-bold uppercase mb-1 tracking-wider" style={{ color: brandColor }}>Purpose</p>
              <p className="text-sm font-medium text-slate-900">{po.purpose}</p>
            </div>
          )}

          {po.vendor_quote_attachment && (
            <div className="mb-6 p-4 bg-slate-50 rounded-lg border border-slate-200">
              <p className="text-sm font-bold text-slate-900">Vendor Quote Attached</p>
              <a href={po.vendor_quote_attachment} target="_blank" rel="noopener noreferrer" className="text-sm font-medium hover:underline" style={{ color: brandColor }}>
                View Attachment
              </a>
            </div>
          )}

          <div className="mb-8">
            <h3 className="text-lg font-black text-slate-900 mb-4 pb-2 border-b-2" style={{ borderColor: brandColor }}>Items</h3>
            <div className="space-y-2">
              {items.length === 0 ? (
                <p className="text-center font-medium text-slate-500 py-8">No items added</p>
              ) : (
                items.map((item, idx) => {
                  const lineTotal = (Number(item.quantity) || 1) * (Number(item.unit_cost) || 0);
                  return (
                    <div key={idx} className="flex flex-col text-sm py-3 border-b border-slate-100">
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-slate-900">{item.item_name || item.product_name}</p>
                        {item.description && <p className="text-xs text-slate-500 mt-1 font-medium leading-relaxed whitespace-pre-wrap break-words">{item.description}</p>}
                      </div>
                      <div className="flex justify-end items-center gap-4 mt-2 pt-1">
                        <p className="text-xs font-medium text-slate-500">{item.quantity} {item.unit || ''} × {formatCurrencyUSD(item.unit_cost || 0)}</p>
                        <p className="font-black text-slate-900">{formatCurrencyUSD(lineTotal)}</p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {items.length > 0 && (
            <div className="rounded-xl p-4 sm:p-6 border-2 shadow-sm mb-6" style={{ backgroundColor: `${brandColor}05`, borderColor: `${brandColor}30` }}>
              <div className="space-y-3">
                <div className="flex justify-between text-lg font-medium">
                  <span className="text-slate-700">Subtotal:</span>
                  <span className="font-bold text-slate-900">{formatCurrencyUSD(po.subtotal || subtotal)}</span>
                </div>
                <div className="flex justify-between text-lg font-medium">
                  <span className="text-slate-700">{settings?.tax_label || "Tax"}:</span>
                  <span className="font-bold text-slate-900">{formatCurrencyUSD(po.tax !== undefined ? primaryTaxAmount : primaryTaxAmount)}</span>
                </div>
                {settings?.enable_secondary_tax && (
                  <div className="flex justify-between text-lg font-medium">
                    <span className="text-slate-700">{settings?.secondary_tax_label || "PST"}:</span>
                    <span className="font-bold text-slate-900">{formatCurrencyUSD(secondaryTaxAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center pt-4 border-t-2 mt-2" style={{ borderColor: `${brandColor}40` }}>
                  <span className="text-xl font-black text-slate-900">Total:</span>
                  <span className="text-3xl font-black" style={{ color: brandColor }}>{formatCurrencyUSD(po.total || total)}</span>
                </div>
              </div>
            </div>
          )}

          {(po.terms || po.notes) && (
            <div className="mt-8 pt-6 border-t border-slate-100 space-y-6">
              {po.notes && (
                <div>
                  <p className="text-xs font-black text-slate-400 uppercase tracking-wider mb-2">Delivery Notes & Instructions</p>
                  <p className="text-sm font-medium text-slate-600 whitespace-pre-wrap leading-relaxed break-words">{po.notes}</p>
                </div>
              )}
              {po.terms && (
                <div>
                  <p className="text-xs font-black text-slate-400 uppercase tracking-wider mb-2">Purchasing Terms</p>
                  <p className="text-sm font-medium text-slate-600 whitespace-pre-wrap leading-relaxed break-words">{po.terms}</p>
                </div>
              )}
            </div>
          )}
        </Card>

        <div className="flex justify-center">
          <Button onClick={handleDownloadPDF} disabled={downloading} className="shadow-lg font-black h-11 px-8 text-white transition-transform hover:scale-105" style={{ backgroundColor: brandColor }}>
            <Download className="h-4 w-4 mr-2" /> {downloading ? "Generating..." : "Download PDF"}
          </Button>
        </div>
      </div>
    </div>
  );
}