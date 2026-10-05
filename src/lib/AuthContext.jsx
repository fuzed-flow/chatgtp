import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { clearNotificationPushOnSignOut } from '@/lib/notificationPush';

const AuthContext = createContext({});

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const plan = urlParams.get('plan');
    if (plan) {
      localStorage.setItem('pending_stripe_checkout', plan);
    }
  }, []);

  // 1. Core Auth Listener
  useEffect(() => {
    const initializeAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setUser(session?.user || null);
      setAuthLoading(false);
    };

    initializeAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
      setAuthLoading(false);
      
      if (!session?.user) {
        queryClient.clear();
      }
    });

    return () => {
      subscription?.unsubscribe();
    };
  }, [queryClient]);

  // 2. Fetch Profile via React Query
  const { data: profile, isLoading: isProfileLoading } = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user?.id,
    refetchInterval: (query) => (!query.state.data?.company_id ? 1000 : false),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();
        
      if (error) throw error;
      return data;
    }
  });

  // 3. Fetch Company & Settings via React Query
  const { data: company, isLoading: isCompanyLoading } = useQuery({
    queryKey: ["company", profile?.company_id],
    enabled: !!profile?.company_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("*")
        .eq("id", profile.company_id)
        .maybeSingle();
        
      if (error) throw error;
      return data;
    }
  });

  const loading = authLoading || (!!user && (isProfileLoading || !profile?.company_id || isCompanyLoading || !company));

  const value = {
    user,
    profile,
    company,
    settings: company?.settings,
    loading,
    signOut: async () => {
      await clearNotificationPushOnSignOut();
      // 1. Instantly destroy the React Query cache before state changes
      queryClient.clear();
      
      // 2. Perform the backend sign out
      await supabase.auth.signOut();

      // 3. Force a hard browser reload to dump all React memory
      window.location.href = '/login';
    },
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  return useContext(AuthContext);
};