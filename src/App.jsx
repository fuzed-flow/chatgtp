import { Toaster } from "@/components/ui/toaster"
import { useToast } from "@/components/ui/use-toast";
import { Fragment } from 'react';
import { createBrowserRouter, RouterProvider, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'

// --- CORE UTILS & CONTEXT ---
import NavigationTracker from '@/lib/NavigationTracker'
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { pagesConfig } from './pages.config'
import RoleGuard from '@/components/RoleGuard';
import PageNotFound from './lib/PageNotFound';
import { getRouteAccess } from '@/lib/roleAccess';

// --- PUBLIC & UNPROTECTED PAGES ---
import ContractorPortal from './pages/ContractorPortal';
import PublicQuoteView from './pages/PublicQuoteView';
import PublicInvoiceView from "./pages/PublicInvoiceView";
import PublicPOView from "./pages/PublicPOView";
import PublicChangeOrderView from "./pages/PublicChangeOrderView";
import ClientPortal from "./pages/ClientPortal";
import PrivacyPolicy from './pages/PrivacyPolicy';
import Login from './pages/Login'; 
import Signup from './pages/Signup';

// --- EXPLICIT EXPORTED PAGES ---
import EmployeePortalPage from './pages/EmployeePortal';
import LeadDetail from './pages/LeadDetail';
import Tutorials from './pages/Tutorials';
import FAQ from './pages/FAQ';
import Contact from './pages/Contact';
import HelpArticles from './pages/HelpArticles';
import Warranty from './pages/Warranty';
import DocumentRequests from './pages/DocumentRequests';
import DocumentResponse from './pages/DocumentResponse';
import WarrantyResponse from './pages/WarrantyResponse';
import ClientUpdateView from './pages/ClientUpdateView';
import ProjectCloseoutView from './pages/ProjectCloseoutView';

// --- COMPONENTS ---
import AIHelpWidget from "./components/shared/AIHelpWidget";
import { AIHelpProvider } from "./components/shared/AIHelpContext";

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const LayoutWrapper = ({ children, currentPageName }) => {
  const location = useLocation();
  const documentKey = ['QuoteBuilder', 'ChangeOrderBuilder', 'InvoiceBuilder'].includes(currentPageName)
    ? `${location.pathname}${location.search}`
    : currentPageName;
  const content = <Fragment key={documentKey}>{children}</Fragment>;
  return Layout ? <Layout currentPageName={currentPageName}>{content}</Layout> : content;
};

const AuthenticatedApp = () => {
  const { loading, user, profile, accessError, refreshAccess, signOut } = useAuth();

  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (user && accessError) {
    return (
      <main className="fixed inset-0 flex items-center justify-center bg-slate-50 p-6">
        <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-xl font-black text-slate-900">Workspace unavailable</h1>
          <p role="alert" className="mt-2 text-sm leading-6 text-slate-600">{accessError.message}</p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <button type="button" onClick={refreshAccess} className="min-h-11 rounded-xl bg-amber-400 px-5 text-sm font-bold text-slate-950 hover:bg-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2">
              Try again
            </button>
            <button type="button" onClick={signOut} className="min-h-11 rounded-xl border border-slate-300 bg-white px-5 text-sm font-bold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2">
              Sign out
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (!user || profile?.is_active === false) {
    return <Navigate to="/login" replace />;
  }

  return (
    <AIHelpProvider>
      <Routes>
        {/* 🟢 EVERYONE (Default entry for Employees) */}
        <Route path="/EmployeePortal" element={
          <LayoutWrapper currentPageName="EmployeePortal">
            <EmployeePortalPage />
          </LayoutWrapper>
        } />
        
        {/* 🟡 MANAGERS & ADMINS ONLY (Employees get kicked back to EmployeePortal) */}
        <Route path="/" element={
          <RoleGuard {...getRouteAccess(mainPageKey)}>
            <LayoutWrapper currentPageName={mainPageKey}>
              <MainPage />
            </LayoutWrapper>
          </RoleGuard>
        } />
        
        {/* 🟡 MANAGERS & ADMINS: Dynamically mapped pages from config */}
        {Object.entries(Pages)
          // 🛡️ FILTER OUT THE ADMIN-ONLY PAGES SO MANAGERS CANNOT ACCESS THEM
          .filter(([path]) => !['Invoices', 'HumanResources', 'AdminSettings', 'FAQ', 'Tutorials', 'Contact', 'HelpArticles'].includes(path))
          .map(([path, Page]) => (
            <Route
              key={path}
              path={`/${path}`}
              element={
                <RoleGuard {...getRouteAccess(path)}>
                  <LayoutWrapper currentPageName={path}>
                    <Page />
                  </LayoutWrapper>
                </RoleGuard>
              }
            />
          ))}
        
        {/* 🟡 EXPLICIT MANAGER & ADMIN ROUTES */}
        <Route path="/LeadDetail" element={
          <RoleGuard {...getRouteAccess('LeadDetail')}>
            <LayoutWrapper currentPageName="LeadDetail"><LeadDetail /></LayoutWrapper>
          </RoleGuard>
        } />
        <Route path="/Tutorials" element={
            <LayoutWrapper currentPageName="Tutorials"><Tutorials /></LayoutWrapper>
        } />
        <Route path="/FAQ" element={
            <LayoutWrapper currentPageName="FAQ"><FAQ /></LayoutWrapper>
        } />
        <Route path="/HelpArticles" element={
            <LayoutWrapper currentPageName="HelpArticles"><HelpArticles /></LayoutWrapper>
        } />
        <Route path="/Contact" element={
            <LayoutWrapper currentPageName="Contact"><Contact /></LayoutWrapper>
        } />
        <Route path="/Warranty" element={
          <RoleGuard {...getRouteAccess('Warranty')}>
            <LayoutWrapper currentPageName="Warranty"><Warranty /></LayoutWrapper>
          </RoleGuard>
        } />
        <Route path="/DocumentRequests" element={
          <RoleGuard {...getRouteAccess('DocumentRequests')}>
            <LayoutWrapper currentPageName="DocumentRequests"><DocumentRequests /></LayoutWrapper>
          </RoleGuard>
        } />
        <Route path="/Settings" element={
          <RoleGuard {...getRouteAccess('Settings')}>
            <Navigate to="/AdminSettings" replace />
          </RoleGuard>
        } />

        <Route path="/ClientUpdateView" element={
          <RoleGuard {...getRouteAccess('ClientUpdates')}>
            <ClientUpdateView />
          </RoleGuard>
        } />

        <Route path="/ProjectCloseoutView" element={
          <RoleGuard {...getRouteAccess('ProjectCloseouts')}>
            <ProjectCloseoutView />
          </RoleGuard>
        } />

        <Route path="/AdminSettings" element={
          <RoleGuard {...getRouteAccess('AdminSettings')}>
            <LayoutWrapper currentPageName="AdminSettings"><Pages.AdminSettings /></LayoutWrapper>
          </RoleGuard>
        } />

        {/* 🔴 ADMIN ONLY EXPLICIT ROUTES */}
        <Route path="/Invoices" element={
          <RoleGuard {...getRouteAccess('Invoices')}>
            <LayoutWrapper currentPageName="Invoices"><Pages.Invoices /></LayoutWrapper>
          </RoleGuard>
        } />
        
        <Route path="/HumanResources" element={
          <RoleGuard {...getRouteAccess('HumanResources')}>
            <LayoutWrapper currentPageName="HumanResources"><Pages.HumanResources /></LayoutWrapper>
          </RoleGuard>
        } />

        {/* Catch-All 404 */}
        <Route path="*" element={<PageNotFound />} />
      </Routes>

      {/* 🤖 GLOBAL AI HELP WIDGET FOR AUTHENTICATED USERS */}
      <AIHelpWidget />
    </AIHelpProvider>
  );
};

function AppRoutes() {
  return (
    <>
        <NavigationTracker />
        
        <Routes>
          {/* 🟢 PUBLIC / UNPROTECTED ROUTES (Bypasses AuthProvider) */}
<Route path="/ContractorPortal" element={<ContractorPortal />} />
<Route path="/contractor-portal" element={<ContractorPortal />} />
<Route path="/login" element={<Login />} />
<Route path="/SignIn" element={<Navigate to="/login" replace />} />
<Route path="/signin" element={<Navigate to="/login" replace />} />
<Route path="/signup" element={<Signup />} />
<Route path="/privacy-policy" element={<PrivacyPolicy />} />
          
          {/* Public Client & Vendor Views */}
          <Route path="/PublicQuoteView" element={<PublicQuoteView />} />
          <Route path="/ClientPortal" element={<ClientPortal />} />
          <Route path="/PublicInvoiceView" element={<PublicInvoiceView />} />
          <Route path="/PublicChangeOrderView" element={<PublicChangeOrderView />} />
          <Route path="/PublicPOView" element={<PublicPOView />} />
          <Route path="/DocumentResponse" element={<DocumentResponse />} />
          <Route path="/WarrantyResponse" element={<WarrantyResponse />} />

          {/* 🔴 PROTECTED APP ROUTES */}
          {/* Only these routes pass through the AuthProvider */}
          <Route 
            path="/*" 
            element={
              <AuthProvider>
                <AuthenticatedApp />
              </AuthProvider>
            } 
          />
        </Routes>

    </>
  );
}

// Data-router context enables navigation blocking while keeping the existing
// public/protected route tree and AuthProvider boundary intact.
const router = createBrowserRouter([{ path: '*', element: <AppRoutes /> }]);

function App() {
  return (
    <QueryClientProvider client={queryClientInstance}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  )
}

export default App;
