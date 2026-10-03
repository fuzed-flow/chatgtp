import React, { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';

export default function RoleGuard({ allowedRoles, children, redirectTo = '/EmployeePortal' }) {
  const { profile } = useAuth();
  
  // 🛡️ CRITICAL FIX: Check if Google Auth is currently passing a token in the URL
  const [isProcessingOAuth, setIsProcessingOAuth] = useState(
    window.location.hash.includes('access_token')
  );

  // Give Supabase a couple of seconds to read the token, then release the lock
  useEffect(() => {
    if (isProcessingOAuth) {
      const timer = setTimeout(() => setIsProcessingOAuth(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [isProcessingOAuth]);

  // If we are processing OAuth, PAUSE the redirect to protect the URL hash!
  if (isProcessingOAuth) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="flex flex-col items-center space-y-4">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-slate-200 border-t-amber-500"></div>
          <p className="text-sm font-bold text-slate-500 animate-pulse">Authenticating...</p>
        </div>
      </div>
    );
  }

  // Extract the role, defaulting to 'employee' if it's missing
  const userRole = profile?.role || 'employee';

  // If their role is NOT in the allowed list, kick them out
  if (!allowedRoles.includes(userRole)) {
    return <Navigate to={redirectTo} replace />;
  }

  // If they have permission, render the page!
  return children;
}