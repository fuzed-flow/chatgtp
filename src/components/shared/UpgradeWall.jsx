import React, { useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { Lock, ArrowRight, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export default function UpgradeWall({ featureName, requiredPlan = "Professional" }) {
  const [isPortalLoading, setIsPortalLoading] = useState(false);

  const handleManageUsers = async () => {
    setIsPortalLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-portal-session', {
        body: { return_url: window.location.href }
      });

      if (error) throw error;
      if (data?.url) window.location.href = data.url;
    } catch (err) {
      console.error(err);
      toast.error("Failed to open billing portal. Please contact support.");
      setIsPortalLoading(false);
    }
  };

  return (
    <div className="p-4 md:p-8 flex items-center justify-center min-h-[60vh]">
      <Card className="max-w-lg w-full p-8 text-center shadow-xl border-2 border-slate-200 bg-white">
        <div className="mx-auto w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-6 border border-slate-200">
          <Lock className="h-8 w-8 text-slate-400" />
        </div>
        
        <h2 className="text-2xl font-black text-slate-900 mb-2">
          Unlock {featureName}
        </h2>
        
        <p className="text-slate-500 mb-8 font-medium">
          {featureName} is only available on the <strong>{requiredPlan}</strong> plan. Upgrade your FuzedFlow workspace today to save hours on admin work and unlock premium features.
        </p>
        
        <Button 
          onClick={handleManageUsers} 
          disabled={isPortalLoading}
          className="w-full h-12 text-lg font-bold bg-amber-500 hover:bg-amber-600 text-slate-900 shadow-md"
        >
          {isPortalLoading ? (
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          ) : (
            <ArrowRight className="mr-2 h-5 w-5" />
          )}
          Upgrade to {requiredPlan}
        </Button>
      </Card>
    </div>
  );
}