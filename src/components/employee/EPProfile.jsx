import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Edit2, Save, X, User, Phone, Mail, MapPin, Calendar, Briefcase, Heart } from "lucide-react";
import { toast } from "sonner";

export default function EPProfile({ currentUser, profile, isAdmin }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);

  const startEdit = () => {
    setForm({ ...profile });
    setEditing(true);
  };

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.EmployeeProfile.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ep_profile"] }); setEditing(false); toast.success("Profile updated!"); },
  });

  const createMutation = useMutation({
    mutationFn: (d) => base44.entities.EmployeeProfile.create(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ep_profile"] }); setEditing(false); toast.success("Profile created!"); },
  });

  const handleSave = () => {
    if (profile?.id) {
      updateMutation.mutate({ id: profile.id, data: form });
    } else {
      createMutation.mutate({ ...form, user_id: currentUser.id, user_email: currentUser.email, employee_name: currentUser.full_name });
    }
  };

  if (!profile && !isAdmin) {
    return (
      <div className="text-center py-12">
        <User className="h-12 w-12 mx-auto text-slate-300 mb-3" />
        <p className="text-slate-500 text-sm mb-4">Your employee profile hasn't been set up yet.</p>
        <Button className="bg-slate-900 hover:bg-slate-800" onClick={() => { setForm({ position: "", phone: "", address: "" }); setEditing(true); }}>
          Set Up Profile
        </Button>
        {editing && form && (
          <div className="mt-6 text-left space-y-3 max-w-sm mx-auto">
            <div><label className="text-xs font-medium text-slate-700">Position</label>
              <Input value={form.position || ""} onChange={e => setForm({ ...form, position: e.target.value })} className="mt-1" /></div>
            <div><label className="text-xs font-medium text-slate-700">Phone</label>
              <Input value={form.phone || ""} onChange={e => setForm({ ...form, phone: e.target.value })} className="mt-1" /></div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setEditing(false)}>Cancel</Button>
              <Button className="flex-1 bg-slate-900 hover:bg-slate-800" onClick={handleSave}>Save</Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (!profile) return <p className="text-center text-slate-400 text-sm py-8">No profile found.</p>;

  const fields = [
    { icon: Briefcase, label: "Position", value: profile.position },
    { icon: Briefcase, label: "Trade / Role", value: profile.role_trade },
    { icon: Phone, label: "Phone", value: profile.phone },
    { icon: Mail, label: "Email", value: profile.email || currentUser?.email },
    { icon: MapPin, label: "Address", value: profile.address },
    { icon: Calendar, label: "Hire Date", value: profile.hire_date },
    { icon: Briefcase, label: "Pay Type", value: profile.pay_type },
    { icon: Briefcase, label: "Employment Status", value: profile.employment_status },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-slate-900">My Profile</h3>
        {!editing && (
          <Button size="sm" variant="outline" onClick={startEdit}><Edit2 className="h-3.5 w-3.5 mr-1" /> Edit</Button>
        )}
      </div>

      {/* Avatar / Header */}
      <Card className="border-slate-200 bg-gradient-to-r from-slate-900 to-slate-800 text-white">
        <CardContent className="p-5 flex items-center gap-4">
          <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shrink-0 shadow-lg">
            <span className="text-2xl font-bold text-slate-900">{profile.employee_name?.charAt(0)?.toUpperCase()}</span>
          </div>
          <div>
            <h2 className="text-lg font-bold">{profile.employee_name}</h2>
            <p className="text-amber-400 text-sm">{profile.position || "—"}</p>
            {profile.employment_status && (
              <Badge className={`text-[10px] mt-1 ${profile.employment_status === "Active" ? "bg-green-500/20 text-green-300" : "bg-slate-600 text-slate-300"}`}>
                {profile.employment_status}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {editing && form ? (
        <Card className="border-slate-200">
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-medium text-slate-700">Position</label>
                <Input value={form.position || ""} onChange={e => setForm({ ...form, position: e.target.value })} className="mt-1" /></div>
              <div><label className="text-xs font-medium text-slate-700">Trade / Role</label>
                <Input value={form.role_trade || ""} onChange={e => setForm({ ...form, role_trade: e.target.value })} className="mt-1" /></div>
              <div><label className="text-xs font-medium text-slate-700">Phone</label>
                <Input value={form.phone || ""} onChange={e => setForm({ ...form, phone: e.target.value })} className="mt-1" /></div>
              <div><label className="text-xs font-medium text-slate-700">Pay Type</label>
                <Select value={form.pay_type || "Hourly"} onValueChange={v => setForm({ ...form, pay_type: v })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{["Hourly", "Salary", "Contract"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select></div>
            </div>
            <div><label className="text-xs font-medium text-slate-700">Address</label>
              <Input value={form.address || ""} onChange={e => setForm({ ...form, address: e.target.value })} className="mt-1" /></div>
            <div className="border-t border-slate-100 pt-3">
              <p className="text-xs font-semibold text-slate-500 mb-2">Emergency Contact</p>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-slate-600">Name</label>
                  <Input value={form.emergency_contact_name || ""} onChange={e => setForm({ ...form, emergency_contact_name: e.target.value })} className="mt-1" /></div>
                <div><label className="text-xs text-slate-600">Phone</label>
                  <Input value={form.emergency_contact_phone || ""} onChange={e => setForm({ ...form, emergency_contact_phone: e.target.value })} className="mt-1" /></div>
                <div><label className="text-xs text-slate-600">Relation</label>
                  <Input value={form.emergency_contact_relation || ""} onChange={e => setForm({ ...form, emergency_contact_relation: e.target.value })} className="mt-1" /></div>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setEditing(false)}><X className="h-3.5 w-3.5 mr-1" />Cancel</Button>
              <Button className="flex-1 bg-slate-900 hover:bg-slate-800" onClick={handleSave} disabled={updateMutation.isPending}>
                <Save className="h-3.5 w-3.5 mr-1" />{updateMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="border-slate-200">
            <CardContent className="p-4">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Info</p>
              <div className="space-y-2">
                {fields.map(f => f.value && (
                  <div key={f.label} className="flex items-center gap-3">
                    <f.icon className="h-4 w-4 text-slate-400 shrink-0" />
                    <div>
                      <p className="text-[10px] text-slate-400">{f.label}</p>
                      <p className="text-sm text-slate-800">{f.value}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {(profile.emergency_contact_name || profile.emergency_contact_phone) && (
            <Card className="border-red-100 bg-red-50">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Heart className="h-4 w-4 text-red-500" />
                  <p className="text-xs font-semibold text-red-700">Emergency Contact</p>
                </div>
                <p className="text-sm font-medium text-slate-900">{profile.emergency_contact_name}</p>
                {profile.emergency_contact_relation && <p className="text-xs text-slate-500">{profile.emergency_contact_relation}</p>}
                {profile.emergency_contact_phone && <p className="text-sm text-slate-700 mt-1">{profile.emergency_contact_phone}</p>}
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Card className="border-green-200 bg-green-50">
              <CardContent className="p-3 text-center">
                <p className="text-2xl font-bold text-green-700">{(profile.vacation_days_total || 0) - (profile.vacation_days_used || 0)}</p>
                <p className="text-xs text-green-600">Vacation days left</p>
              </CardContent>
            </Card>
            <Card className="border-blue-200 bg-blue-50">
              <CardContent className="p-3 text-center">
                <p className="text-2xl font-bold text-blue-700">{(profile.sick_days_total || 0) - (profile.sick_days_used || 0)}</p>
                <p className="text-xs text-blue-600">Sick days left</p>
              </CardContent>
            </Card>
          </div>

          {profile.skills?.length > 0 && (
            <Card className="border-slate-200">
              <CardContent className="p-4">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Skills</p>
                <div className="flex flex-wrap gap-2">
                  {profile.skills.map((s, i) => <Badge key={i} variant="outline" className="text-xs">{s}</Badge>)}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}