import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import PMStaffTab from '../../../src/components/pm/PMStaffTab';
import '../../../src/index.css';
function Preview(){
  const [second,setSecond]=useState(false);
  return <main className="min-h-screen bg-slate-50"><div className="p-4"><p className="text-xs text-slate-500">Synthetic project tasks</p><button onClick={()=>setSecond(v=>!v)} className="mt-2 min-h-11 rounded-lg border bg-white px-3 text-sm">Switch project</button></div><PMStaffTab project={{id:second?'other-project':'sample-project'}} /></main>;
}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><Preview /></QueryClientProvider>);
