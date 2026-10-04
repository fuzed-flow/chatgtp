import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter,Routes,Route,Link,useLocation} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MockAuth} from './mockAuth';
import {failNextLoad} from './mockDb';
import FAQ from '../../../src/pages/FAQ';
import HelpArticles from '../../../src/pages/HelpArticles';
import Contact from '../../../src/pages/Contact';
import Tutorials from '../../../src/pages/Tutorials';
import HelpMenu from '../../../src/components/shared/HelpMenu';
import AIHelpWidget from '../../../src/components/shared/AIHelpWidget';
import Layout from '../../../src/Layout';
import '../../../src/index.css';
const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
function HelpRoutes(){return <Routes><Route path="/FAQ" element={<FAQ/>}/><Route path="/Contact" element={<Contact/>}/><Route path="/Tutorials" element={<Tutorials/>}/><Route path="/HelpArticles" element={<HelpArticles/>}/><Route path="*" element={<HelpArticles/>}/></Routes>;}
function PreviewSurface({role,setRole}){
 const location=useLocation();
 const [actualLayout]=useState(()=>new URLSearchParams(window.location.search).get('shell')==='app');
 const currentPageName=['FAQ','Contact','Tutorials'].find(page=>location.pathname===`/${page}`)||'HelpArticles';
 if(actualLayout)return <><Layout currentPageName={currentPageName}><HelpRoutes/></Layout><AIHelpWidget/></>;
 return <div className="min-h-screen bg-slate-50"><header className="flex min-h-16 items-center justify-between gap-2 bg-slate-900 px-4"><Link to="/HelpArticles" className="text-sm font-bold text-white">FuzedFlow</Link><div className="rounded-xl bg-white"><HelpMenu/></div></header><aside className="flex flex-wrap items-center gap-2 border-b bg-amber-50 px-4 py-2 text-xs"><span>Preview only · synthetic records</span><label>Role <select aria-label="Preview role" value={role} onChange={e=>setRole(e.target.value)} className="min-h-11 rounded border bg-white px-2">{['owner','manager','office','employee','subcontractor'].map(r=><option key={r}>{r}</option>)}</select></label><button className="min-h-11 rounded border bg-white px-3" onClick={()=>{failNextLoad();client.resetQueries({queryKey:['help-faqs']});client.resetQueries({queryKey:['help-portal']});}}>Simulate load error</button></aside><HelpRoutes/><AIHelpWidget/></div>;
}
function Preview(){const [role,setRole]=useState('owner');return <QueryClientProvider client={client}><MockAuth role={role}><BrowserRouter><PreviewSurface role={role} setRole={setRole}/></BrowserRouter></MockAuth></QueryClientProvider>;}
createRoot(document.getElementById('root')).render(<Preview/>);
