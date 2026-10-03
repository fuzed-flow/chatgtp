import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient"; 
import { useAuth } from "@/lib/AuthContext";
import { useNavigate } from "react-router-dom";
import { Plus, LayoutTemplate, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import CreateClientDialog from "../quotes/CreateClientDialog";

export default function CreateQuoteFromTemplateDialog({ clientId, leadId, children }) {
  const { profile } = useAuth();
  const companyId = profile?.company_id;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedClientId, setSelectedClientId] = useState(clientId || "");
  const navigate = useNavigate();

  // 1. Fetch Quote Templates from Supabase
  const { data: quoteTemplates = [] } = useQuery({
    queryKey: ["quote-templates-list", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotes")
        .select("id, title")
        .eq("company_id", companyId)
        .eq("is_template", true)
        .order("title", { ascending: true });
      
      if (error) throw error;
      return data || [];
    },
  });

  // 2. Fetch Clients from Supabase
  const { data: clients = [] } = useQuery({
    queryKey: ["clients", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name")
        .eq("company_id", companyId)
        .order("name", { ascending: true });
      
      if (error) throw error;
      return data || [];
    },
  });

  const handleCreateQuote = () => {
    if (!selectedTemplateId) {
      toast.error("Please select a quote template");
      return;
    }

    let url = `/QuoteBuilder?templateId=${selectedTemplateId}`;
    if (selectedClientId) url += `&client_id=${selectedClientId}`;
    if (leadId) url += `&lead_id=${leadId}`;
    
    // 👇 NEW: Pass the user ID to the Quote Builder
    if (profile?.id) url += `&user_id=${profile.id}`; 
    
    navigate(url);
    setDialogOpen(false);
  };

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create Quote from Template</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="template">Select Template</Label>
            <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
              <SelectTrigger id="template">
                <SelectValue placeholder="Select a template" />
              </SelectTrigger>
              <SelectContent>
                {quoteTemplates.length === 0 ? (
                  <SelectItem disabled value="no-templates">No templates available</SelectItem>
                ) : (
                  quoteTemplates.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.title || 'Untitled Template'}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          {!clientId && !leadId && (
            <div className="grid gap-2">
              <Label htmlFor="client">Select Client (Optional)</Label>
              <div className="flex gap-2">
                <Select value={selectedClientId} onValueChange={setSelectedClientId}>
                  <SelectTrigger id="client">
                    <SelectValue placeholder="Select a client" />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((client) => (
                      <SelectItem key={client.id} value={client.id}>
                        {client.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <CreateClientDialog onClientCreated={setSelectedClientId}>
                  <Button type="button" variant="outline" size="icon" title="Create New Client">
                    <UserPlus className="h-4 w-4" />
                  </Button>
                </CreateClientDialog>
              </div>
            </div>
          )}
        </div>
        <div className="flex justify-end">
          <Button onClick={handleCreateQuote} disabled={!selectedTemplateId} className="bg-slate-900 hover:bg-slate-800 text-white">
            <Plus className="h-4 w-4 mr-2" /> Create Quote
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}