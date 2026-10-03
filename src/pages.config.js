/**
 * pages.config.js - Page routing configuration
 * 
 * This file is AUTO-GENERATED. Do not add imports or modify PAGES manually.
 * Pages are auto-registered when you create files in the ./pages/ folder.
 * 
 * THE ONLY EDITABLE VALUE: mainPage
 * This controls which page is the landing page (shown when users visit the app).
 * 
 * Example file structure:
 * 
 *   import HomePage from './pages/HomePage';
 *   import Dashboard from './pages/Dashboard';
 *   import Settings from './pages/Settings';
 *   
 *   export const PAGES = {
 *       "HomePage": HomePage,
 *       "Dashboard": Dashboard,
 *       "Settings": Settings,
 *   }
 *   
 *   export const pagesConfig = {
 *       mainPage: "HomePage",
 *       Pages: PAGES,
 *   };
 * 
 * Example with Layout (wraps all pages):
 *
 *   import Home from './pages/Home';
 *   import Settings from './pages/Settings';
 *   import __Layout from './Layout.jsx';
 *
 *   export const PAGES = {
 *       "Home": Home,
 *       "Settings": Settings,
 *   }
 *
 *   export const pagesConfig = {
 *       mainPage: "Home",
 *       Pages: PAGES,
 *       Layout: __Layout,
 *   };
 *
 * To change the main page from HomePage to Dashboard, use find_replace:
 *   Old: mainPage: "HomePage",
 *   New: mainPage: "Dashboard",
 *
 * The mainPage value must match a key in the PAGES object exactly.
 */
import AdminSettings from './pages/AdminSettings';
import Approvals from './pages/Approvals';
import ChangeOrderBuilder from './pages/ChangeOrderBuilder';
import ChangeOrders from './pages/ChangeOrders';
import ChangeOrderView from './pages/ChangeOrderView';
import ClientDetail from './pages/ClientDetail';
import ClientForms from './pages/ClientForms';
import ClientPortal from './pages/ClientPortal';
import Clients from './pages/Clients';
import Dashboard from './pages/Dashboard';
import HumanResources from './pages/HumanResources';
import Inventory from './pages/Inventory';
import InvoiceBuilder from './pages/InvoiceBuilder';
import InvoiceView from './pages/InvoiceView';
import Invoices from './pages/Invoices';
import LeadDetail from './pages/LeadDetail';
import LeadTracker from './pages/LeadTracker';
import PMDashboard from './pages/PMDashboard';
import PMProjectWorkspace from './pages/PMProjectWorkspace';
import PMProjects from './pages/PMProjects';
import PMTimeline from './pages/PMTimeline';
import Products from './pages/Products';
import ProjectDetail from './pages/ProjectDetail';
import PublicChangeOrderView from './pages/PublicChangeOrderView';
import PublicInvoiceView from './pages/PublicInvoiceView';
import PublicPOView from './pages/PublicPOView';
import PublicQuoteView from './pages/PublicQuoteView';
import PurchaseOrderDetail from './pages/PurchaseOrderDetail';
import PurchaseOrderView from './pages/PurchaseOrderView';
import PurchaseOrders from './pages/PurchaseOrders';
import QuoteBuilder from './pages/QuoteBuilder';
import QuoteView from './pages/QuoteView';
import Quotes from './pages/Quotes';
import Reports from './pages/Reports';
import StrategicGoals from './pages/StrategicGoals';
import Tasks from './pages/Tasks';
import Templates from './pages/Templates';
import Timesheet from './pages/Timesheet';
import Vendors from './pages/Vendors';
import __Layout from './Layout.jsx';
import Tutorials from './pages/Tutorials';
import FAQ from './pages/FAQ';
import Contact from './pages/Contact';
import DailyLogs from './pages/DailyLogs'; 
import PrivacyPolicy from './pages/PrivacyPolicy';



export const PAGES = {
    "AdminSettings": AdminSettings,
    "Approvals": Approvals,
    "ChangeOrderBuilder": ChangeOrderBuilder,
    "ChangeOrders": ChangeOrders,
    "ChangeOrderView": ChangeOrderView,
    "ClientDetail": ClientDetail,
    "ClientForms": ClientForms,
    "ClientPortal": ClientPortal,
    "Clients": Clients,
    "Dashboard": Dashboard,
    "HumanResources": HumanResources,
    "Inventory": Inventory,
    "InvoiceBuilder": InvoiceBuilder,
    "InvoiceView": InvoiceView,
    "Invoices": Invoices,
    "LeadDetail": LeadDetail,
    "LeadTracker": LeadTracker,
    "PMDashboard": PMDashboard,
    "PMProjectWorkspace": PMProjectWorkspace,
    "PMProjects": PMProjects,
    "PMTimeline": PMTimeline,
    "PrivacyPolicy": PrivacyPolicy,
    "Products": Products,
    "ProjectDetail": ProjectDetail,
    "PublicChangeOrderView": PublicChangeOrderView,
    "PublicInvocieView": PublicInvoiceView,
    "PublicPOView": PublicPOView,
    "PublicQuoteView": PublicQuoteView,
    "PurchaseOrderDetail": PurchaseOrderDetail,
    "PurchaseOrderView": PurchaseOrderView,
    "PurchaseOrders": PurchaseOrders,
    "QuoteBuilder": QuoteBuilder,
    "QuoteView": QuoteView,
    "Quotes": Quotes,
    "Reports": Reports,
    "StrategicGoals": StrategicGoals,
    "Tasks": Tasks,
    "Templates": Templates,
    "Timesheet": Timesheet,
    "Vendors": Vendors,
    "Tutorials": Tutorials,
    "FAQ": FAQ,
    "Contact": Contact,
    "DailyLogs": DailyLogs,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};