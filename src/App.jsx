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
import TeamSettings from './pages/TeamSettings';
import Tutorials from './pages/Tutorials';
import FAQ from './pages/FAQ';
import Contact from './pages/Contact';
import HelpArticles from './pages/HelpArticles';
import Warranty from './pages/Warranty';
import DocumentRequests from './pages/DocumentRequests';
import DocumentResponse from './pages/DocumentResponse';
import WarrantyResponse from './pages/WarrantyResponse';

// --- COMPONENTS ---
import AIHelpWidget from "./components/shared/AIHelpWidget";

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
  const { loading, user } = useAuth();

  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <>
      <Routes>
        {/* 🟢 EVERYONE (Default entry for Employees) */}
        <Route path="/EmployeePortal" element={
          <LayoutWrapper currentPageName="EmployeePortal">
            <EmployeePortalPage />
          </LayoutWrapper>
        } />
        
        {/* 🟡 MANAGERS & ADMINS ONLY (Employees get kicked back to EmployeePortal) */}
        <Route path="/" element={
          <RoleGuard allowedRoles={['admin', 'owner', 'manager', 'office']}>
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
                <RoleGuard allowedRoles={['admin', 'owner', 'manager', 'office']}>
                  <LayoutWrapper currentPageName={path}>
                    <Page />
                  </LayoutWrapper>
                </RoleGuard>
              }
            />
          ))}
        
        {/* 🟡 EXPLICIT MANAGER & ADMIN ROUTES */}
        <Route path="/LeadDetail" element={
          <RoleGuard allowedRoles={['admin', 'owner', 'manager', 'office']}>
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
            <LayoutWrapper currentPageName="Warranty"><Warranty /></LayoutWrapper>
        } />
        <Route path="/DocumentRequests" element={
            <LayoutWrapper currentPageName="DocumentRequests"><DocumentRequests /></LayoutWrapper>
        } />
        <Route path="/Settings" element={
          <RoleGuard allowedRoles={['admin', 'owner', 'manager', 'office']}>
            <LayoutWrapper currentPageName="Team Settings"><TeamSettings /></LayoutWrapper>
          </RoleGuard>
        } />

        <Route path="/AdminSettings" element={
          <RoleGuard allowedRoles={['admin', 'owner', 'manager']}>
            <LayoutWrapper currentPageName="Admin Settings"><Pages.AdminSettings /></LayoutWrapper>
          </RoleGuard>
        } />

        {/* 🔴 ADMIN ONLY EXPLICIT ROUTES */}
        <Route path="/Invoices" element={
          <RoleGuard allowedRoles={['admin', 'owner', 'office']}>
            <LayoutWrapper currentPageName="Invoices"><Pages.Invoices /></LayoutWrapper>
          </RoleGuard>
        } />
        
        <Route path="/HumanResources" element={
          <RoleGuard allowedRoles={['admin', 'owner', 'office']}>
            <LayoutWrapper currentPageName="HumanResources"><Pages.HumanResources /></LayoutWrapper>
          </RoleGuard>
        } />

        {/* Catch-All 404 */}
        <Route path="*" element={<PageNotFound />} />
      </Routes>

      {/* 🤖 GLOBAL AI HELP WIDGET FOR AUTHENTICATED USERS */}
      <AIHelpWidget />
    </>
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
