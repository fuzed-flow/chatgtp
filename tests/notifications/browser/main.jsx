import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import EnhancedNotificationCenter from '../../../src/components/shared/EnhancedNotificationCenter';
import { AIHelpProvider } from '../../../src/components/shared/AIHelpContext';
import AIHelpWidget from '../../../src/components/shared/AIHelpWidget';
import '../../../src/index.css';
function Preview() {
  const location = useLocation();
  return <main className="min-h-screen bg-slate-100 p-8"><div className="max-w-xl mx-auto rounded-xl bg-slate-900 text-white p-5 flex justify-between items-center"><div><h1 className="font-bold">FuzedFlow notifications</h1><p className="text-xs text-slate-400 mt-1">Browser verification with synthetic fixtures</p></div><EnhancedNotificationCenter /></div><p className="text-sm text-slate-500 text-center mt-4">Current destination: {location.pathname + location.search}</p><Toaster /></main>;
}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><BrowserRouter><AIHelpProvider><Preview /><AIHelpWidget /></AIHelpProvider></BrowserRouter></QueryClientProvider>);
