import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import AIHelpWidget from '../../../src/components/shared/AIHelpWidget';
import '../../../src/index.css';
createRoot(document.getElementById('root')).render(<BrowserRouter><main className="min-h-screen bg-slate-50 p-4"><header className="rounded-xl bg-slate-900 p-4 text-white"><h1 className="font-bold">FuzedFlow</h1><p className="text-xs mt-1">Project workspace preview</p></header><section className="mt-4 rounded-xl border bg-white p-4"><h2 className="font-semibold">Project overview</h2><p className="mt-2 text-sm text-slate-500">Tap AI Help for guidance using the app.</p></section><AIHelpWidget /></main></BrowserRouter>);
