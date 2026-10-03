import React, { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Eye, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

const CLIENT_FEATURES = [
  { id: "quote_approval", label: "Allow quote approval/rejection", default: true },
  { id: "project_tracking", label: "Track project progress in real-time", default: true },
  { id: "document_sharing", label: "Secure document sharing & downloads", default: true },
  { id: "direct_messaging", label: "Direct messaging with team", default: true },
  { id: "payment_tracking", label: "View payment status & history", default: true },
  { id: "change_orders", label: "View & approve change orders", default: false },
  { id: "time_tracking", label: "View work time logs", default: false },
  { id: "feedback_system", label: "Photo feedback & punch list", default: true },
];

export default function ClientPortalEnhancer({ clientId, onSave }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [localFeatures, setLocalFeatures] = useState({});

  // 1. FETCH CURRENT SETTINGS FROM SUPABASE
  const { data: client, isLoading } = useQuery({
    queryKey: ["client_portal_settings", clientId],
    enabled: !!clientId && open, // Only fetch when the dialog is opened
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("portal_features")
        .eq("id", clientId)
        .single();
      if (error) throw error;
      return data;
    }
  });

  // 2. SYNC DB DATA WITH LOCAL STATE
  useEffect(() => {
    let parsed = {};
    if (client?.portal_features) {
      // Handle both stringified JSON and raw JSONB
      parsed = typeof client.portal_features === 'string' 
        ? JSON.parse(client.portal_features) 
        : client.portal_features;
    }

    const newMap = {};
    CLIENT_FEATURES.forEach(f => {
      newMap[f.id] = parsed[f.id] !== undefined ? parsed[f.id] : f.default;
    });
    setLocalFeatures(newMap);
  }, [client, open]);

  const handleToggle = (id) => {
    setLocalFeatures((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // 3. MUTATION TO SAVE SETTINGS
  const saveMutation = useMutation({
    mutationFn: async (featureMap) => {
      const { error } = await supabase
        .from("clients")
        .update({ portal_features: featureMap })
        .eq("id", clientId);
        
      if (error) throw error;
      return featureMap;
    },
    onSuccess: (featureMap) => {
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["client_portal_settings", clientId] });
      toast.success("Client portal settings updated!");
      if (onSave) onSave(featureMap);
      setOpen(false);
    },
    onError: (err) => {
      toast.error(`Failed to save settings: ${err.message}`);
    }
  });

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="font-bold text-slate-700 border-slate-300 hover:border-blue-400 hover:bg-blue-50 transition-colors shadow-sm"
        onClick={() => setOpen(true)}
      >
        <Eye className="h-4 w-4 mr-1.5 text-blue-600" />
        Portal Settings
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md bg-slate-50 border-slate-200 shadow-xl" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="font-black text-xl text-slate-900 flex items-center gap-2">
              <Eye className="h-5 w-5 text-blue-500" /> Client Portal Access
            </DialogTitle>
          </DialogHeader>
          
          <div className="pt-2 pb-4">
            <p className="text-sm font-medium text-slate-500 mb-4">
              Toggle what this specific client is allowed to see and do when they log into their portal.
            </p>
            
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 text-slate-400 animate-spin" />
              </div>
            ) : (
              <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-2">
                {CLIENT_FEATURES.map((feature) => (
                  <label
                    key={feature.id}
                    className="flex items-center gap-3 p-3 bg-white border border-slate-200 rounded-lg cursor-pointer hover:border-amber-400 transition-colors shadow-sm"
                  >
                    <Checkbox
                      checked={localFeatures[feature.id] || false}
                      onCheckedChange={() => handleToggle(feature.id)}
                      className="data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
                    />
                    <span className="text-sm font-bold text-slate-800 select-none">
                      {feature.label}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-2 justify-end pt-4 border-t border-slate-200 mt-2">
            <Button variant="outline" onClick={() => setOpen(false)} className="font-bold border-slate-300">
              Cancel
            </Button>
            <Button 
              onClick={() => saveMutation.mutate(localFeatures)} 
              disabled={saveMutation.isPending || isLoading}
              className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-black shadow-md min-w-[140px]"
            >
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              {saveMutation.isPending ? "Saving..." : "Save Settings"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}