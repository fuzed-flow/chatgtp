import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { clearNotificationPushOnSignOut } from '@/lib/notificationPush';
import { AuthStateContext, useAuthState } from '@/lib/AuthStateContext';
import { normalizeProfileRole } from '@/lib/roleAccess';

const PROFILE_ACCESS_REFRESH_MS = 60_000;

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const inactiveSignOutUser = useRef(null);
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
      try {
        const { data: { session } } = await supabase.auth.getSession();
        setUser(session?.user || null);
      } catch (error) {
        console.error('Failed to restore the authentication session:', error);
        setUser(null);
      } finally {
        setAuthLoading(false);
      }
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
  const {
    data: profile,
    isError: isProfileError,
    isLoading: isProfileLoading,
    refetch: refetchProfile,
  } = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user?.id,
    refetchInterval: (query) => {
      if (query.state.status !== 'success') return false;
      return query.state.data?.company_id ? PROFILE_ACCESS_REFRESH_MS : 1000;
    },
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();
        
      if (error) throw error;
      return normalizeProfileRole(data);
    }
  });

  // Disabling a team member must remove app access immediately, rather than
  // waiting for their existing Supabase session to expire.
  useEffect(() => {
    if (!user || profile?.is_active !== false || inactiveSignOutUser.current === user.id) return;

    inactiveSignOutUser.current = user.id;
    setUser(null);
    queryClient.clear();

    void (async () => {
      try {
        await clearNotificationPushOnSignOut();
      } catch (error) {
        console.error('Failed to clear notification push for inactive account:', error);
      }

      try {
        const result = await supabase.auth.signOut();
        if (result?.error) console.error('Failed to sign out inactive account:', result.error);
      } catch (error) {
        console.error('Failed to sign out inactive account:', error);
      }
    })();
  }, [profile?.is_active, queryClient, user]);

  // 3. Fetch Company & Settings via React Query
  const {
    data: company,
    isError: isCompanyError,
    isLoading: isCompanyLoading,
    refetch: refetchCompany,
  } = useQuery({
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

  const isInactive = profile?.is_active === false;
  const accessError = !user || isInactive || authLoading
    ? null
    : isProfileError && !profile
      ? { code: 'profile_load_failed', message: "We couldn't load your account profile. Check your connection and try again." }
      : !isProfileLoading && !profile
        ? { code: 'profile_not_found', message: "We couldn't find an account profile for this sign-in. Ask your administrator to confirm your team access." }
        : profile && !profile.company_id
          ? { code: 'company_not_assigned', message: "Your account isn't assigned to a company. Ask your administrator to review your team access." }
          : isCompanyError && !company
            ? { code: 'company_load_failed', message: "We couldn't load your company workspace. Check your connection and try again." }
            : profile?.company_id && !isCompanyLoading && !company
              ? { code: 'company_not_found', message: "We couldn't find the company workspace assigned to your account. Ask your administrator to review your team access." }
              : null;
  const loading = authLoading || (!!user && !isInactive && (isProfileLoading || (!!profile?.company_id && isCompanyLoading)));

  const refreshAccess = async () => {
    if (!user?.id) return;

    const profileResult = await refetchProfile();
    if (profile?.company_id && profileResult.data?.company_id === profile.company_id) {
      await refetchCompany();
    }
  };

  const value = {
    user: isInactive ? null : user,
    profile,
    company,
    settings: company?.settings,
    loading,
    accessError,
    refreshAccess,
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
    <AuthStateContext.Provider value={value}>
      {children}
    </AuthStateContext.Provider>
  );
};

export const useAuth = useAuthState;
