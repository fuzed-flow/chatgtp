import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import AddressAutocomplete from "../shared/AddressAutocomplete";
import { toast } from "sonner";
import { supabase } from "@/api/supabaseClient"; // ⚡ NEW: Needed to check duplicates
import { useAuth } from "@/lib/AuthContext";      // ⚡ NEW: Needed for companyId

export default function ClientFormDialog({ open, onOpenChange, client, onSave }) {
  // ⚡ Get companyId to scope the duplicate search
  const { profile } = useAuth();
  const companyId = profile?.company_id;

  const [form, setForm] = useState({
    type: "Residential", name: "", first_name: "", surname: "", primary_contact_name: "",
    email: "", phone: "", billing_address: "", site_address: "", notes: "",
    site_line1: "", site_line2: "", site_city: "", site_province: "", site_postal: "",
    billing_line1: "", billing_line2: "", billing_city: "", billing_province: "", billing_postal: ""
  });
  const [billingSameAsSite, setBillingSameAsSite] = useState(false);
  const [saving, setSaving] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState(null);

  useEffect(() => {
    if (client) {
      const nameParts = client.name ? client.name.split(" ") : ["", ""];
      const firstName = nameParts[0] || "";
      const surname = nameParts.slice(1).join(" ") || "";
      
      setForm({
        type: client.type || "Residential",
        name: client.name || "",
        first_name: firstName,
        surname: surname,
        primary_contact_name: client.primary_contact_name || "",
        email: client.email || "",
        phone: client.phone || "",
        billing_address: client.billing_address || "",
        site_address: client.site_address || "",
        notes: client.notes || "",
        site_line1: client.site_address || "", 
        site_line2: "", site_city: "", site_province: "", site_postal: "",
        billing_line1: client.billing_address || "", 
        billing_line2: "", billing_city: "", billing_province: "", billing_postal: ""
      });
      setBillingSameAsSite(client.billing_address === client.site_address && !!client.site_address);
    } else {
      setForm({ 
        type: "Residential", name: "", first_name: "", surname: "", primary_contact_name: "", 
        email: "", phone: "", billing_address: "", site_address: "", notes: "",
        site_line1: "", site_line2: "", site_city: "", site_province: "", site_postal: "",
        billing_line1: "", billing_line2: "", billing_city: "", billing_province: "", billing_postal: ""
      });
      setBillingSameAsSite(false);
    }
  }, [client, open]);

  useEffect(() => {
    if (billingSameAsSite) {
      setForm(prev => ({ 
        ...prev, 
        billing_line1: prev.site_line1,
        billing_line2: prev.site_line2,
        billing_city: prev.site_city,
        billing_province: prev.site_province,
        billing_postal: prev.site_postal
      }));
    }
  }, [billingSameAsSite, form.site_line1, form.site_line2, form.site_city, form.site_province, form.site_postal]);

  // ⚡ The actual save execution logic (separated out)
  const executeSave = async () => {
    setSaving(true);
    try {
      const fullName = `${form.first_name} ${form.surname}`.trim();
      
      const siteParts = [form.site_line1, form.site_line2, form.site_city, form.site_province, form.site_postal].filter(Boolean);
      const finalSiteAddress = siteParts.join(", ");
      
      const billingParts = [form.billing_line1, form.billing_line2, form.billing_city, form.billing_province, form.billing_postal].filter(Boolean);
      const finalBillingAddress = billingParts.join(", ");
      
      const {
        site_line1, site_line2, site_city, site_province, site_postal,
        billing_line1, billing_line2, billing_city, billing_province, billing_postal,
        ...cleanData
      } = form;

      await onSave({ 
        ...cleanData, 
        name: fullName, 
        site_address: finalSiteAddress, 
        billing_address: finalBillingAddress 
      });
      
    } catch (error) {
      console.error("Save Error:", error);
      toast.error("Failed to save: " + (error.message || "Database error"));
    } finally {
      setSaving(false);
    }
  };

  // ⚡ The interceptor that checks for duplicates first
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Only check for duplicates if it's a NEW client, and they provided an email, and we have a companyId
    if (!client && form.email && form.email.trim() !== "" && companyId) {
      setSaving(true); // Temporarily show saving state while checking DB
      try {
        const checkEmail = form.email.trim();

        // Check Clients table
        const { data: existingClients } = await supabase
          .from("clients")
          .select("name")
          .eq("company_id", companyId)
          .ilike("email", checkEmail);

        // Check Leads table
        const { data: existingLeads } = await supabase
          .from("leads")
          .select("contact_name")
          .eq("company_id", companyId)
          .ilike("contact_email", checkEmail);

        if ((existingClients && existingClients.length > 0) || (existingLeads && existingLeads.length > 0)) {
          const foundName = existingClients?.length > 0 
            ? `${existingClients[0].name} (Client)` 
            : `${existingLeads[0].contact_name} (Lead)`;
            
          setDuplicateWarning({ email: checkEmail, foundName });
          setSaving(false);
          return; // STOP execution here, show the warning modal
        }
      } catch (err) {
        console.error("Duplicate check failed:", err);
      }
      setSaving(false);
    }

    // If no duplicate or it's an edit, proceed to save
    executeSave();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent aria-describedby={undefined} className="max-w-lg max-h-[90vh] overflow-y-auto w-[95vw]">
          <DialogHeader><DialogTitle>{client ? "Edit Client" : "New Client"}</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>First Name *</Label>
                <Input value={form.first_name} onChange={e => setForm({...form, first_name: e.target.value})} required />
              </div>
              <div>
                <Label>Surname *</Label>
                <Input value={form.surname} onChange={e => setForm({...form, surname: e.target.value})} required />
              </div>
              <div>
                <Label>Type</Label>
                <Select value={form.type} onValueChange={v => setForm({...form, type: v})}>
                  <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Residential">Residential</SelectItem>
                    <SelectItem value="Commercial">Commercial</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Primary Contact</Label>
                <Input value={form.primary_contact_name} onChange={e => setForm({...form, primary_contact_name: e.target.value})} />
              </div>
              <div>
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} />
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} />
              </div>
              
              <div className="col-span-1 sm:col-span-2">
                <Label className="text-sm font-semibold mb-3 block border-b pb-1">Site Address (Project Address)</Label>
                <div className="space-y-3">
                  <div>
                    <Label>Address Line 1</Label>
                    <AddressAutocomplete
                      value={form.site_line1}
                      onChange={(v) => setForm(prev => ({...prev, site_line1: v}))}
                      onSelectParsed={(parsed) => setForm(prev => ({
                        ...prev,
                        site_line1: parsed.line1,
                        site_city: parsed.city || prev.site_city,
                        site_province: parsed.province || prev.site_province,
                        site_postal: parsed.postal || prev.site_postal,
                      }))}
                      placeholder="Start typing an address..."
                    />
                  </div>
                  <div>
                    <Label>Address Line 2</Label>
                    <Input 
                      value={form.site_line2} 
                      onChange={(e) => setForm({...form, site_line2: e.target.value})} 
                      placeholder="Apt, suite, unit (optional)"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <Label>City</Label>
                      <Input 
                        value={form.site_city} 
                        onChange={(e) => setForm({...form, site_city: e.target.value})} 
                        placeholder="City"
                      />
                    </div>
                    <div>
                      <Label>Province</Label>
                      <Select value={form.site_province} onValueChange={v => setForm({...form, site_province: v})}>
                        <SelectTrigger className="bg-white"><SelectValue placeholder="Province" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="AB">Alberta</SelectItem>
                          <SelectItem value="BC">British Columbia</SelectItem>
                          <SelectItem value="MB">Manitoba</SelectItem>
                          <SelectItem value="NB">New Brunswick</SelectItem>
                          <SelectItem value="NL">Newfoundland and Labrador</SelectItem>
                          <SelectItem value="NS">Nova Scotia</SelectItem>
                          <SelectItem value="ON">Ontario</SelectItem>
                          <SelectItem value="PE">Prince Edward Island</SelectItem>
                          <SelectItem value="QC">Quebec</SelectItem>
                          <SelectItem value="SK">Saskatchewan</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Postal Code</Label>
                      <Input 
                        value={form.site_postal} 
                        onChange={(e) => setForm({...form, site_postal: e.target.value.toUpperCase()})} 
                        placeholder="A1A 1A1"
                        maxLength={7}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="col-span-1 sm:col-span-2 mt-4">
                <Label className="text-sm font-semibold mb-3 block border-b pb-1">Billing Address</Label>
                <div className="flex items-center gap-2 mb-3">
                  <input 
                    type="checkbox" 
                    id="billingSame" 
                    checked={billingSameAsSite}
                    onChange={(e) => setBillingSameAsSite(e.target.checked)}
                    className="rounded border-slate-300 text-amber-500 focus:ring-amber-500"
                  />
                  <Label htmlFor="billingSame" className="cursor-pointer font-normal text-slate-700">Same as Project Address</Label>
                </div>
                
                {!billingSameAsSite && (
                  <div className="space-y-3">
                    <div>
                      <Label>Address Line 1</Label>
                      <AddressAutocomplete
                        value={form.billing_line1}
                        onChange={(v) => setForm(prev => ({...prev, billing_line1: v}))}
                        onSelectParsed={(parsed) => setForm(prev => ({
                          ...prev,
                          billing_line1: parsed.line1,
                          billing_city: parsed.city || prev.billing_city,
                          billing_province: parsed.province || prev.billing_province,
                          billing_postal: parsed.postal || prev.billing_postal,
                        }))}
                        placeholder="Start typing an address..."
                      />
                    </div>
                    <div>
                      <Label>Address Line 2</Label>
                      <Input 
                        value={form.billing_line2} 
                        onChange={(e) => setForm({...form, billing_line2: e.target.value})} 
                        placeholder="Apt, suite, unit (optional)"
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <Label>City</Label>
                        <Input 
                          value={form.billing_city} 
                          onChange={(e) => setForm({...form, billing_city: e.target.value})} 
                          placeholder="City"
                        />
                      </div>
                      <div>
                        <Label>Province</Label>
                        <Select value={form.billing_province} onValueChange={v => setForm({...form, billing_province: v})}>
                          <SelectTrigger className="bg-white"><SelectValue placeholder="Province" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="AB">Alberta</SelectItem>
                            <SelectItem value="BC">British Columbia</SelectItem>
                            <SelectItem value="MB">Manitoba</SelectItem>
                            <SelectItem value="NB">New Brunswick</SelectItem>
                            <SelectItem value="NL">Newfoundland and Labrador</SelectItem>
                            <SelectItem value="NS">Nova Scotia</SelectItem>
                            <SelectItem value="ON">Ontario</SelectItem>
                            <SelectItem value="PE">Prince Edward Island</SelectItem>
                            <SelectItem value="QC">Quebec</SelectItem>
                            <SelectItem value="SK">Saskatchewan</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Postal Code</Label>
                        <Input 
                          value={form.billing_postal} 
                          onChange={(e) => setForm({...form, billing_postal: e.target.value.toUpperCase()})} 
                          placeholder="A1A 1A1"
                          maxLength={7}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
            
            <div>
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} rows={2} className="bg-white" />
            </div>
            
            <div className="flex justify-end gap-2 pt-4 border-t mt-6">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={saving} className="bg-slate-900 hover:bg-slate-800 text-white min-w-[120px]">
                {saving ? "Saving..." : client ? "Update" : "Create Client"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ⚡ DUPLICATE WARNING POPUP */}
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