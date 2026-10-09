import React, { useState, useEffect } from "react"; // Add useEffect
import { useAuth } from "@/lib/AuthContext"; // Import your auth context
import { supabase } from "@/api/supabaseClient"; 
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import AuthBrandLogo from "@/components/shared/AuthBrandLogo";
import InstallAppDialog, { useInstallApp } from "@/components/shared/InstallAppDialog";
import { Mail, Lock, Loader2, Download } from "lucide-react";
import { useToast } from "@/components/ui/use-toast"; 


export default function Login() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const { user } = useAuth(); // Get the active user
  const [googleLoading, setGoogleLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [installHelpOpen, setInstallHelpOpen] = useState(false);
  const { status: installStatus, platform, install } = useInstallApp();

  // Add this hook right here:
  useEffect(() => {
    // 1. If Context already knows the user is logged in, redirect immediately.
    if (user) {
      navigate("/dashboard"); 
      return;
    }

    // 2. Fallback: Listen directly to Supabase for the OAuth redirect hash
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        navigate("/dashboard");
      }
    });

    return () => subscription.unsubscribe();
  }, [user, navigate]); 
  
  const { toast } = useToast(); 

  const handleEmailLogin = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;
      
      localStorage.removeItem('pending_stripe_checkout');
      localStorage.removeItem('pending_stripe_promotion_code');
      localStorage.removeItem('google_signup_attempt');
      
      toast({ title: "Welcome back!" });
      navigate("/dashboard"); 
      
    } catch (error) {
      console.error("Login error:", error);
      
      if (error.message.includes("Invalid login credentials")) {
        toast({ 
          variant: "destructive", 
          title: "Incorrect email or password",
          description: "(Did you originally sign up with Google? If you don't have an account, click sign up to join Fuzed Flow)"
        });
      } else {
        toast({ 
          variant: "destructive", 
          title: "Failed to log in",
          description: error.message
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setGoogleLoading(true);
    try {
      localStorage.removeItem('pending_stripe_checkout');
      localStorage.removeItem('pending_stripe_promotion_code');
      localStorage.removeItem('google_signup_attempt');

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          // 👇 FIX 1: Point exactly back to the Unprotected /login route
          redirectTo: `${window.location.origin}/login`, 
        },
      });

      if (error) throw error;
      
    } catch (error) {
      console.error(error);
      toast.error(error.message || "Failed to connect via Google.");
      setGoogleLoading(false);
    }
  };

  const handleInstall = async () => {
    const result = await install();
    if (result.outcome === 'unavailable') setInstallHelpOpen(true);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center">
          <AuthBrandLogo />
          <h2 className="text-3xl font-extrabold text-slate-900">Welcome back</h2>
          <p className="mt-2 text-sm text-slate-600">Sign in to your account</p>
        </div>

        <Card className="p-6 sm:p-8">
          <Button type="button" variant="outline" className="w-full flex items-center justify-center gap-2 font-bold border-slate-200 bg-white hover:bg-slate-50 text-slate-700 h-11" disabled={loading || googleLoading} onClick={handleGoogleLogin}>
            {googleLoading ? <Loader2 className="h-5 w-5 animate-spin text-slate-500" /> : (
              <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24">
                <path fill="#EA4335" d="M5.266 9.765A7.077 7.077 0 0 1 12 4.909c1.69 0 3.218.6 4.418 1.582L19.91 3C17.782 1.145 15.055 0 12 0 7.27 0 3.198 2.698 1.24 6.65l4.026 3.115Z" />
                <path fill="#4285F4" d="M16.04 15.345c-1.012.673-2.316 1.073-4.04 1.073a7.07 7.07 0 0 1-6.734-4.855L1.24 14.677C3.198 18.63 7.27 21.327 12 21.327c2.995 0 5.727-1.005 7.686-2.736l-3.646-3.246Z" />
                <path fill="#FBBC05" d="M5.266 14.235A7.016 7.016 0 0 1 4.91 12c0-.79.13-1.55.356-2.235L1.24 6.65A11.934 11.934 0 0 0 0 12c0 1.92.454 3.734 1.24 5.35l4.026-3.115Z" />
                <path fill="#34A853" d="M23.491 12.275c0-.818-.073-1.604-.209-2.363H12v4.51h6.464a5.533 5.533 0 0 1-2.423 3.636l3.646 3.246c2.132-1.973 3.804-4.873 3.804-8.03Z" />
              </svg>
            )}
            {googleLoading ? "Connecting..." : "Sign in with Google"}
          </Button>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200"></div></div>
            <div className="relative flex justify-center text-xs font-bold uppercase tracking-wider"><span className="bg-white px-3 text-slate-400">Or continue with email</span></div>
          </div>

          <form onSubmit={handleEmailLogin} className="space-y-4">
            <div>
              <Label htmlFor="email" className="font-bold text-slate-700">Email address</Label>
              <div className="mt-1 relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input id="email" type="email" required className="pl-10" value={email} disabled={googleLoading || loading} onChange={(e) => setEmail(e.target.value)} />
              </div>
            </div>

            <div>
              <Label htmlFor="password" className="font-bold text-slate-700">Password</Label>
              <div className="mt-1 relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input id="password" type="password" required className="pl-10" value={password} disabled={googleLoading || loading} onChange={(e) => setPassword(e.target.value)} />
              </div>
            </div>

            <Button type="submit" className="w-full bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold mt-2 h-11 shadow-sm" disabled={loading || googleLoading}>
              {loading ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : null}
              {loading ? "Signing in..." : "Sign in"}
            </Button>
          </form>
        </Card>

        <p className="text-center text-sm text-slate-600">
          Don't have an account? <Link to="/signup" className="font-bold text-amber-600 hover:text-amber-500">Sign up</Link>
        </p>
        {installStatus !== 'installed' ? (
          <button type="button" onClick={handleInstall} className="mx-auto flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold text-slate-600 transition-colors hover:bg-white hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2">
            <Download className="h-4 w-4 text-amber-600" aria-hidden="true" />
            Install FuzedFlow on this device
          </button>
        ) : null}
      </div>
      <InstallAppDialog open={installHelpOpen} onOpenChange={setInstallHelpOpen} platform={platform} />
    </div>
  );
}
