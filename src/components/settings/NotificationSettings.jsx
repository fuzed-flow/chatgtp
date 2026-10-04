import React, { useState, useEffect } from "react";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { checkAccess } from '@/lib/planConfig'; // 👈 IMPORTED CHECKACCESS
import { useQueryClient } from "@tanstack/react-query";
import { Save, Bell, Mail, Smartphone, Loader2, Lock } from "lucide-react"; // 👈 ADDED LOCK ICON
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

export default function NotificationSettings() {
  const { company, settings } = useAuth(); 
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);
  const [localSettings, setLocalSettings] = useState({});

  // 👇 CHECK IF PLAN SUPPORTS CHANGE ORDERS 👇
  const canAccessChangeOrders = checkAccess(company?.plan_id, 'hasChangeOrders');

  // 1. Initialize local state when settings load from AuthContext
  useEffect(() => {
    if (settings?.notifications) {
      // Normalize any old boolean settings into objects
      const normalizedSettings = {};
      for (const [key, value] of Object.entries(settings.notifications)) {
        if (typeof value === "boolean") {
          normalizedSettings[key] = { email: value, mobile: value };
        } else {
          normalizedSettings[key] = value || { email: false, mobile: false };
        }
      }
      setLocalSettings(normalizedSettings);
    }
  }, [settings]);

  // 2. Handle toggling a switch
  const handleChange = (eventKey, method, isChecked) => {
    setLocalSettings((prev) => ({
      ...prev,
      [eventKey]: {
        ...(prev[eventKey] || { email: false, mobile: false }),
        [method]: isChecked,
      },
    }));
  };

  // 3. Save the full JSON back to Supabase
  const handleSave = async () => {
    if (!company?.id) {
      toast.error("Company data not loaded yet.");
      return;
    }

    setIsSaving(true);
    try {
      // Spread the existing settings so we don't overwrite PDF/Branding data
      const updatedSettings = {
        ...(settings || {}),
        notifications: localSettings,
      };

      const { error } = await supabase
        .from("companies")
        .update({ settings: updatedSettings })
        .eq("id", company.id);

      if (error) throw error;

      toast.success("Notification preferences saved successfully!");
      queryClient.invalidateQueries(["company", company.id]);
    } catch (error) {
      console.error("Save error:", error);
      toast.error("Failed to save settings. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  // 4. Reusable UI Row Component with Toggle Switches
  const NotificationRow = ({ title, description, eventKey, showEmail = true, showSms = true }) => {
    const currentVal = localSettings[eventKey] || { email: false, mobile: false };

    return (
      <div className="flex flex-col sm:flex-row sm:items-center justify-between p-5 bg-slate-50 hover:bg-slate-100 transition-colors rounded-xl border border-slate-200">
        <div className="mb-4 sm:mb-0">
          <p className="font-bold text-slate-900">{title}</p>
          <p className="text-sm text-slate-500 font-medium mt-0.5">{description}</p>
        </div>
        <div className="flex items-center gap-8">
          {showEmail && (
            <div className="flex items-center gap-3">
              <span className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
                <Mail className="w-4 h-4 text-slate-400" /> Email
              </span>
              <Switch
                checked={currentVal.email || false}
                onCheckedChange={(v) => handleChange(eventKey, "email", v)}
              />
            </div>
          )}
          
          {showSms && (
            <div className="flex items-center gap-3">
              <span className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
                <Smartphone className="w-4 h-4 text-slate-400" /> SMS
              </span>
              <Switch
                checked={currentVal.mobile || false}
                onCheckedChange={(v) => handleChange(eventKey, "mobile", v)}
              />
            </div>
          )}
        </div>
      </div>
    );
  };

  if (!company) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <Card className="p-6 max-w-4xl mx-auto shadow-sm border-slate-200">
      
      {/* HEADER & TOP SAVE BUTTON */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4 border-b border-slate-100 pb-6">
        <div>
          <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
            <Bell className="w-6 h-6 text-amber-500" />
            Alert Preferences
          </h2>
          <p className="text-slate-500 font-medium mt-1">
            Choose how you want to be notified when clients interact with your documents.
          </p>
        </div>
        <Button 
          onClick={handleSave} 
          disabled={isSaving}
          className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-black h-11 px-8 shadow-md"
        >
          {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
          {isSaving ? "Saving..." : "Save Preferences"}
        </Button>
      </div>

      <div className="space-y-8">
        
        {/* QUOTES SECTION */}
        <section>
          <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider mb-3 ml-1">Quotes</h3>
          <div className="space-y-3">
            <NotificationRow 
              title="Quote Viewed" 
              description="When a client opens a quote link" 
              eventKey="quote_viewed" 
            />
            <NotificationRow 
              title="Quote Approved" 
              description="When a client signs and accepts a quote" 
              eventKey="quote_approved" 
            />
            <NotificationRow 
              title="Changes Requested" 
              description="When a client requests an adjustment to a quote" 
              eventKey="quote_change_requested"
            />
          </div>
        </section>

        {/* INVOICES SECTION */}
        <section>
          <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider mb-3 ml-1">Invoices</h3>
          <div className="space-y-3">
            <NotificationRow 
              title="Invoice Viewed" 
              description="When a client opens an invoice link" 
              eventKey="invoice_viewed" 
            />
            <NotificationRow 
              title="Invoice Paid" 
              description="When an online payment is completed successfully" 
              eventKey="invoice_paid" 
            />
          </div>
        </section>

        {/* 👇 CHANGE ORDERS SECTION (GATED) 👇 */}
        <section>
          <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider mb-3 ml-1">Change Orders</h3>
          {!canAccessChangeOrders ? (
            <div className="flex flex-col sm:flex-row items-center justify-between p-4 bg-slate-50 rounded-xl border border-dashed border-slate-300 gap-4">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 bg-amber-100 rounded-lg flex items-center justify-center shrink-0">
                  <Lock className="h-4 w-4 text-amber-600" />
                </div>
                <p className="text-sm font-medium text-slate-600">Change Order alert preferences require the Professional plan.</p>
              </div>
              <Button 
                type="button" 
                onClick={() => window.location.href = '/Settings?tab=team'} 
                size="sm" 
                className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold shrink-0"
              >
                Upgrade to Professional
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <NotificationRow 
                title="Change Order Viewed" 
                description="When a client opens a change order link" 
                eventKey="co_viewed" 
              />
              <NotificationRow 
                title="Change Order Approved" 
                description="When a client signs and accepts a change order" 
                eventKey="co_approved" 
              />
            </div>
          )}
        </section>
        {/* 👆 -------------------------------- 👆 */}

        {/* PURCHASE ORDERS SECTION */}
        <section>
          <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider mb-3 ml-1">Purchase Orders</h3>
          <div className="space-y-3">
            <NotificationRow 
              title="Purchase Order Viewed" 
              description="When a vendor opens a purchase order link" 
              eventKey="po_viewed" 
              showSms={false} 
            />
          </div>
        </section>

      </div>
    </Card>
  );
}