import { getPlanIdFromPrice, getUsdPriceId } from "@/lib/subscriptionPlans";
import React, { useState, useEffect } from "react";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Target, FileText, Receipt, Plus, ArrowRight, AlertTriangle, Users,
  CheckSquare, ChevronDown, ChevronUp, Phone, Mail, DollarSign,
  LayoutTemplate, Loader2, FileStack, Edit3
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { parseISO, isValid } from "date-fns";
import UrgentTasksBanner from "../components/shared/UrgentTasksBanner";

// Shared Components
import LeadFormDialog from "../components/leads/LeadFormDialog";
import StatusBadge from "../components/shared/StatusBadge";
import DashboardNotes from "../components/dashboard/DashboardNotes";
import ClientFormDialog from "../components/clients/ClientFormDialog";
import ContinueWorking from "../components/dashboard/ContinueWorking";
import CreateTaskDialog from "../components/tasks/CreateTaskDialog";
import ActiveProjectsSection from "../components/shared/ActiveProjects";
import { useTaskVendors } from "@/hooks/useTaskVendors";

const safeParseDate = (dateString) => {
  if (!dateString) return null;
  const parsed = parseISO(dateString);
  return isValid(parsed) ? parsed : null;
};


export default function Dashboard() {
  const navigate = useNavigate(); 
  const qc = useQueryClient();
  const { profile } = useAuth();
  const companyId = profile?.company_id;
  const { vendors, canCreateVendor, createVendor, isCreatingVendor } = useTaskVendors({ companyId, role: profile?.role });
  
  const [isRedirectingToStripe, setIsRedirectingToStripe] = useState(() => {
    return !!localStorage.getItem('pending_stripe_checkout') || !!localStorage.getItem('google_signup_attempt');
  });
  
  const [isPollingActivation, setIsPollingActivation] = useState(false);

  useEffect(() => {
    let isMounted = true; 

    const triggerPendingCheckout = async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const isSuccess = urlParams.get('success');
      const isCanceled = urlParams.get('canceled');
      const urlError = urlParams.get('error'); 
      const planFromUrl = urlParams.get('plan');

      if (planFromUrl) {
        localStorage.setItem('pending_stripe_checkout', planFromUrl);
        window.history.replaceState({}, document.title, window.location.pathname);
      }

      if (urlError) {
        localStorage.removeItem('google_signup_attempt');
        return;
      }

      if (isSuccess || isCanceled) {
        localStorage.removeItem('pending_stripe_checkout');
        setIsRedirectingToStripe(false);
        if (isSuccess) {
           setIsPollingActivation(true); 
        }
        return; 
      }

      const isGoogleSignupAttempt = localStorage.getItem('google_signup_attempt');
      const pendingPriceId = getUsdPriceId(localStorage.getItem('pending_stripe_checkout'));

      if (isGoogleSignupAttempt) {
        const { data: { session } } = await supabase.auth.getSession();
        
        if (session?.user) {
          const createdTime = new Date(session.user.created_at).getTime();
          const isExistingUser = (Date.now() - createdTime) > 30000;

          if (isExistingUser) {
            toast.info("Welcome back! We securely logged you in.");
          }
        }
        localStorage.removeItem('google_signup_attempt');
      }

      if (pendingPriceId && companyId) {
        const internalPlanId = getPlanIdFromPrice(pendingPriceId);

        try {
          const { data, error } = await supabase.functions.invoke('create-checkout', {
            body: { 
              price_id: pendingPriceId, 
              plan_id: internalPlanId,
              company_id: companyId 
            }
          });

          if (error) throw error;
          
          localStorage.removeItem('pending_stripe_checkout');
          
          if (data?.url && isMounted) {
            window.location.href = data.url;
          }
        } catch (error) {
          console.error("Failed to generate checkout:", error);
          setIsRedirectingToStripe(false);
          localStorage.removeItem('pending_stripe_checkout'); 
          toast.error("Failed to connect to billing. Please contact support.");
        }
      } else if (!pendingPriceId) {
        setIsRedirectingToStripe(false);
      }
    };

    const pendingId = localStorage.getItem('pending_stripe_checkout');
    if (!pendingId || companyId) {
      triggerPendingCheckout();
    }

    return () => { isMounted = false; };
  }, [companyId]);
  
  useEffect(() => {
    let interval;
    if (isPollingActivation && companyId) {
      const checkStatus = async () => {
        const { data } = await supabase.from("companies").select("subscription_status").eq("id", companyId).single();
        if (data && (data.subscription_status === 'Active' || data.subscription_status === 'active' || data.subscription_status === 'trialing')) {
          setIsPollingActivation(false);
          toast.success("Subscription activated successfully!");
          qc.invalidateQueries({ queryKey: ["myCompany", companyId] });
          window.history.replaceState({}, document.title, window.location.pathname);
          clearInterval(interval);
        }
      };
      
      checkStatus(); 
      interval = setInterval(checkStatus, 2000); 
    }
    return () => clearInterval(interval);
  }, [isPollingActivation, companyId, qc]);

  useEffect(() => {
    const checkInviteStatus = async () => {
      const isCheckingInvite = localStorage.getItem('checking_invite_status');
      if (!isCheckingInvite) return;
      localStorage.removeItem('checking_invite_status');

      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !user.email) return;

      const { data: invites, error } = await supabase
        .from('team_invites')
        .select('id')
        .eq('email', user.email);

      if (error) {
        console.error("Error checking invite:", error);
        return;
      }

      if (invites && invites.length > 0) {
        toast.error("Invitation failed: You already belong to a FuzedFlow company! One email can only belong to one company.", { duration: 8000 });
      } else {
        toast.success("Successfully joined the team! Welcome to FuzedFlow.");
      }
    };

    checkInviteStatus();
  }, []);
  
  const [expandedLead, setExpandedLead] = useState(null);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [isClientModalOpen, setIsClientModalOpen] = useState(false);
  const [isLeadDialogOpen, setIsLeadDialogOpen] = useState(false);
  const [isProjectNoteModalOpen, setIsProjectNoteModalOpen] = useState(false);

  const { data: myCompany, isLoading: isCompanyLoading } = useQuery({
    queryKey: ["myCompany", companyId], 
    enabled: !!companyId,
    queryFn: async () => { 
      const { data } = await supabase.from("companies").select("*").eq("id", companyId).single(); 
      return data; 
    }
  });

  const isSubscriptionActive = myCompany?.subscription_status === 'Active' || myCompany?.subscription_status === 'trialing' || myCompany?.subscription_status === 'active';
  
  const { data: leads = [] } = useQuery({ 
    queryKey: ["leads", companyId], enabled: !!companyId,
    queryFn: async () => { const { data } = await supabase.from("leads").select("*").eq("company_id", companyId).order("created_at", { ascending: false }); return data || []; } 
  });
  
  const { data: quotes = [] } = useQuery({ 
    queryKey: ["quotes", companyId], enabled: !!companyId,
    queryFn: async () => { const { data } = await supabase.from("quotes").select("*").eq("company_id", companyId).order("created_at", { ascending: false }); return data || []; } 
  });
  
  const { data: projects = [] } = useQuery({ 
    queryKey: ["projects", companyId], enabled: !!companyId,
    queryFn: async () => { const { data } = await supabase.from("projects").select("*").eq("company_id", companyId).order("created_at", { ascending: false }); return data || []; } 
  });

  const { data: clients = [] } = useQuery({ 
    queryKey: ["clients", companyId], enabled: !!companyId,
    queryFn: async () => { const { data } = await supabase.from("clients").select("*").eq("company_id", companyId); return data || []; } 
  });
  
  const { data: invoices = [] } = useQuery({ 
    queryKey: ["invoices", companyId], enabled: !!companyId,
    queryFn: async () => { const { data } = await supabase.from("invoices").select("*").eq("company_id", companyId).order("created_at", { ascending: false }); return data || []; } 
  });

  const { data: changeOrders = [] } = useQuery({ 
    queryKey: ["change_orders", companyId], enabled: !!companyId,
    queryFn: async () => { const { data } = await supabase.from("change_orders").select("*").eq("company_id", companyId).order("created_at", { ascending: false }); return data || []; } 
  });
  
  const { data: projectTasks = [] } = useQuery({ 
    queryKey: ["project_tasks", companyId], enabled: !!companyId,
    queryFn: async () => { const { data } = await supabase.from("project_tasks").select("*").eq("company_id", companyId).order("created_at", { ascending: false }); return data || []; } 
  });

  const { data: users = [] } = useQuery({
    queryKey: ["company_users", companyId], enabled: !!companyId,
    queryFn: async () => {
      const { data: usersData } = await supabase.from("users").select("id, full_name, email").eq("company_id", companyId);
      const { data: profilesData } = await supabase.from("profiles").select("id, full_name").eq("company_id", companyId);
      return [...(usersData || []), ...(profilesData || [])];
    }
  });

  const createLeadMutation = useMutation({
    mutationFn: async (data) => {
      const { error } = await supabase.from("leads").insert([{ ...data, company_id: companyId }]);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      toast.success("Lead created successfully!");
    },
  });

  const saveTaskMutation = useMutation({
    mutationFn: async (payload) => {
      const assignedToArray = payload.assigned_to && payload.assigned_to !== "none" ? [payload.assigned_to] : null;
      const { error } = await supabase.from("project_tasks").insert([{
        company_id: companyId,
        title: payload.title,
        description: payload.description,
        project_id: payload.project_id === "none" ? null : payload.project_id,
        status: payload.status,
        priority: payload.priority,
        due_date_target: payload.due_date || null,
        assigned_to: assignedToArray,
        vendor_id: (!payload.vendor_id || payload.vendor_id === "none") ? null : payload.vendor_id,
      }]);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project_tasks"] });
      toast.success("Task created successfully!");
      setIsTaskModalOpen(false);
    },
    onError: (err) => toast.error(`Failed to create task: ${err.message}`)
  });
  
  const activeProjects = projects.filter(p => !["Completed", "Closed", "Canceled", "Archived"].includes(p.status));
  const activeQuotes = quotes.filter(q => !q.is_archived && !["Declined", "Expired"].includes(q.status))
  const activeLeads = leads.filter(l => !["Won", "Lost"].includes(l.pipeline_stage));
  
  const formatCurrency = (val) => val ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val) : '$0.00';
  
  const getClientName = (clientId) => {
    if (!clientId) return 'No Client Linked';
    const client = clients.find(c => String(c.id) === String(clientId));
    if (!client) return 'Unknown Client';
    
    const name = client.name?.trim();
    const first = client.first_name?.trim();
    const last = client.surname?.trim();
    const primary = client.primary_contact_name?.trim();

    if (name && name !== "") return name;
    if (first || last) return [first, last].filter(Boolean).join(" ");
    if (primary && primary !== "") return primary;
    
    return 'Unnamed Client';
  };

  if (isRedirectingToStripe) {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-slate-50">
        <Loader2 className="h-12 w-12 animate-spin text-amber-500 mb-4" />
        <h2 className="text-xl font-bold text-slate-900">Preparing your secure checkout...</h2>
        <p className="text-slate-500 mt-2">Redirecting to Stripe securely</p>
      </div>
    );
  }

  if (isPollingActivation) {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-slate-50">
        <Loader2 className="h-12 w-12 animate-spin text-emerald-500 mb-4" />
        <h2 className="text-xl font-bold text-slate-900">Activating your account...</h2>
        <p className="text-slate-500 mt-2">Waiting for secure payment confirmation from Stripe.</p>
      </div>
    );
  }

  if (!companyId || (!isCompanyLoading && (!myCompany || !isSubscriptionActive))) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4">
        <Card className="max-w-md w-full p-8 text-center shadow-2xl border-0 ring-1 ring-slate-800 animate-in fade-in zoom-in-95">
          <div className="mx-auto w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mb-6 shadow-inner">
            <AlertTriangle className="h-8 w-8 text-amber-600" />
          </div>
          <h2 className="text-2xl font-black text-slate-900 mb-2">Subscription Required</h2>
          <p className="text-slate-500 mb-8 font-medium">
            Your Fuzed Flow account is currently inactive. Please complete your secure checkout to unlock your dashboard and start managing your projects.
          </p>
          
          <div className="flex flex-col gap-3">
            {myCompany?.stripe_customer_id ? (
              <div className="w-full flex flex-col gap-2">
                <Button 
                  onClick={() => window.location.href = 'https://billing.stripe.com/p/login/test_YOUR_LINK_HERE'} 
                  className="w-full h-12 text-lg font-bold bg-amber-500 hover:bg-amber-600 text-slate-900"
                >
                  <Receipt className="mr-2 h-5 w-5" /> Manage Billing
                </Button>
                <p className="text-xs text-slate-500 text-center px-2">
                  <span className="font-bold">💡 Note:</span> In the portal, Qty 1 is your base plan. Increase the quantity to add more team members!
                </p>
              </div>
            ) : (
              <Button 
                onClick={() => window.location.href = 'https://www.fuzedflow.com/#pricing'} 
                className="w-full h-12 text-lg font-bold bg-amber-500 hover:bg-amber-600 text-slate-900"
              >
                <ArrowRight className="mr-2 h-5 w-5" /> Choose a Plan
              </Button>
            )}
            
            <Button variant="ghost" onClick={() => supabase.auth.signOut()} className="text-slate-500 hover:text-slate-700 mt-2">
              Sign out securely
            </Button>
          </div>
        </Card>
      </div>
    );
  }
              
  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 pb-20">
      
      {/* HEADER SECTION WITH CREATE BUTTON AND URGENT TASKS */}
      <div className="flex flex-col gap-4">
        
        {/* Title & Dropdown Row */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight">
              Let's get to work, {profile?.full_name?.split(' ')[0] || 'Admin'}.
            </h1>
            <p className="text-slate-500 font-medium mt-1">Here is what's on the docket today.</p>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="bg-amber-400 hover:bg-amber-500 text-slate-900 font-bold h-11 px-6 rounded-xl shadow-sm w-full sm:w-auto">
                <Plus className="h-5 w-5 mr-2" /> Create...
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 font-medium p-2">
              
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-slate-400 font-black">Sales & CRM</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setIsLeadDialogOpen(true)} className="cursor-pointer">
                <Target className="mr-2 h-4 w-4 text-blue-500" /> New Lead
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setIsClientModalOpen(true)} className="cursor-pointer">
                <Users className="mr-2 h-4 w-4 text-purple-500" /> New Client
              </DropdownMenuItem>
              
              <DropdownMenuSeparator />
              
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-slate-400 font-black">Action Items</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setIsTaskModalOpen(true)} className="cursor-pointer">
                <CheckSquare className="mr-2 h-4 w-4 text-slate-600" /> New Task
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setIsProjectNoteModalOpen(true)} className="cursor-pointer">
                <Edit3 className="mr-2 h-4 w-4 text-indigo-500" /> New Note/Photo
              </DropdownMenuItem>
              
              <DropdownMenuSeparator />
              
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-slate-400 font-black">Quoting</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => navigate("/QuoteBuilder?create=true")} className="cursor-pointer">
                <FileText className="mr-2 h-4 w-4 text-amber-500" /> New Quote
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/Templates")} className="cursor-pointer">
                <LayoutTemplate className="mr-2 h-4 w-4 text-emerald-500" /> Quote from Template
              </DropdownMenuItem>
              
              <DropdownMenuSeparator />
              
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-slate-400 font-black">Billing & Variations</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => navigate("/InvoiceBuilder")} className="cursor-pointer">
                <Receipt className="mr-2 h-4 w-4 text-green-600" /> New Invoice
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/ChangeOrderBuilder")} className="cursor-pointer">
                <FileStack className="mr-2 h-4 w-4 text-orange-500" /> New Change Order
              </DropdownMenuItem>
              
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Urgent Tasks Banner */}
        <UrgentTasksBanner projectTasks={projectTasks} />
        </div> 

      <div className="flex flex-col lg:flex-row gap-6 pt-2">
        
        {/* LEFT COLUMN */}
        <div className="w-full lg:w-2/3 flex flex-col gap-6 order-2 lg:order-1">
          <ContinueWorking quotes={activeQuotes} invoices={invoices} clients={clients} leads={leads} />

          <Card className="p-5 md:p-6 border-slate-200 shadow-sm bg-white flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Target className="h-5 w-5 text-amber-500" /> Leads Snapshot
              </h3>
              <Button variant="ghost" size="sm" onClick={() => navigate('/LeadTracker')} className="text-slate-500 hover:text-slate-900">
                View All Leads
              </Button>
            </div>
            
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
              {["New", "Contacted", "Booked Visit", "Quoted", "Negotiation", "Won"].map(stage => {
                const count = leads.filter(l => l.pipeline_stage === stage).length;
                return (
                  <div key={stage} className="text-center p-3 rounded-xl bg-gradient-to-br from-slate-50 to-slate-100 border border-slate-100">
                    <p className="text-xl font-black text-slate-800">{count}</p>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mt-1">{stage}</p>
                  </div>
                );
              })}
            </div>

            <div className="space-y-3 mt-2">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Most Recent Leads</h4>
              {activeLeads.slice(0, 3).map(lead => (
                <div key={lead.id} className="border border-slate-200 rounded-xl bg-white overflow-hidden shadow-sm transition-all">
                  <div className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-50" onClick={() => setExpandedLead(expandedLead === lead.id ? null : lead.id)}>
                    <div>
                      <h4 className="font-bold text-slate-900">{lead.contact_name}</h4>
                      <p className="text-sm text-slate-500">{lead.source || 'General Inquiry'}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusBadge status={lead.pipeline_stage} />
                      {expandedLead === lead.id ? <ChevronUp className="h-5 w-5 text-slate-400" /> : <ChevronDown className="h-5 w-5 text-slate-400" />}
                    </div>
                  </div>
                  {expandedLead === lead.id && (
                    <div className="p-4 border-t border-slate-100 bg-slate-50 animate-in slide-in-from-top-2 flex flex-col gap-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-xs text-slate-500 font-bold uppercase flex items-center gap-1 mb-1"><DollarSign className="h-3 w-3"/> Est. Value</p>
                          <p className="font-semibold text-slate-900">{formatCurrency(lead.value_estimate)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500 font-bold uppercase flex items-center gap-1 mb-1"><Phone className="h-3 w-3"/> Phone</p>
                          <p className="font-medium text-slate-900">{lead.contact_phone || 'N/A'}</p>
                        </div>
                        <div className="col-span-2">
                          <p className="text-xs text-slate-500 font-bold uppercase flex items-center gap-1 mb-1"><Mail className="h-3 w-3"/> Email</p>
                          <p className="font-medium text-slate-900">{lead.contact_email || 'N/A'}</p>
                        </div>
                      </div>
                      <Button onClick={() => navigate(`/LeadDetail?id=${lead.id}`)} className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold">
                        Open Lead Profile <ArrowRight className="h-4 w-4 ml-2" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>

          <ActiveProjectsSection activeProjects={activeProjects} clients={clients} />
        </div>

        {/* RIGHT COLUMN (NOTES) */}
        <div className="w-full lg:w-1/3 flex flex-col gap-6 order-1 lg:order-2">
          <div className="h-full">
            <DashboardNotes 
              openSubmitModal={isProjectNoteModalOpen} 
              setOpenSubmitModal={setIsProjectNoteModalOpen} 
            />
          </div>
        </div>

      </div>

      <CreateTaskDialog 
        open={isTaskModalOpen} 
        onOpenChange={setIsTaskModalOpen} 
        clients={clients} 
        projects={projects} 
        leads={leads} 
        users={users}
        vendors={vendors}
        onCreateVendor={canCreateVendor ? createVendor : undefined}
        isCreatingVendor={isCreatingVendor}
        onSubmit={(data) => saveTaskMutation.mutate(data)} 
        isLoading={saveTaskMutation.isPending} 
      />

      {isClientModalOpen && (
        <ClientFormDialog 
          open={isClientModalOpen} 
          onOpenChange={setIsClientModalOpen} 
          onSave={async (newClientData) => {
            const { error } = await supabase.from('clients').insert([{ ...newClientData, company_id: companyId }]);
            if (error) throw error;
            qc.invalidateQueries(["clients"]); 
            setIsClientModalOpen(false); 
          }} 
        />
      )}

      <LeadFormDialog open={isLeadDialogOpen} onOpenChange={setIsLeadDialogOpen} users={users} onSave={(data) => createLeadMutation.mutate(data)} />
    </div>
  );
}
