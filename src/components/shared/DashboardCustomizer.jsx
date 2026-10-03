import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Settings, Save } from "lucide-react";
import { toast } from "sonner";

const DEFAULT_LAYOUT = {
  stats: true,
  recentActivity: true,
  tasks: true,
  pipeline: true,
  shortcuts: true
};

export default function DashboardCustomizer({ currentLayout = DEFAULT_LAYOUT, onSave }) {
  const [open, setOpen] = useState(false);
  const [layout, setLayout] = useState(currentLayout);

  // Sync the local state with the actual layout whenever the dialog opens
  useEffect(() => {
    if (open) setLayout(currentLayout);
  }, [open, currentLayout]);

  const toggleSetting = (key) => {
    setLayout(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = () => {
    if (onSave) onSave(layout);
    toast.success("Dashboard layout instantly updated!");
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-slate-500 hover:text-slate-900 font-bold">
          <Settings className="h-4 w-4 mr-2" /> Customize
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md bg-white border-slate-200" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="font-black text-slate-900 text-xl">Customize Dashboard</DialogTitle>
        </DialogHeader>
        
        <div className="py-4 space-y-4">
          <p className="text-sm font-medium text-slate-500 mb-4">Select which widgets you want to see on your home screen.</p>
          
          <div className="grid gap-3">
            <Label className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer hover:border-amber-400 transition-colors">
              <Checkbox checked={layout.stats} onCheckedChange={() => toggleSetting('stats')} />
              <div className="flex flex-col">
                <span className="font-bold text-slate-900">Key Metrics (Top Row)</span>
                <span className="text-[10px] text-slate-500 uppercase tracking-wider">Revenue, Active Jobs, Open Tasks</span>
              </div>
            </Label>

            <Label className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer hover:border-amber-400 transition-colors">
              <Checkbox checked={layout.shortcuts} onCheckedChange={() => toggleSetting('shortcuts')} />
              <div className="flex flex-col">
                <span className="font-bold text-slate-900">Quick Actions</span>
                <span className="text-[10px] text-slate-500 uppercase tracking-wider">Buttons for New Quote, Client, etc.</span>
              </div>
            </Label>
            
            <Label className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer hover:border-amber-400 transition-colors">
              <Checkbox checked={layout.pipeline} onCheckedChange={() => toggleSetting('pipeline')} />
              <div className="flex flex-col">
                <span className="font-bold text-slate-900">Sales Pipeline</span>
                <span className="text-[10px] text-slate-500 uppercase tracking-wider">Recent Leads & Quotes to follow up on</span>
              </div>
            </Label>
            
            <Label className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer hover:border-amber-400 transition-colors">
              <Checkbox checked={layout.tasks} onCheckedChange={() => toggleSetting('tasks')} />
              <div className="flex flex-col">
                <span className="font-bold text-slate-900">My Tasks & Actions</span>
                <span className="text-[10px] text-slate-500 uppercase tracking-wider">To-do list and items needing attention</span>
              </div>
            </Label>

            <Label className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer hover:border-amber-400 transition-colors">
              <Checkbox checked={layout.recentActivity} onCheckedChange={() => toggleSetting('recentActivity')} />
              <div className="flex flex-col">
                <span className="font-bold text-slate-900">Company Activity Feed</span>
                <span className="text-[10px] text-slate-500 uppercase tracking-wider">Recent notes, updates, and interactions</span>
              </div>
            </Label>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
          <Button variant="outline" onClick={() => setOpen(false)} className="font-bold">Cancel</Button>
          <Button 
            className="bg-slate-900 hover:bg-slate-800 text-white font-bold shadow-md" 
            onClick={handleSave}
          >
            <Save className="h-4 w-4 mr-2" /> Save Layout
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}