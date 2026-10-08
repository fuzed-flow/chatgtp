import { getPlanIdFromPrice, getUsdPriceId, SUBSCRIPTION_PRICES } from "@/lib/subscriptionPlans";
import React, { useState, useEffect } from "react"; 
import { supabase } from "@/api/supabaseClient"; 
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext"; 
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import AuthBrandLogo from "@/components/shared/AuthBrandLogo";
import { Building2, User, Mail, Lock, Loader2, Eye, EyeOff } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";


export default function SignUp() {
  const { user } = useAuth(); 
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  
  const invitedEmail = searchParams.get("email"); 
  const isInvitedUser = !!invitedEmail;
  
  const priceId = getUsdPriceId(searchParams.get("plan")) || SUBSCRIPTION_PRICES.starter.monthly;

  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  const [formData, setFormData] = useState({
    companyName: "",
    fullName: "",
    email: invitedEmail || "",
    password: "",
    confirmPassword: "", 
  });

 useEffect(() => {
    const handleSuccessfulLogin = () => {
      // FIX: Only save to local storage if there is an ACTUAL plan in the URL.
      // This protects the Business ID we already saved before leaving for Google!
      const currentUrlPlan = searchParams.get("plan");
      
      if (currentUrlPlan && !isInvitedUser) {
        localStorage.setItem('pending_stripe_checkout', getUsdPriceId(currentUrlPlan) || priceId);
      }
      
      navigate("/dashboard"); 
    };

    if (user) {
      handleSuccessfulLogin();
      return;
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        handleSuccessfulLogin();
      }
    });

    return () => subscription.unsubscribe();
  }, [user, navigate, searchParams, isInvitedUser, priceId]);

  const handleSignUp = async (e) => {
    e.preventDefault();
    setAuthError(""); 

    if (formData.password !== formData.confirmPassword) {
      setAuthError("Passwords do not match. Please try again.");
      return;
    }

    setLoading(true);

    if (priceId && !isInvitedUser) {
      localStorage.setItem('pending_stripe_checkout', priceId);
    }

    try {
      const userMetaData = { 
        full_name: formData.fullName,
        plan_id: getPlanIdFromPrice(priceId) 
      };
      
      if (!isInvitedUser) {
        userMetaData.company_name = formData.companyName;
      }

      const { data, error } = await supabase.auth.signUp({
        email: formData.email.trim().toLowerCase(),
        password: formData.password,
        options: { data: userMetaData },
      });

      if (data?.user && data.user.identities && data.user.identities.length === 0) {
        setAuthError(isInvitedUser 
          ? "You already belong to a FuzedFlow company! One email can only belong to one company."
          : "An account with this email already exists. Please click 'Sign in' below.");
        return;
      }

      if (error) {
        if (error.code === "user_already_exists" || error.message.toLowerCase().includes("already")) {
          setAuthError(isInvitedUser 
            ? "You already belong to a FuzedFlow company! One email can only belong to one company."
            : "An account with this email already exists. Please click 'Sign in' below.");
          return;
        }
        setAuthError(`Sign up error: ${error.message}`);
        return;
      }
      
      if (isInvitedUser) {
        localStorage.setItem('checking_invite_status', 'true');
      }

      if (data?.session) {
        navigate("/dashboard"); 
      } else {
        toast({ 
          title: "Account Created!", 
          description: "Please check your email to confirm your account before logging in." 
        });
        navigate("/login");
      }
      
    } catch (error) {
      console.error(error);
      setAuthError(error.message || "Failed to sign up.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignUp = async () => {
    setGoogleLoading(true);
    localStorage.setItem('google_signup_attempt', 'true');
    
    if (priceId && !isInvitedUser) {
      localStorage.setItem('pending_stripe_checkout', priceId);
    }

    if (isInvitedUser) {
      localStorage.setItem('checking_invite_status', 'true');
    }

    // 1. Prepare the metadata payload to prevent database trigger crashes
    const metaData = {
      plan_id: getPlanIdFromPrice(priceId)
    };

    // 2. Pass the company name if they aren't an invited employee
    if (!isInvitedUser) {
      // Use what they typed, or fallback to a default to satisfy the DB constraint
      metaData.company_name = formData.companyName.trim() || "My Company";
    }
    
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/signup`, 
          data: metaData, // 3. Inject the metadata into the Google flow
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });

      if (error) throw error;
      
    } catch (error) {
      console.error(error);
      toast({
        variant: "destructive",
        title: "Google Connect Failed",
        description: error.message || "Failed to connect via Google."
      });
      setGoogleLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-slate-50 px-4 py-8 sm:py-10">
      <div className="mx-auto max-w-md w-full space-y-6">
        <div className="text-center">
          <AuthBrandLogo />
          <h2 className="text-3xl font-extrabold text-slate-900">
            {isInvitedUser ? "Join your team" : "Create your account"}
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            {isInvitedUser 
              ? "Complete your profile to join your company on FuzedFlow." 
              : "Start your 14-day free trial today. Cancel anytime."}
          </p>
        </div>

        <Card className="p-6 sm:p-8">
          <Button type="button" variant="outline" className="w-full flex items-center justify-center gap-2 font-bold border-slate-200 bg-white hover:bg-slate-50 text-slate-700 h-11" disabled={loading || googleLoading} onClick={handleGoogleSignUp}>
            {googleLoading ? <Loader2 className="h-5 w-5 animate-spin text-slate-500" /> : (
              <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24">
                <path fill="#EA4335" d="M5.266 9.765A7.077 7.077 0 0 1 12 4.909c1.69 0 3.218.6 4.418 1.582L19.91 3C17.782 1.145 15.055 0 12 0 7.27 0 3.198 2.698 1.24 6.65l4.026 3.115Z" />
                <path fill="#4285F4" d="M16.04 15.345c-1.012.673-2.316 1.073-4.04 1.073a7.07 7.07 0 0 1-6.734-4.855L1.24 14.677C3.198 18.63 7.27 21.327 12 21.327c2.995 0 5.727-1.005 7.686-2.736l-3.646-3.246Z" />
                <path fill="#FBBC05" d="M5.266 14.235A7.016 7.016 0 0 1 4.91 12c0-.79.13-1.55.356-2.235L1.24 6.65A11.934 11.934 0 0 0 0 12c0 1.92.454 3.734 1.24 5.35l4.026-3.115Z" />
                <path fill="#34A853" d="M23.491 12.275c0-.818-.073-1.604-.209-2.363H12v4.51h6.464a5.533 5.533 0 0 1-2.423 3.636l3.646 3.246c2.132-1.973 3.804-4.873 3.804-8.03Z" />
              </svg>
            )}
            {googleLoading ? "Connecting..." : "Sign up with Google"}
          </Button>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200"></div></div>
            <div className="relative flex justify-center text-xs font-bold uppercase tracking-wider"><span className="bg-white px-3 text-slate-400">Or continue with</span></div>
          </div>

          <form onSubmit={handleSignUp} className="space-y-4">
            {!isInvitedUser && (
              <div>
                <Label htmlFor="companyName" className="font-bold text-slate-700">Company Name</Label>
                <div className="mt-1 relative">
                  <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input id="companyName" type="text" required={!isInvitedUser} className="pl-10" placeholder="Acme Renovations Ltd." value={formData.companyName} disabled={googleLoading || loading} onChange={(e) => setFormData({ ...formData, companyName: e.target.value })} />
                </div>
              </div>
            )}

            <div>
              <Label htmlFor="fullName" className="font-bold text-slate-700">Your Full Name</Label>
              <div className="mt-1 relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input id="fullName" type="text" required className="pl-10" placeholder="John Doe" value={formData.fullName} disabled={googleLoading || loading} onChange={(e) => setFormData({ ...formData, fullName: e.target.value })} />
              </div>
            </div>

            <div>
              <Label htmlFor="email" className="font-bold text-slate-700">Email address</Label>
              <div className="mt-1 relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input id="email" type="email" required className="pl-10" placeholder="john@example.com" value={formData.email} disabled={googleLoading || loading || isInvitedUser} onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
              </div>
            </div>

            <div>
              <Label htmlFor="password" className="font-bold text-slate-700">Password</Label>
              <div className="mt-1 relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input id="password" type={showPassword ? "text" : "password"} required minLength={6} className="pl-10 pr-10" placeholder="••••••••" value={formData.password} disabled={googleLoading || loading} onChange={(e) => setFormData({ ...formData, password: e.target.value })} />
                <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none" onClick={() => setShowPassword(!showPassword)}>
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div>
              <Label htmlFor="confirmPassword" className="font-bold text-slate-700">Confirm Password</Label>
              <div className="mt-1 relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input id="confirmPassword" type={showConfirmPassword ? "text" : "password"} required minLength={6} className={`pl-10 pr-10 ${formData.confirmPassword && formData.password !== formData.confirmPassword ? 'border-red-500 focus-visible:ring-red-500' : ''}`} placeholder="••••••••" value={formData.confirmPassword} disabled={googleLoading || loading} onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })} />
                <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none" onClick={() => setShowConfirmPassword(!showConfirmPassword)}>
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {formData.confirmPassword && formData.password !== formData.confirmPassword && (
                <p className="text-xs text-red-500 mt-1.5 font-medium">Passwords do not match</p>
              )}
            </div>

            {authError && (
              <div className="p-3 rounded-md bg-red-50 border border-red-200">
                <p className="text-sm text-red-600 font-medium">{authError}</p>
              </div>
            )}

            <Button type="submit" className="w-full bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold mt-2 h-11 shadow-sm" disabled={loading || googleLoading}>
              {loading ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : null}
              {loading ? "Creating account..." : (isInvitedUser ? "Join Team" : "Sign up")}
            </Button>
          </form>
        </Card>

        <p className="text-center text-sm text-slate-600">
          Already have an account? <Link to="/login" className="font-bold text-amber-600 hover:text-amber-500">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
