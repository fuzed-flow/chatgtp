import React, { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Plus, UserPlus, Building2, MapPin, Mail, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

const EMPTY_FORM = {
  name: "",
  type: "Residential",
  primary_contact_name: "",
  email: "",
  phone: "",
  site_address: "",
};

export default function CreateClientDialog({ onClientCreated, children }) {
  const { profile } = useAuth();
  const companyId = profile?.company_id;
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData] = useState(EMPTY_FORM);

  // Reset form when dialog opens
  useEffect(() => {
    if (dialogOpen) {
      setFormData(EMPTY_FORM);
    }
  }, [dialogOpen]);

  const createMutation = useMutation({
    mutationFn: async (data) => {
      if (!companyId) throw new Error("Missing Company ID");

      const { data: newClient, error } = await supabase
        .from("clients")
        .insert([{ ...data, company_id: companyId }])
        .select()
        .single();

      if (error) throw error;
      return newClient;
    },
    onSuccess: (newClient) => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      toast.success("Client profile created successfully!");
      setDialogOpen(false);
      onClientCreated?.(newClient.id);
    },
    onError: (err) => {
      console.error("Create client error:", err);
      toast.error(`Failed to create client: ${err.message}`);
    },
  });

  const handleSave = (e) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast.error("Client Company/Name is required");
      return;
    }
    createMutation.mutate(formData);
  };

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      
      <DialogContent className="max-w-lg bg-slate-50">
        <DialogHeader>
          <DialogTitle className="text-xl font-black text-slate-900 flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-amber-500" /> Create New Client
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-4 pt-2">
          
          <div className="p-5 bg-white rounded-xl border border-slate-200 shadow-sm space-y-4">
            
            {/* NAME & TYPE ROW */}
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2">
                <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5 mb-1.5">
                  <Building2 className="h-3.5 w-3.5" /> Client / Company Name *
                </Label>
                <Input 
                  value={formData.name} 
                  onChange={e => setFormData({ ...formData, name: e.target.value })} 
                  placeholder="e.g. ABC Construction Inc." 
                  className="font-semibold text-slate-900"
                  autoFocus
                />
              </div>
              <div className="col-span-1">
                <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">
                  Client Type
                </Label>
                <Select value={formData.type} onValueChange={v => setFormData({ ...formData, type: v })}>
                  <SelectTrigger className="font-medium">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Residential">Residential</SelectItem>
                    <SelectItem value="Commercial">Commercial</SelectItem>
                    <SelectItem value="Industrial">Industrial</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* CONTACT NAME */}
            <div>
              <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5 mb-1.5">
                <UserPlus className="h-3.5 w-3.5" /> Primary Contact Name
              </Label>
              <Input 
                value={formData.primary_contact_name} 
                onChange={e => setFormData({ ...formData, primary_contact_name: e.target.value })} 
                placeholder="e.g. John Smith" 
              />
            </div>

            {/* CONTACT INFO ROW */}
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5 mb-1.5">
                  <Mail className="h-3.5 w-3.5" /> Email Address
                </Label>
                <Input 
                  type="email" 
                  value={formData.email} 
                  onChange={e => setFormData({ ...formData, email: e.target.value })} 
                  placeholder="contact@example.com" 
                />
              </div>
              <div>
                <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5 mb-1.5">
                  <Phone className="h-3.5 w-3.5" /> Phone Number
                </Label>
                <Input 
                  value={formData.phone} 
                  onChange={e => setFormData({ ...formData, phone: e.target.value })} 
                  placeholder="(555) 123-4567" 
                />
              </div>
            </div>

            {/* ADDRESS */}
            <div>
              <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5 mb-1.5">
                <MapPin className="h-3.5 w-3.5" /> Default Site Address
              </Label>
              <Input 
                value={formData.site_address} 
                onChange={e => setFormData({ ...formData, site_address: e.target.value })} 
                placeholder="123 Main St, City, State" 
              />
            </div>

          </div>

          {/* ACTIONS */}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={createMutation.isPending}
              className="bg-slate-900 text-white hover:bg-slate-800 font-bold px-6"
            >
              {createMutation.isPending ? "Creating..." : <><Plus className="h-4 w-4 mr-2" /> Create Client</>}
            </Button>
          </div>

        </form>
      </DialogContent>
    </Dialog>
  );
}