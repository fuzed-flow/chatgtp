import React, { useState, useEffect } from "react";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Bell, Check, Trash2, Clock, AlertCircle, Loader2, DollarSign, Hammer, FileText, Settings, User } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// Map categories to specific icons matching your FuzedFlow UI
const CATEGORY_ICONS = {
  Financial: DollarSign,
  Projects: Hammer,
  Documents: FileText,
  Mentions: User,
  System: AlertCircle
};

const FILTERS = ["Unread", "All", "Action Required", "Projects", "Financial", "Mentions"];

export default function EnhancedNotificationCenter({ onCloseSidebar }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const companyId = profile?.company_id;
  const [open, setOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState("Unread");
  const [showSettings, setShowSettings] = useState(false);

  // 1. FETCH NOTIFICATIONS
  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ["notifications", profile?.id],
    enabled: !!profile?.id && !!companyId,
    queryFn: async () => {
      let query = supabase
        .from("notifications")
        .select("*")
        .eq("company_id", companyId)
        .eq("user_id", profile.id)
        .order("created_at", { ascending: false })
        .limit(100);

      // Apply Profile Preference
      if (profile?.notify_action_required_only) {
        query = query.eq("severity", "Action Required");
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
  });

  // 2. REAL-TIME SUBSCRIPTION
  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase.channel('realtime-notifications')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${profile.id}` }, 
      () => queryClient.invalidateQueries({ queryKey: ["notifications"] }))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [profile?.id, queryClient]);

  // 3. MUTATIONS
  const markAsReadMutation = useMutation({
    mutationFn: async (id) => await supabase.from("notifications").update({ is_read: true }).eq("id", id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markAllAsReadMutation = useMutation({
    mutationFn: async () => await supabase.from("notifications").update({ is_read: true }).eq("user_id", profile.id).eq("is_read", false),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const togglePreferenceMutation = useMutation({
    mutationFn: async (newValue) => await supabase.from("profiles").update({ notify_action_required_only: newValue }).eq("id", profile.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  // 4. FILTERING LOGIC
  const filteredNotifications = notifications.filter(n => {
    if (activeFilter === "Unread") return !n.is_read;
    if (activeFilter === "All") return true;
    if (activeFilter === "Action Required") return n.severity === "Action Required";
    return n.category === activeFilter;
  });

  const unreadCount = notifications.filter(n => !n.is_read).length;

  return (
    <Dialog open={open} onOpenChange={(val) => { setOpen(val); if (val && onCloseSidebar) onCloseSidebar(); }}>
      <DialogTrigger asChild>
        <button className="relative p-2 rounded-lg hover:bg-slate-800 transition-all group outline-none">
          <Bell className="h-5 w-5 text-slate-400 group-hover:text-white transition-colors" />
          {unreadCount > 0 && (
            <span className="absolute top-0 right-0 h-4 w-4 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center font-black shadow-sm ring-2 ring-slate-900">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </DialogTrigger>
      
      <DialogContent className="sm:max-w-lg bg-white border-slate-200 shadow-xl p-0 overflow-hidden z-[100]" aria-describedby={undefined}>
        
        {/* HEADER */}
        <DialogHeader className="p-4 pr-12 border-b border-slate-200 bg-slate-50 flex flex-row items-center justify-between">
          <DialogTitle className="font-black text-lg text-slate-900 flex items-center gap-2">
            Activity Feed
          </DialogTitle>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <Button variant="ghost" size="sm" onClick={() => markAllAsReadMutation.mutate()} className="text-xs font-bold text-blue-600 hover:bg-blue-50 h-8">
                Mark all read
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={() => setShowSettings(!showSettings)} className="h-8 w-8 text-slate-400 hover:text-slate-900">
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        {/* SETTINGS PANEL (Hidden by default) */}
        {showSettings && (
          <div className="p-4 bg-slate-100 border-b border-slate-200 animate-in slide-in-from-top-2">
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <p className="text-sm font-bold text-slate-900">Action Required Only</p>
                <p className="text-xs text-slate-500">Mute FYI and standard updates</p>
              </div>
              <input 
                type="checkbox" 
                checked={profile?.notify_action_required_only || false}
                onChange={(e) => togglePreferenceMutation.mutate(e.target.checked)}
                className="h-5 w-5 rounded border-slate-300 text-blue-600 focus:ring-blue-600 cursor-pointer"
              />
            </label>
          </div>
        )}

        {/* HORIZONTAL FILTER PILLS */}
        <div className="flex overflow-x-auto gap-2 p-3 border-b border-slate-100 custom-scrollbar hide-scroll-bar">
          {FILTERS.map(filter => (
            <button
              key={filter}
              onClick={() => setActiveFilter(filter)}
              className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
                activeFilter === filter 
                  ? "bg-slate-900 text-white shadow-sm" 
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {filter} {filter === "Unread" && unreadCount > 0 && `(${unreadCount})`}
            </button>
          ))}
        </div>

        {/* NOTIFICATIONS LIST */}
        <div className="max-h-[60vh] overflow-y-auto p-0">
          {isLoading ? (
             <div className="py-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
          ) : filteredNotifications.length === 0 ? (
            <div className="text-center py-12 px-4">
              <Bell className="h-10 w-10 text-slate-200 mx-auto mb-3" />
              <p className="text-sm font-bold text-slate-500">No {activeFilter.toLowerCase()} activity to show.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filteredNotifications.map((n) => {
                const Icon = CATEGORY_ICONS[n.category] || AlertCircle;
                const isActionReq = n.severity === "Action Required";
                
                return (
                  <div
                    key={n.id}
                    onClick={() => {
                      if (!n.is_read) markAsReadMutation.mutate(n.id);
                      if (n.action_url) { setOpen(false); navigate(n.action_url); }
                    }}
                    className={`relative p-4 transition-all cursor-pointer hover:bg-slate-50 flex gap-4 ${
                      !n.is_read ? "bg-white" : "bg-slate-50/50 opacity-75"
                    }`}
                  >
                    {/* Action Required Red Indicator Strip */}
                    {isActionReq && !n.is_read && <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-500"></div>}

                    {/* Icon */}
                    <div className="mt-0.5 shrink-0">
                      {isActionReq && !n.is_read ? (
                        <div className="h-10 w-10 rounded-full bg-red-100 flex items-center justify-center border border-red-200">
                          <Icon className="h-5 w-5 text-red-600" />
                        </div>
                      ) : (
                        <div className={`h-10 w-10 rounded-full flex items-center justify-center ${n.is_read ? 'bg-slate-100 text-slate-400' : 'bg-blue-50 text-blue-600'}`}>
                          <Icon className="h-5 w-5" />
                        </div>
                      )}
                    </div>
                    
                    {/* Content (Matches Screenshot Layout) */}
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start mb-0.5">
                        <p className={`text-sm ${isActionReq && !n.is_read ? 'font-black text-red-900' : 'font-bold text-slate-900'} truncate pr-4`}>
                          {n.title}
                        </p>
                      </div>
                      
                      {/* Secondary Context (Italicized and lighter) */}
                      <p className="text-sm font-medium text-slate-600 whitespace-pre-wrap mb-1.5 italic">
                        {n.body}
                      </p>
                      
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                        </span>
                        {n.category && (
                          <span className="text-[9px] font-bold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-sm uppercase">
                            {n.category}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}