import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, CheckCircle2, XCircle, Calendar } from "lucide-react";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { toast } from "sonner";

const STATUS_COLORS = { Pending: "bg-amber-100 text-amber-700", Approved: "bg-green-100 text-green-700", Rejected: "bg-red-100 text-red-700" };
const TYPE_ICONS = { Vacation: "🌴", "Sick Day": "🤒", "Personal Day": "🏠", "Unpaid Leave": "📋" };

export default function EPTimeOff({ currentUser, profile, isAdmin, eligibleUsers = [] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ type: "Vacation", start_date: "", end_date: "", reason: "" });

  const { data: requests = [] } = useQuery({
    queryKey: ["timeoff", isAdmin ? "all" : currentUser?.email],
    queryFn: () => isAdmin ? base44.entities.TimeOffRequest.list("-start_date") : base44.entities.TimeOffRequest.filter({ user_email: currentUser.email }),
    enabled: !!currentUser,
  });
  const allUsers = eligibleUsers;

  const createMutation = useMutation({
    mutationFn: (d) => base44.entities.TimeOffRequest.create(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["timeoff"] }); setOpen(false); toast.success("Request submitted!"); },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.TimeOffRequest.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["timeoff"] }); toast.success("Updated"); },
  });

  const calcDays = (s, e) => {
    if (!s || !e) return 0;
    return Math.max(1, differenceInCalendarDays(parseISO(e), parseISO(s)) + 1);
  };

  const vacRemaining = profile ? (profile.vacation_days_total || 0) - (profile.vacation_days_used || 0) : null;
  const sickRemaining = profile ? (profile.sick_days_total || 0) - (profile.sick_days_used || 0) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-slate-900">Time Off Requests</h3>
        <Button size="sm" className="bg-slate-900 hover:bg-slate-800" onClick={() => setOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Request
        </Button>
      </div>

      {!isAdmin && profile && (
        <div className="grid grid-cols-2 gap-3">
          <Card className="border-green-200 bg-green-50">
            <CardContent className="p-3 text-center">
              <p className="text-2xl font-bold text-green-700">{vacRemaining ?? "—"}</p>
              <p className="text-xs text-green-600">Vacation days left</p>
            </CardContent>
          </Card>
          <Card className="border-blue-200 bg-blue-50">
            <CardContent className="p-3 text-center">
              <p className="text-2xl font-bold text-blue-700">{sickRemaining ?? "—"}</p>
              <p className="text-xs text-blue-600">Sick days left</p>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="space-y-3">
        {requests.length === 0 && <p className="text-center text-slate-400 text-sm py-8">No requests yet.</p>}
        {requests.map(req => {
          const user = allUsers.find(u => u.email === req.user_email);
          const days = calcDays(req.start_date, req.end_date);
          return (
            <Card key={req.id} className="border-slate-200">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-base">{TYPE_ICONS[req.type]}</span>
                      <span className="font-semibold text-slate-900 text-sm">{req.type}</span>
                      <Badge className={`text-[10px] ${STATUS_COLORS[req.status]}`}>{req.status}</Badge>
                      {isAdmin && user && <span className="text-xs text-slate-400">· {user.full_name}</span>}
                    </div>
                    <p className="text-xs text-slate-500">{req.start_date} → {req.end_date} <span className="text-slate-400">({days} day{days !== 1 ? "s" : ""})</span></p>
                    {req.reason && <p className="text-xs text-slate-600 mt-1 italic">{req.reason}</p>}
                    {req.admin_notes && <p className="text-xs text-red-600 mt-1">Admin: {req.admin_notes}</p>}
                  </div>
                </div>
                {isAdmin && req.status === "Pending" && (
                  <div className="flex gap-2 mt-3 pt-3 border-t border-slate-100">
                    <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white flex-1"
                      onClick={() => updateMutation.mutate({ id: req.id, data: { status: "Approved" } })}>
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve
                    </Button>
                    <Button size="sm" variant="outline" className="text-red-600 border-red-200 flex-1"
                      onClick={() => updateMutation.mutate({ id: req.id, data: { status: "Rejected" } })}>
                      <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Request Time Off</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><label className="text-xs font-medium text-slate-700">Type</label>
              <Select value={form.type} onValueChange={v => setForm({ ...form, type: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{["Vacation", "Sick Day", "Personal Day", "Unpaid Leave"].map(t => <SelectItem key={t} value={t}>{TYPE_ICONS[t]} {t}</SelectItem>)}</SelectContent>
              </Select></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-medium text-slate-700">Start Date</label>
                <Input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} className="mt-1" /></div>
              <div><label className="text-xs font-medium text-slate-700">End Date</label>
                <Input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} className="mt-1" /></div>
            </div>
            {form.start_date && form.end_date && (
              <p className="text-xs text-slate-500 text-center bg-slate-50 rounded-lg py-2">
                {calcDays(form.start_date, form.end_date)} day{calcDays(form.start_date, form.end_date) !== 1 ? "s" : ""}
              </p>
            )}
            <div><label className="text-xs font-medium text-slate-700">Reason (optional)</label>
              <Textarea value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} rows={2} className="mt-1" /></div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setOpen(false)}>Cancel</Button>
              <Button className="flex-1 bg-slate-900 hover:bg-slate-800"
                onClick={() => createMutation.mutate({ ...form, user_email: currentUser.email, total_days: calcDays(form.start_date, form.end_date), status: "Pending" })}
                disabled={!form.start_date || !form.end_date || createMutation.isPending}>
                {createMutation.isPending ? "Saving..." : "Submit"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}