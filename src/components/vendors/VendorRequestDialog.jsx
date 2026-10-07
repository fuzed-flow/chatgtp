import React, { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Upload, X, FileText, Send } from "lucide-react";
import { toast } from "sonner";
import { isValidCompanyEmail } from "@/lib/emailCopy";

// Helper to format client names
const getClientName = (c) => {
  if (!c) return "";
  if (c.name && c.name.trim() !== "") return c.name;
  const fullName = [c.first_name, c.surname].filter(Boolean).join(" ");
  if (fullName && fullName.trim() !== "") return fullName;
  if (c.primary_contact_name && c.primary_contact_name.trim() !== "") return c.primary_contact_name;
  return "";
};

// Helper to format lead names
const getLeadName = (l) => {
  if (!l) return "Unknown Lead";
  if (l.contact_name && l.contact_name.trim() !== "") return l.contact_name;
  return "Unnamed Lead";
};

export default function VendorRequestDialog({ open, onOpenChange, initialVendor = null }) {
  const { profile } = useAuth();
  const companyId = profile?.company_id;
  const qc = useQueryClient();
  const fileInputRef = useRef(null);
  const delivery = useRef(null);
  const sendLock = useRef(false);

  const [form, setForm] = useState({
    vendor_id: "none", context_type: "none", context_id: "none",
    email_to: "", email_cc: "", email_bcc: "",
    title: "", scope_of_work: "", due_date: "", priority: "Medium"
  });

  const [customFiles, setCustomFiles] = useState([]);
  const [sendCopy, setSendCopy] = useState(false);
  const [contextFiles, setContextFiles] = useState([]); 
  const [selectedContextFiles, setSelectedContextFiles] = useState([]);

  // --- QUERIES ---
  const { data: company } = useQuery({ queryKey: ["company", companyId], enabled: !!companyId, queryFn: async () => (await supabase.from("companies").select("*").eq("id", companyId).single()).data });
  const { data: vendors = [] } = useQuery({ queryKey: ["vendors", companyId], enabled: !!companyId, queryFn: async () => (await supabase.from("vendors").select("*").eq("company_id", companyId)).data || [] });
  
  // ⚡ JOIN CLIENTS DIRECTLY WITH PROJECTS TO GUARANTEE CLIENT NAME
  const { data: projects = [] } = useQuery({ 
    queryKey: ["projects_with_clients", companyId], 
    enabled: !!companyId, 
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, client_id, site_address, clients(id, name, first_name, surname, primary_contact_name)")
        .eq("company_id", companyId);
      if (error) throw error;
      return data || [];
    } 
  });
  
  const { data: leads = [] } = useQuery({ queryKey: ["leads", companyId], enabled: !!companyId, queryFn: async () => (await supabase.from("leads").select("id, contact_name, site_address").eq("company_id", companyId)).data || [] });
  const { data: clients = [] } = useQuery({ queryKey: ["clients", companyId], enabled: !!companyId, queryFn: async () => (await supabase.from("clients").select("id, name, first_name, surname, primary_contact_name, site_address, billing_address").eq("company_id", companyId)).data || [] });

  useEffect(() => {
    if (open) {
      delivery.current = null;
      if (initialVendor) {
        setForm(f => ({ ...f, vendor_id: String(initialVendor.id), email_to: initialVendor.email || "" }));
      } else {
        setForm({ vendor_id: "none", context_type: "none", context_id: "none", email_to: "", email_cc: "", email_bcc: "", title: "", scope_of_work: "", due_date: "", priority: "Medium" });
      }
      setCustomFiles([]); setContextFiles([]); setSelectedContextFiles([]);
      setSendCopy(false);
    }
  }, [open, initialVendor]);

  const handleVendorChange = (vId) => {
    const v = vendors.find(x => String(x.id) === String(vId));
    setForm(f => ({ ...f, vendor_id: String(vId), email_to: v?.email || "" }));
  };

  useEffect(() => {
    const fetchContextFiles = async () => {
      if (form.context_type === "none" || form.context_id === "none") {
        setContextFiles([]); return;
      }
      let extractedFiles = [];
      
      if (form.context_type === "project") {
        const { data } = await supabase.from("projects").select("end_photos, documents").eq("id", form.context_id).eq('company_id', companyId).single();
        if (data) {
          if (data.end_photos) extractedFiles = [...extractedFiles, ...data.end_photos.map(url => ({ url, name: "Project Photo.jpg", type: "photo" }))];
          if (data.documents) extractedFiles = [...extractedFiles, ...data.documents.map(d => ({ url: d.file_url, name: d.file_name, type: "document" }))];
        }
      } else if (form.context_type === "lead") {
        const { data } = await supabase.from("leads").select("photos, documents").eq("id", form.context_id).eq('company_id', companyId).single();
        if (data) {
          if (data.photos) extractedFiles = [...extractedFiles, ...data.photos.map(url => ({ url, name: "Lead Photo.jpg", type: "photo" }))];
          if (data.documents) extractedFiles = [...extractedFiles, ...data.documents.map(d => ({ url: d.file_url, name: d.file_name, type: "document" }))];
        }
      } else if (form.context_type === "client") {
        const { data } = await supabase.from("attachments").select("file_url, file_name").eq("related_type", "Client").eq("related_id", form.context_id).eq('company_id', companyId);
        if (data) {
          data.forEach(d => {
             const isPhoto = d.file_name?.match(/\.(jpg|jpeg|png|gif|webp)$/i);
             extractedFiles.push({ url: d.file_url, name: d.file_name || "Client File", type: isPhoto ? "photo" : "document" });
          });
        }
      }
      setContextFiles(extractedFiles);
      setSelectedContextFiles(extractedFiles.map(f => f.url));
    };
    fetchContextFiles();
  }, [form.context_type, form.context_id, companyId]);

  const toggleContextFile = (url) => {
    setSelectedContextFiles(prev => prev.includes(url) ? prev.filter(u => u !== url) : [...prev, url]);
  };

  const handleCustomUpload = async (e) => {
    const files = Array.from(e.target.files);
    toast.loading("Uploading files...");
    const uploaded = [];
    try {
      for (const file of files) {
        const cleanName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '');
        const fileName = `${companyId}/requests/${Date.now()}_${cleanName}`;
        const { error } = await supabase.storage.from("vendor").upload(fileName, file);
        if (error) throw error;
        
        const { data: { publicUrl } } = supabase.storage.from("vendor").getPublicUrl(fileName);
        uploaded.push({ url: publicUrl, name: file.name });
      }
      setCustomFiles(prev => [...prev, ...uploaded]);
      toast.dismiss(); toast.success("Files uploaded!");
    } catch (err) {
      toast.dismiss(); toast.error("Failed to upload: " + err.message);
    }
  };

  const sendRequestMutation = useMutation({
    mutationFn: async () => {
      if (sendLock.current) return;
      sendLock.current = true;
      try {
      const dbAttachmentUrls = [...selectedContextFiles, ...customFiles.map(f => f.url)];
      
      const dbPayload = {
        company_id: companyId, vendor_id: form.vendor_id, created_by: profile.id,
        title: form.title, scope_of_work: form.scope_of_work, due_date: form.due_date || null, priority: form.priority,
        attachments: dbAttachmentUrls,
        project_id: form.context_type === "project" ? form.context_id : null,
        lead_id: form.context_type === "lead" ? form.context_id : null,
        client_id: form.context_type === "client" ? form.context_id : null,
        status: 'Draft',
      };
      
      if (!delivery.current) {
        const { data: request, error: dbError } = await supabase.from("vendor_requests").insert([dbPayload]).select('id,response_token').single();
        if (dbError) throw dbError;
        delivery.current = { request, requestId: crypto.randomUUID(), sent: false, copyPending: false, statusSaved: false, payload: null };
      }

      let contextName = null;
      let address = null;

      if (form.context_type === "project") {
        const p = projects.find(x => String(x.id) === String(form.context_id));
        const clientLabel = getClientName(p?.clients);
        contextName = p ? `${p.name}${clientLabel ? ` (${clientLabel})` : ''}` : null;
        address = p?.site_address;
      } else if (form.context_type === "lead") {
        const l = leads.find(x => String(x.id) === String(form.context_id));
        contextName = getLeadName(l);
        address = l?.site_address;
      } else if (form.context_type === "client") {
        const c = clients.find(x => String(x.id) === String(form.context_id));
        contextName = getClientName(c);
        address = c?.site_address || c?.billing_address;
      }

      const compName = company?.name || "Our Company";
      const brandColor = company?.brand_color || company?.settings?.brand_color || null;

      const resendAttachments = [
        ...selectedContextFiles.map(url => {
          const f = contextFiles.find(x => x.url === url);
          return { path: url, filename: f ? f.name : "attachment" };
        }),
        ...customFiles.map(f => ({ path: f.url, filename: f.name }))
      ];

      let roleString = profile?.role?.replace('_', ' ')?.toUpperCase() || null;
      if (roleString === "ADMIN" || roleString === "OFFICE ADMIN") {
        roleString = null;
      }

      const escape = value => String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      const responseUrl = `${window.location.origin}/ContractorPortal?request=${delivery.current.request.id}&token=${delivery.current.request.response_token}`;
      if (!delivery.current.payload) delivery.current.payload = {
          to: form.email_to, cc: form.email_cc, bcc: form.email_bcc,
          subject: `Quote Request from ${compName}: ${form.title}`,
          scope_of_work: `${escape(form.scope_of_work)}\n\n<a href="${escape(responseUrl)}">Accept this invitation, decline or submit your quote</a>`,
          attachments: resendAttachments,
          priority: form.priority,
          due_date: form.due_date,
          project_name: contextName,
          address: address,
          company_name: compName,
          company_logo: company?.company_logo_url || null,
          brand_color: brandColor,
          signature_name: profile?.full_name || profile?.email,
          signature_role: roleString,
          signature_phone: profile?.phone || company?.phone || null,
          sender_email: profile?.email,
          company_email: company?.settings?.email,
          request_id: delivery.current.requestId,
          vendor_request_id: delivery.current.request.id,
          send_copy_to_company: sendCopy,
        };
      if (!delivery.current.sent || (delivery.current.copyPending && delivery.current.statusSaved)) {
        const { data: result, error: fnError } = await supabase.functions.invoke("send-vendor-request", { body: { ...delivery.current.payload, copy_only: delivery.current.copyPending } });
        if (fnError || result?.error || result?.success !== true) throw fnError || new Error(result?.error || 'Request email was not accepted');
        delivery.current.sent = true;
        delivery.current.copyPending = delivery.current.payload.send_copy_to_company && result.copy_status !== 'sent';
      }
      if (!delivery.current.statusSaved) {
        const { error: recordedError } = await supabase.from('vendor_requests').update({ status: 'Sent', delivered_at: new Date().toISOString() }).eq('id', delivery.current.request.id).eq('company_id', companyId);
        if (recordedError) throw new Error('Email sent; recording delivery failed. Retry to finish recording without sending it twice.');
        delivery.current.statusSaved = true;
      }
      if (delivery.current.copyPending) throw new Error('Request sent, but the company copy could not be confirmed. Retry to send the copy without emailing the vendor again.');
      qc.invalidateQueries({ queryKey: ['project-trade-requests', companyId] });
      } finally { sendLock.current = false; }
    },
    onSuccess: () => {
      toast.success("Quote Request sent successfully!");
      onOpenChange(false);
    },
    onError: (err) => toast.error(`Failed to send request: ${err.message}`)
  });

  const photos = contextFiles.filter(f => f.type === "photo");
  const docs = contextFiles.filter(f => f.type === "document");
  const copyEmail = company?.settings?.email?.trim() || "";
  const copyAvailable = isValidCompanyEmail(copyEmail);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl w-[95vw] max-h-[90vh] overflow-y-auto bg-slate-50">
        <DialogHeader><DialogTitle className="text-xl font-black flex items-center gap-2"><Send className="h-5 w-5 text-amber-500" /> Request Quote / Work Order</DialogTitle></DialogHeader>
        
        <div className="space-y-4 pt-2">
          {!initialVendor && (
            <div>
              <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Select Vendor *</Label>
              <Select value={String(form.vendor_id)} onValueChange={handleVendorChange}>
                <SelectTrigger className="mt-1 bg-white font-bold"><SelectValue placeholder="Select subcontractor..." /></SelectTrigger>
                <SelectContent>
                  {vendors.map(v => <SelectItem key={String(v.id)} value={String(v.id)}>{v.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">To Email(s) *</Label>
              <Input value={form.email_to} onChange={e => setForm({...form, email_to: e.target.value})} className="mt-1 bg-white text-sm" placeholder="email1@test.com, email2@test.com" />
            </div>
            <div>
              <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">CC</Label>
              <Input value={form.email_cc} onChange={e => setForm({...form, email_cc: e.target.value})} className="mt-1 bg-white text-sm" placeholder="comma-separated" />
            </div>
            <div>
              <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">BCC</Label>
              <Input value={form.email_bcc} onChange={e => setForm({...form, email_bcc: e.target.value})} className="mt-1 bg-white text-sm" placeholder="comma-separated" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Request Title *</Label>
              <Textarea value={form.title} onChange={e => setForm({...form, title: e.target.value})} rows={1} className="mt-1 bg-white font-bold resize-y text-base min-h-[40px]" placeholder="e.g., Plumbing Rough-in Bid" />
            </div>
            <div>
              <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Priority</Label>
              <Select value={form.priority} onValueChange={v => setForm({...form, priority: v})}>
                <SelectTrigger className="mt-1 bg-white font-medium"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="Low">Low</SelectItem><SelectItem value="Medium">Medium</SelectItem><SelectItem value="High">High</SelectItem></SelectContent>
              </Select>
            </div>
          </div>

          <div><Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Requested Due Date</Label><Input type="date" value={form.due_date} onChange={e => setForm({...form, due_date: e.target.value})} className="mt-1 bg-white w-full sm:w-1/3" /></div>

          {/* LINK TO PROJECT/LEAD/CLIENT */}
          <div className="p-4 bg-white border border-slate-200 rounded-xl">
            <Label className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 block">Link Context & Files</Label>
            <div className="grid grid-cols-2 gap-3 mb-1">
              <Select value={form.context_type} onValueChange={v => setForm({...form, context_type: v, context_id: "none"})}>
                <SelectTrigger className="bg-slate-50 font-medium"><SelectValue placeholder="Source" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Standalone Request</SelectItem>
                  <SelectItem value="project">Project</SelectItem>
                  <SelectItem value="lead">Lead</SelectItem>
                  <SelectItem value="client">Client</SelectItem>
                </SelectContent>
              </Select>
              
              {form.context_type !== "none" && (
                <Select value={String(form.context_id)} onValueChange={v => setForm({...form, context_id: v})}>
                  <SelectTrigger className="bg-slate-50 font-medium"><SelectValue placeholder={`Select ${form.context_type}...`} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Select...</SelectItem>
                    
                    {/* ⚡ UPDATED: Renders Project Name and Client Name */}
                    {form.context_type === "project" && projects.map(p => {
                       const clientName = getClientName(p.clients);
                       return (
                         <SelectItem key={String(p.id)} value={String(p.id)}>
                           {p.name} {clientName ? `— ${clientName}` : ''}
                         </SelectItem>
                       );
                    })}
                    
                    {form.context_type === "lead" && leads.map(l => <SelectItem key={String(l.id)} value={String(l.id)}>{getLeadName(l)}</SelectItem>)}
                    {form.context_type === "client" && clients.map(c => <SelectItem key={String(c.id)} value={String(c.id)}>{getClientName(c)}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>

            {contextFiles.length > 0 && (
              <div className="mt-3 space-y-4 p-3 bg-slate-50 border border-slate-100 rounded-lg">
                {photos.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase mb-2">Include Photos as Attachments:</p>
                    <div className="flex flex-wrap gap-2">
                      {photos.map((f, i) => (
                        <label key={`photo-${i}`} className={`relative flex flex-col items-center gap-1 p-1 rounded-lg border-2 cursor-pointer transition-all ${selectedContextFiles.includes(f.url) ? 'border-amber-500 bg-amber-50 shadow-sm' : 'border-slate-200 bg-white hover:border-amber-200'}`}>
                          <input type="checkbox" checked={selectedContextFiles.includes(f.url)} onChange={() => toggleContextFile(f.url)} className="absolute top-1.5 right-1.5 z-10 h-3.5 w-3.5 accent-amber-500" />
                          <img src={f.url} alt="thumbnail" className="h-16 w-16 object-cover rounded shadow-sm bg-slate-100" />
                          <span className="text-[9px] font-medium text-slate-600 truncate w-16 text-center" title={f.name}>{f.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                {docs.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase mb-2">Include Documents as Attachments:</p>
                    <div className="flex flex-col gap-2">
                      {docs.map((f, i) => (
                        <label key={`doc-${i}`} className={`flex items-center gap-2.5 p-2 rounded-lg border cursor-pointer transition-colors ${selectedContextFiles.includes(f.url) ? 'bg-amber-50 border-amber-300 text-amber-900 shadow-sm' : 'bg-white border-slate-200 hover:border-amber-200 text-slate-700'}`}>
                          <input type="checkbox" checked={selectedContextFiles.includes(f.url)} onChange={() => toggleContextFile(f.url)} className="rounded h-4 w-4 text-amber-500 accent-amber-500" />
                          <FileText className={`h-4 w-4 ${selectedContextFiles.includes(f.url) ? 'text-amber-600' : 'opacity-50'}`} />
                          <span className="text-xs font-medium truncate flex-1" title={f.name}>{f.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Scope of Work Description *</Label>
            <Textarea value={form.scope_of_work} onChange={e => setForm({...form, scope_of_work: e.target.value})} rows={5} className="mt-1 bg-white min-h-[120px]" placeholder="Detail exactly what you need quoted or completed..." />
          </div>

          <div>
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleCustomUpload} />
            <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="font-bold border-slate-300 bg-white">
              <Upload className="h-4 w-4 mr-2" /> Attach Additional Files
            </Button>
            {customFiles.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {customFiles.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-full border border-slate-200 text-xs font-medium text-slate-700 shadow-sm">
                    <FileText className="h-3 w-3 text-slate-500" /> <span className="truncate max-w-[150px]">{f.name}</span>
                    <button type="button" onClick={() => setCustomFiles(prev => prev.filter((_, idx) => idx !== i))} className="text-slate-400 hover:text-red-500 ml-1"><X className="h-3 w-3" /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 pt-4 border-t border-slate-200 mt-6 sm:flex-row sm:items-end sm:justify-between">
            <div className="text-left">
              <label htmlFor="vendor-request-copy" className="flex min-h-10 items-center gap-2 text-sm font-medium text-slate-700">
                <input id="vendor-request-copy" type="checkbox" checked={sendCopy} disabled={sendRequestMutation.isPending || !copyAvailable || !!delivery.current} onChange={event => setSendCopy(event.target.checked)} className="h-4 w-4 accent-amber-500" />Send me a copy
              </label>
              <p className="text-xs text-slate-500">{copyAvailable ? `Copy to: ${copyEmail}` : "Add a valid company email in Settings to enable copies."}</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="font-bold order-2 sm:order-1">Cancel</Button>
            <Button 
              className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-black shadow-md order-1 sm:order-2" 
              onClick={() => { if (!sendLock.current) sendRequestMutation.mutate(); }}
              disabled={sendRequestMutation.isPending || !form.title || !form.scope_of_work || form.vendor_id === "none" || !form.email_to}
            >
              {sendRequestMutation.isPending ? "Sending..." : delivery.current?.copyPending ? "Retry copy" : "Send Request"}
            </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
