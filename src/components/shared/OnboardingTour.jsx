import React, { useState, useEffect } from "react";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { X, ArrowRight, CheckCircle2, ShieldCheck, Map, Calculator, Hammer, Zap, Home } from "lucide-react";
import { toast } from "sonner";

const ONBOARDING_STEPS = [
  {
    id: "welcome",
    title: "Welcome to Fuzed FLow!",
    description: "Your ultimate command center for managing trades and construction. Let's take a quick look around.",
    icon: <Home className="h-12 w-12 text-amber-500" />,
  },
  {
    id: "navigation",
    title: "Lightning Fast Navigation",
    description: "Use the left sidebar to jump between modules. Pro Tip: Press Cmd+K (Mac) or Ctrl+K (PC) to search for anything instantly.",
    icon: <Map className="h-12 w-12 text-blue-500" />,
  },
  {
    id: "quotes",
    title: "Professional Estimating",
    description: "Build incredibly detailed estimates using phases and line items. Send them directly to clients for digital sign-off.",
    icon: <Calculator className="h-12 w-12 text-emerald-500" />,
  },
  {
    id: "projects",
    title: "Project Execution",
    description: "Track progress, manage crew allocations, monitor safety logs, and oversee the site diary from the Project Workspace.",
    icon: <Hammer className="h-12 w-12 text-orange-500" />,
  },
  {
    id: "automation",
    title: "Automate The Boring Stuff",
    description: "Use our intelligent Automation Builder to automatically send emails, schedule follow-ups, and chase overdue invoices.",
    icon: <Zap className="h-12 w-12 text-violet-500" />,
  },
  {
    id: "customize",
    title: "Your Data, Your Way",
    description: "Click 'Customize' on the dashboard to hide or show widgets so you only see what matters to you.",
    icon: <ShieldCheck className="h-12 w-12 text-slate-700" />,
  },
];

export default function OnboardingTour() {
  const { profile } = useAuth();
  const [step, setStep] = useState(0);
  const [showTour, setShowTour] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [localDismissed, setLocalDismissed] = useState(false); // New state to prevent tab-switching bugs

  // Check if we should show the tour when the component loads
  useEffect(() => {
    // 1. If we already dismissed it this session, ignore.
    if (localDismissed) return;
    
    // 2. If browser memory says we did it, ignore.
    if (localStorage.getItem("fuzedflow_onboarding_done") === "true") return;

    // 3. If the database explicitly says we are done, ignore.
    if (profile?.onboarding_completed === true) return;

    // 4. If profile is loaded, check subscription status before showing!
    if (profile?.company_id) {
      const timer = setTimeout(async () => {
        try {
          // Fetch the company's current subscription status
          const { data, error } = await supabase
            .from("companies")
            .select("subscription_status")
            .eq("id", profile.company_id)
            .single();

          if (error) throw error;

          // Mirror the Dashboard's active status check
          const isSubscriptionActive = 
            data?.subscription_status === 'Active' || 
            data?.subscription_status === 'trialing' || 
            data?.subscription_status === 'active';

          // Only show the tour if they have passed the paywall
          if (isSubscriptionActive) {
            setShowTour(true);
          }
        } catch (err) {
          console.error("Failed to verify subscription for onboarding:", err);
        }
      }, 1000);
      
      return () => clearTimeout(timer);
    }
  }, [profile, localDismissed]);

  const handleNext = () => {
    if (step < ONBOARDING_STEPS.length - 1) {
      setStep(step + 1);
    } else {
      handleComplete();
    }
  };

  const handleComplete = async () => {
    if (!profile?.id) return;
    setIsSaving(true);
    
    try {
      // IMMEDIATELY hide the tour and save to browser memory so it doesn't pop up again
      // even if the database takes a second to update.
      setLocalDismissed(true);
      localStorage.setItem("fuzedflow_onboarding_done", "true");
      setShowTour(false);

      // Permanently mark onboarding as completed in Supabase
      const { error } = await supabase
        .from('profiles')
        .update({ onboarding_completed: true })
        .eq('id', profile.id);

      if (error) throw error;
      
      toast.success("You're all set! Let's get to work.");
      
    } catch (error) {
      console.error("Error saving onboarding status:", error);
      toast.error("Something went wrong saving your progress, but we've hidden the tour for now.");
    } finally {
      setIsSaving(false);
    }
  };

  const currentStep = ONBOARDING_STEPS[step];

  return (
    <Dialog open={showTour} onOpenChange={(open) => {
      // If they click outside the box or press Escape, treat it as a skip
      if (!open && showTour) handleComplete(); 
    }}>
      <DialogContent className="max-w-md border-slate-200 shadow-2xl p-0 overflow-hidden" aria-describedby={undefined}>
        <div className="bg-slate-50 border-b border-slate-100 p-4 flex justify-between items-center">
          <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Quick Tour</span>
          <button
            onClick={handleComplete}
            disabled={isSaving}
            className="text-slate-400 hover:text-slate-700 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-8 text-center bg-white flex flex-col items-center">
          <div className="mb-6 p-4 bg-slate-50 rounded-full border border-slate-100 shadow-sm inline-flex">
            {currentStep.icon}
          </div>
          
          <h2 className="text-2xl font-black text-slate-900 mb-3">{currentStep.title}</h2>
          <p className="text-sm font-medium text-slate-500 mb-8 leading-relaxed max-w-sm">
            {currentStep.description}
          </p>

          {/* Progress Dots */}
          <div className="flex gap-2 justify-center mb-8">
            {ONBOARDING_STEPS.map((_, idx) => (
              <div
                key={idx}
                className={`h-2 rounded-full transition-all duration-300 ${
                  idx === step ? "bg-amber-400 w-6 shadow-sm" : idx < step ? "bg-slate-300 w-2" : "bg-slate-100 w-2"
                }`}
              />
            ))}
          </div>

          <div className="flex gap-3 w-full max-w-xs mx-auto">
            <Button 
              variant="outline" 
              onClick={handleComplete} 
              disabled={isSaving}
              className="flex-1 font-bold border-slate-200 text-slate-500 hover:bg-slate-50"
            >
              Skip Tour
            </Button>
            
            <Button 
              onClick={handleNext} 
              disabled={isSaving}
              className="flex-1 gap-2 bg-slate-900 hover:bg-slate-800 text-white font-black shadow-md"
            >
              {step === ONBOARDING_STEPS.length - 1 ? (
                <>{isSaving ? "Saving..." : "Finish" } <CheckCircle2 className="h-4 w-4" /></>
              ) : (
                <>Next <ArrowRight className="h-4 w-4" /></>
              )}
            </Button>
          </div>

          <p className="text-[10px] font-black uppercase tracking-wider text-slate-300 mt-6">
            Step {step + 1} of {ONBOARDING_STEPS.length}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}