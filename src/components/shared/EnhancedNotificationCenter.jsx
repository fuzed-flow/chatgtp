import React, { useEffect, useState } from "react";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Bell, AlertCircle, Loader2, DollarSign, Hammer, FileText, Settings, AtSign, Calendar, Clock } from "lucide-react";
import { formatDistanceToNow, isValid } from "date-fns";
import { toast } from "sonner";
import { notificationLink } from "@/lib/notificationLinks";

const ICONS = { Financial: DollarSign, Projects: Hammer, Documents: FileText, Mentions: AtSign, Scheduling: Calendar, Timesheets: Clock };
const FILTERS = ["Unread", "All", "Mentions", "Projects", "Financial", "Action Required"];
const PRIORITIES = {
  "Action Required": "bg-red-50 text-red-700 border-red-200",
  Important: "bg-amber-50 text-amber-800 border-amber-200",
  FYI: "bg-blue-50 text-blue-700 border-blue-200",
};
const PAGE_SIZE = 30;

export default function EnhancedNotificationCenter({ onCloseSidebar }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { profile } = useAuth();
  const companyId = profile?.company_id;
  const userId = profile?.id;
  const actionOnly = !!profile?.notify_action_required_only;
  const enabled = !!userId && !!companyId && profile?.is_active !== false;
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("Unread");
  const [page, setPage] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const scope = ["notifications", companyId, userId];

  function scopedQuery(query, view) {
    query = query.eq("company_id", companyId).eq("user_id", userId);
    if (actionOnly || view === "Action Required") query = query.eq("severity", "Action Required");
    if (view === "Unread") query = query.eq("is_read", false);
    if (["Mentions", "Projects", "Financial"].includes(view)) query = query.eq("category", view);
    return query;
  }

  const { data: unreadCount = 0, isError: countError } = useQuery({
    queryKey: [...scope, "count", actionOnly, profile?.role], enabled, refetchInterval: 60000,
    queryFn: async () => {
      const { count, error } = await scopedQuery(supabase.from("notifications").select("id", { count: "exact", head: true }), "Unread");
      if (error) throw error;
      return count || 0;
    },
  });
  const feed = useQuery({
    queryKey: [...scope, "feed", actionOnly, profile?.role, filter, page], enabled: enabled && open,
    refetchInterval: 60000,
    queryFn: async () => {
      const { data, error } = await scopedQuery(supabase.from("notifications").select("*"), filter)
        .order("created_at", { ascending: false }).order("id", { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      if (error) throw error;
      return data || [];
    },
  });
  useEffect(() => {
    if (!enabled) return;
    const channel = supabase.channel(`notifications:${companyId}:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        () => qc.invalidateQueries({ queryKey: ["notifications", companyId, userId] })).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [companyId, userId, enabled, qc]);

  const invalidate = () => qc.invalidateQueries({ queryKey: scope });
  const markRead = useMutation({
    mutationFn: async (id) => {
      const { data, error } = await supabase.from("notifications").update({ is_read: true, status: "read" })
        .eq("company_id", companyId).eq("user_id", userId).eq("id", id).select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("This notification is no longer available.");
    },
    onSuccess: invalidate,
    onError: () => toast.error("Could not mark the notification read. Please retry."),
  });
  const markView = useMutation({
    mutationFn: async () => {
      const { error } = await scopedQuery(supabase.from("notifications").update({ is_read: true, status: "read" }), filter).eq("is_read", false);
      if (error) throw error;
    },
    onSuccess: () => { setPage(0); invalidate(); },
    onError: () => toast.error("Could not mark this view read. Please retry."),
  });
  const preference = useMutation({
    mutationFn: async (value) => {
      const { data, error } = await supabase.from("profiles").update({ notify_action_required_only: value })
        .eq("id", userId).eq("company_id", companyId).select("notify_action_required_only").single();
      if (error) throw error;
      return data.notify_action_required_only;
    },
    onSuccess: (value) => {
      qc.setQueryData(["profile", userId], (previous) => ({ ...previous, notify_action_required_only: value }));
      setPage(0); invalidate();
    },
    onError: () => toast.error("Could not save your notification preference."),
  });

  const notifications = feed.data || [];
  return (
    <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (value) { setPage(0); onCloseSidebar?.(); } }}>
      <DialogTrigger asChild>
        <button type="button" aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}${countError ? ", unavailable" : ""}`}
          className="relative p-2 rounded-lg hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-blue-400">
          <Bell className="h-5 w-5 text-slate-400" />
          {unreadCount > 0 && <span className="absolute -top-0.5 -right-1 min-w-5 px-1 h-5 bg-red-600 text-white text-[10px] rounded-full flex items-center justify-center font-bold">{unreadCount > 99 ? "99+" : unreadCount}</span>}
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl bg-white p-0 overflow-hidden z-[100]" aria-describedby="notification-description">
        <DialogHeader className="p-4 pr-12 border-b bg-slate-50">
          <div className="flex flex-wrap gap-2 items-center justify-between">
            <DialogTitle className="text-lg font-bold text-slate-900">Notifications</DialogTitle>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" disabled={markView.isPending || !notifications.some(n => !n.is_read)} onClick={() => markView.mutate()} className="text-xs text-blue-700">Mark this view read</Button>
              <Button variant="ghost" size="icon" aria-label="Notification settings" aria-expanded={showSettings} onClick={() => setShowSettings(v => !v)} className="h-8 w-8"><Settings className="h-4 w-4" /></Button>
            </div>
          </div>
          <p id="notification-description" className="text-xs text-slate-500">Updates for your role and assigned work.{actionOnly ? " Showing action required only." : ""}</p>
        </DialogHeader>
        {showSettings && <div className="p-4 border-b bg-slate-50">
          <label className="flex items-start justify-between gap-4 text-sm">
            <span><span className="block font-semibold">Notify me only when action is required</span><span className="block text-xs text-slate-500 mt-1">Hide Important and FYI updates. Turn this off to see them again.</span></span>
            <input type="checkbox" checked={actionOnly} disabled={preference.isPending} onChange={e => preference.mutate(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-blue-600" />
          </label>
        </div>}
        <div className="flex overflow-x-auto gap-2 p-3 border-b" aria-label="Notification filters">
          {FILTERS.map(value => <button type="button" key={value} aria-pressed={filter === value} onClick={() => { setFilter(value); setPage(0); }}
            className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-semibold focus-visible:ring-2 focus-visible:ring-blue-400 ${filter === value ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
            {value}{value === "Unread" && unreadCount > 0 ? ` (${unreadCount})` : ""}
          </button>)}
        </div>
        <div className="max-h-[55vh] overflow-y-auto" aria-live="polite" aria-busy={feed.isFetching}>
          {feed.isPending ? <div className="py-12 flex justify-center" role="status"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /><span className="sr-only">Loading notifications</span></div>
            : feed.isError ? <div className="p-8 text-center text-sm text-slate-600"><p role="alert">Could not load your notifications.</p><Button variant="outline" className="mt-3" onClick={() => feed.refetch()}>Retry</Button></div>
            : !notifications.length ? <div className="text-center py-12 px-4"><Bell className="h-9 w-9 text-slate-300 mx-auto mb-3" /><p className="text-sm text-slate-600">No {filter.toLowerCase()} notifications to show.</p>{actionOnly && <p className="text-xs text-slate-500 mt-2">Your action-only preference is on.</p>}</div>
            : <ul className="divide-y divide-slate-100">{notifications.map(n => {
              const Icon = ICONS[n.category] || AlertCircle;
              const priority = PRIORITIES[n.severity] ? n.severity : "FYI";
              const link = notificationLink(n, profile?.role);
              const created = new Date(n.created_at);
              return <li key={n.id} className={n.is_read ? "bg-slate-50/50" : "bg-white"}>
                <button type="button" className="w-full p-4 text-left flex gap-3 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
                  onClick={() => { if (!n.is_read) markRead.mutate(n.id); if (link) { setOpen(false); navigate(link); } }}>
                  <div className={`h-9 w-9 shrink-0 rounded-full flex items-center justify-center ${n.is_read ? "bg-slate-100 text-slate-400" : "bg-blue-50 text-blue-600"}`}><Icon className="h-4 w-4" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex gap-2 items-start"><p className="font-semibold text-sm text-slate-900 flex-1">{n.title || "Activity update"}</p>{!n.is_read && <span className="h-2 w-2 mt-1.5 rounded-full bg-blue-600 shrink-0" aria-label="Unread" />}</div>
                    <p className="text-sm text-slate-600 whitespace-pre-wrap break-words mt-1">{n.body}</p>
                    <div className="flex flex-wrap gap-2 items-center mt-2 text-[10px]">
                      <span className={`px-2 py-0.5 rounded-full border font-semibold ${PRIORITIES[priority]}`}>{priority}</span>
                      <span className="text-slate-500">{n.category || "System"}</span>
                      <time className="text-slate-400" dateTime={isValid(created) ? created.toISOString() : undefined}>{isValid(created) ? formatDistanceToNow(created, { addSuffix: true }) : ""}</time>
                      {link && <span className="text-blue-700 ml-auto">Open →</span>}
                    </div>
                  </div>
                </button>
              </li>;
            })}</ul>}
        </div>
        {(page > 0 || notifications.length === PAGE_SIZE) && <div className="flex justify-between items-center px-4 py-3 border-t text-xs text-slate-500">
          <Button variant="outline" size="sm" disabled={page === 0 || feed.isFetching} onClick={() => setPage(p => p - 1)}>Previous</Button>
          <span>Page {page + 1}</span>
          <Button variant="outline" size="sm" disabled={notifications.length < PAGE_SIZE || feed.isFetching} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>}
      </DialogContent>
    </Dialog>
  );
}