import React, { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import AddressAutocomplete from "../shared/AddressAutocomplete";
import { supabase } from "@/api/supabaseClient"; 
import { useAuth } from "@/lib/AuthContext";
import { Camera, Plus, X } from "lucide-react";
import { toast } from "sonner";

export default function LeadFormDialog({ open, onOpenChange, onSave, users = [], lead }) {
  const { profile } = useAuth();
  const companyId = profile?.company_id;
  const fileInputRef = useRef(null);

  const initialFormState = {
    first_name: "", surname: "", contact_email: "", contact_phone: "",
    source: "", pipeline_stage: "New", value_estimate: "", priority: "Medium",
    next_follow_up_date: "", assigned_to: "", site_address: "", description: "", notes: "",
    photos: []
  };

  const [form, setForm] = useState(initialFormState);
  const [photoFiles, setPhotoFiles] = useState([]); // Holds actual File objects before upload
  const [saving, setSaving] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState(null);

  // Reset form when opened
  useEffect(() => {
    if (open) {
      if (lead) {
        const nameParts = (lead.contact_name || "").split(" ");
        setForm({
          first_name: nameParts[0] || "",
          surname: nameParts.slice(1).join(" ") || "",
          contact_email: lead.contact_email || "",
          contact_phone: lead.contact_phone || "",
          source: lead.source || "",
          pipeline_stage: lead.pipeline_stage || "New",
          value_estimate: lead.value_estimate || "",
          priority: lead.priority || "Medium",
          next_follow_up_date: lead.next_follow_up_date || "",
          assigned_to: lead.assigned_to || "",
          site_address: lead.site_address || "",
          description: lead.description || "",
          notes: lead.notes || "",
          photos: lead.photos || []
        });
      } else {
        setForm(initialFormState);
      }
      setPhotoFiles([]);
      setDuplicateWarning(null);
    }
  }, [open, lead]);

  const handlePhotoSelect = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      setPhotoFiles(prev => [...prev, ...Array.from(e.target.files)]);
    }
  };

  const removeSelectedPhoto = (index) => {
    setPhotoFiles(prev => prev.filter((_, i) => i !== index));
  };

  const uploadPhotos = async () => {
    if (photoFiles.length === 0) return [];
    const uploadedUrls = [];
    
    for (const file of photoFiles) {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `${companyId}/${fileName}`;
      
      const { data, error } = await supabase.storage.from("leads").upload(filePath, file);
      
      if (error) {
        toast.error(`Failed to upload ${file.name}`);
        console.error(error);
      } else if (data) {
        const { data: publicUrlData } = supabase.storage.from("leads").getPublicUrl(filePath);
        uploadedUrls.push(publicUrlData.publicUrl);
      }
    }
    return uploadedUrls;
  };

  const executeSave = async () => {
    setSaving(true);
    try {
      // Upload photos first
      const newPhotoUrls = await uploadPhotos();
      
      const fullName = `${form.first_name} ${form.surname}`.trim();
      const { first_name, surname, ...rest } = form;
      
      const payload = { 
        ...rest, 
        contact_name: fullName,
        photos: [...(form.photos || []), ...newPhotoUrls]
      };
      
      if (payload.value_estimate) {
        payload.value_estimate = parseFloat(payload.value_estimate);
      } else {
        payload.value_estimate = null;
      }

      if (!payload.next_follow_up_date) {
        payload.next_follow_up_date = null;
      }

      await onSave(payload);
      onOpenChange(false);
    } catch (error) {
      console.error("Save Error:", error);
      toast.error("Failed to save lead");
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.contact_email && form.contact_email.trim() !== "" && companyId) {
      setSaving(true);
      try {
        const checkEmail = form.contact_email.trim();
        const { data: existingClients } = await supabase.from("clients").select("name").eq("company_id", companyId).ilike("email", checkEmail);
        const { data: existingLeads } = await supabase.from("leads").select("contact_name").eq("company_id", companyId).ilike("contact_email", checkEmail);

        if ((existingClients && existingClients.length > 0) || (existingLeads && existingLeads.length > 0)) {
          const foundName = existingClients?.length > 0 ? `${existingClients[0].name} (Client)` : `${existingLeads[0].contact_name} (Lead)`;
          setDuplicateWarning({ email: checkEmail, foundName });
          setSaving(false);
          return;
        }
      } catch (err) {
        console.error("Duplicate check failed:", err);
      }
      setSaving(false);
    }
    executeSave();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent aria-describedby={undefined} className="max-w-2xl max-h-[90vh] overflow-y-auto w-[95vw]">
          <DialogHeader><DialogTitle>{lead ? "Edit Lead" : "Add New Lead"}</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>First Name *</Label>
                <Input value={form.first_name} onChange={e => setForm({...form, first_name: e.target.value})} required />
              </div>
              <div>
                <Label>Surname *</Label>
                <Input value={form.surname} onChange={e => setForm({...form, surname: e.target.value})} required />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Email</Label>
                <Input type="email" value={form.contact_email} onChange={e => setForm({...form, contact_email: e.target.value})} />
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={form.contact_phone} onChange={e => setForm({...form, contact_phone: e.target.value})} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Source</Label>
                <Select value={form.source} onValueChange={v => setForm({...form, source: v})}>
                  <SelectTrigger className="bg-white"><SelectValue placeholder="Select Source" /></SelectTrigger>
                  <SelectContent>
                    {["Facebook", "Instagram", "Google", "Referral", "Website", "Kijiji", "Other"].map(s => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Priority</Label>
                <Select value={form.priority} onValueChange={v => setForm({...form, priority: v})}>
                  <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["Low", "Medium", "High", "Urgent"].map(p => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Pipeline Stage</Label>
              <Select value={form.pipeline_stage} onValueChange={v => setForm({...form, pipeline_stage: v})}>
                <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["New", "Contacted", "Booked Visit", "Quoted", "Negotiation", "Won", "Lost"].map(s => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Value Estimate</Label>
                <Input type="number" step="0.01" value={form.value_estimate} onChange={e => setForm({...form, value_estimate: e.target.value})} placeholder="0.00" />
              </div>
              <div>
                <Label>Next Follow Up Date</Label>
                <Input type="date" value={form.next_follow_up_date} onChange={e => setForm({...form, next_follow_up_date: e.target.value})} />
              </div>
            </div>

            <div>
              <Label>Assign Team Member</Label>
              <Select value={form.assigned_to} onValueChange={v => setForm({...form, assigned_to: v})}>
                <SelectTrigger className="bg-white"><SelectValue placeholder="Select team member" /></SelectTrigger>
                <SelectContent>
                  {users.map(user => (
                    <SelectItem key={user.id} value={user.full_name || user.name || "Unknown User"}>
                      {user.full_name || user.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Site / Project Address</Label>
              <AddressAutocomplete
                value={form.site_address}
                onChange={v => setForm({...form, site_address: v})}
                placeholder="Start typing an address..."
              />
            </div>

            <div>
              <Label>Description</Label>
              <Textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} rows={2} className="bg-white" />
            </div>

            {/* NEW: Site Assessment Photos Section */}
            <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
              <Label className="flex items-center gap-2 mb-2 font-semibold">
                <Camera className="h-4 w-4 text-slate-500" /> New Lead Photos
              </Label>
              <input 
                type="file" 
                multiple 
                accept="image/*" 
                ref={fileInputRef} 
                className="hidden" 
                onChange={handlePhotoSelect} 
              />
              
              <div className="flex flex-wrap gap-3 mt-3">
                {/* Existing uploaded photos */}
                {form.photos?.map((photoUrl, idx) => (
                  <div key={`existing-${idx}`} className="relative h-16 w-16 group rounded overflow-hidden border border-slate-200">
                    <img src={photoUrl} alt="Site" className="h-full w-full object-cover" />
                  </div>
                ))}
                
                {/* Newly selected files waiting to be uploaded */}
                {photoFiles.map((file, idx) => (
                  <div key={`new-${idx}`} className="relative h-16 w-16 group rounded overflow-hidden border-2 border-emerald-400">
                    <img src={URL.createObjectURL(file)} alt="Preview" className="h-full w-full object-cover opacity-80" />
                    <button type="button" onClick={() => removeSelectedPhoto(idx)} className="absolute top-0.5 right-0.5 bg-red-500 text-white rounded-full p-0.5 hover:bg-red-600">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                
                <button 
                  type="button" 
                  onClick={() => fileInputRef.current?.click()} 
                  className="h-16 w-16 border-2 border-dashed border-slate-300 rounded flex flex-col items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                >
                  <Camera className="h-5 w-5 mb-1" />
                  <span className="text-[10px] font-bold">Add</span>
                </button>
              </div>
            </div>

            <div>
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} rows={2} className="bg-white" />
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t mt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={!form.first_name || !form.surname || saving} className={`text-white min-w-[120px] ${lead ? "bg-slate-900 hover:bg-slate-800" : "bg-amber-500 hover:bg-amber-600"}`}>
                {!lead && <Plus aria-hidden="true" className="h-4 w-4 mr-2 text-white" />}
                {saving ? "Saving..." : (lead ? "Update Lead" : "Create Lead")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* DUPLICATE WARNING POPUP */}
      <Dialog open={!!duplicateWarning} onOpenChange={(v) => !v && setDuplicateWarning(null)}>
        <DialogContent className="max-w-md border-amber-200 bg-amber-50" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="text-amber-800 flex items-center gap-2">
              ⚠️ Duplicate Email Found
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-slate-700">
              A profile with the email <span className="font-bold">{duplicateWarning?.email}</span> already exists for:
            </p>
            <p className="font-black text-slate-900 bg-white p-3 rounded border border-amber-200 text-center">
              {duplicateWarning?.foundName}
            </p>
            <p className="text-sm text-slate-700">
              Are you sure you want to create a duplicate profile? It is usually better to update the existing profile instead.
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDuplicateWarning(null)} className="bg-white">
              Cancel
            </Button>
            <Button 
              onClick={() => {
                setDuplicateWarning(null);
                executeSave(); // They clicked "Create Anyway", so bypass the check
              }} 
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              Create Duplicate Anyway
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
