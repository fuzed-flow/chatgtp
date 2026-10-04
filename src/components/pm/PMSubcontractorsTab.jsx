import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Plus, Trash2, Building2, Phone, Mail, ShieldCheck, Send, CheckCircle2, Paperclip, X, FileText, HardHat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

const TRADES = ["Framing","Electrical","Plumbing","HVAC","Drywall","Flooring","Painting","Cabinets","Concrete","Roofing","Windows/Doors","Landscaping","Other"];
const ASSIGNMENT_STATUSES = ["Proposed","Approved","Scheduled","On Site","Completed","Removed"];

export default function PMSubcontractorsTab({ project }) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const companyId = profile?.company_id;

  const [subTab, setSubTab] = useState("assigned");
  const [assignOpen, setAssignOpen] = useState(false);
  const [newSubOpen, setNewSubOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteSub, setInviteSub] = useState(null);
  const [inviteMsg, setInviteMsg] = useState("");
  const [inviteAttachments, setInviteAttachments] = useState([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteSent, setInviteSent] = useState(false);
  
  const [assignForm, setAssignForm] = useState({ subcontractor_id: "", phase_id: "none", status: "Proposed", scheduled_start: "", scheduled_end: "", agreed_amount: "", role_notes: "" });
  const [subForm, setSubForm] = useState({ company_name: "", trade: "Other", contact_name: "", phone: "", email: "", wcb_policy: "", insurance_expiry: "", notes: "", is_active: true });

  // --- SUPABASE QUERIES ---
  const { data: phases = [] } = useQuery({ 
    queryKey: ["pm_phases", project?.id], 
    enabled: !!project?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from("project_phases").select("*").eq("project_id", project.id);
      if (error) throw error;
      return data || [];
    } 
  });

  const { data: allSubs = [] } = useQuery({ 
    queryKey: ["subcontractors", companyId], 
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("subcontractors").select("*").eq("company_id", companyId);
      if (error) throw error;
      return data || [];
    } 
  });
  
  const { data: vendors = [] } = useQuery({ 
    queryKey: ["vendors", companyId], 
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("vendors").select("*").eq("company_id", companyId);
      if (error && error.code !== '42P01') throw error; // Ignore if table doesn't exist yet
      return data || [];
    } 
  });
  
  const { data: assignments = [] } = useQuery({ 
    queryKey: ["pm_proj_subs", project?.id], 
    enabled: !!project?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from("project_subcontractors").select("*").eq("project_id", project.id);
      if (error) throw error;
      return data || [];
    } 
  });

  // Merged list: vendors first (main file), then any PM-only subs not already covered
  const vendorIds = new Set(vendors.map(v => v.id));
  const mergedSubs = [
    ...vendors.map(v => ({ id: v.id, company_name: v.name, trade: v.category || "Other", contact_name: v.contact_name, phone: v.phone, email: v.email, insurance_expiry: v.insurance_expiry, wcb_policy: v.wcb_policy, _source: "vendor" })),
    ...allSubs.filter(s => !vendorIds.has(s.id)).map(s => ({ ...s, _source: "pm" }))
  ];

  const subMap = Object.fromEntries(mergedSubs.map(s => [s.id, s]));
  const phaseMap = Object.fromEntries(phases.map(p => [p.id, p.name]));

  // --- SUPABASE MUTATIONS ---
  const createSub = useMutation({ 
    mutationFn: async (d) => {
      const payload = { ...d, company_id: companyId };
      if (!payload.insurance_expiry) payload.insurance_expiry = null;
      const { error } = await supabase.from("subcontractors").insert([payload]);
      if (error) throw error;
    }, 
    onSuccess: () => { 
      qc.invalidateQueries({ queryKey: ["subcontractors"] }); 
      setNewSubOpen(false); 
      setSubForm({ company_name: "", trade: "Other", contact_name: "", phone: "", email: "", wcb_policy: "", insurance_expiry: "", notes: "", is_active: true }); 
      toast.success("Subcontractor created");
    } 
  });
  
  const createAssignment = useMutation({ 
    mutationFn: async (d) => {
      const payload = { ...d, company_id: companyId, project_id: project.id };
      if (!payload.scheduled_start) payload.scheduled_start = null;
      if (!payload.scheduled_end) payload.scheduled_end = null;
      if (payload.phase_id === "none") payload.phase_id = null;
      const { error } = await supabase.from("project_subcontractors").insert([payload]);
      if (error) throw error;
    }, 
    onSuccess: () => { 
      qc.invalidateQueries({ queryKey: ["pm_proj_subs", project.id] }); 
      setAssignOpen(false); 
      setAssignForm({ subcontractor_id: "", phase_id: "none", status: "Proposed", scheduled_start: "", scheduled_end: "", agreed_amount: "", role_notes: "" }); 
      toast.success("Subcontractor assigned");
    } 
  });
  
  const updateAssignment = useMutation({ 
    mutationFn: async ({ id, data }) => {
      const { error } = await supabase.from("project_subcontractors").update(data).eq("id", id);
      if (error) throw error;
    }, 
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pm_proj_subs", project.id] }) 
  });
  
  const deleteAssignment = useMutation({ 
    mutationFn: async (id) => {
      const { error } = await supabase.from("project_subcontractors").delete().eq("id", id);
      if (error) throw error;
    }, 
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pm_proj_subs", project.id] });
      toast.success("Assignment removed");
    }
  });

  const openInvite = (sub) => {
    setInviteSub(sub);
    setInviteMsg(`We are currently preparing for an upcoming project and would like to invite you to provide a quote for your scope of work.\n\nProject Details:\nLocation: ${project.site_address || "TBD"}\nScope: ${project.name}\nTimeline: \nDrawings/Scope: Available through Contractor Portal link\n\nPlease let me know if you're available and interested, all relevant information for the project is available in the Contractor Portal link attached.`);
    setInviteAttachments([]);
    setInviteSent(false);
    setInviteOpen(true);
  };

  const handleAttachFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingFile(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setInviteAttachments(prev => [...prev, { name: file.name, url: file_url }]);
    } catch (err) {
      toast.error("Failed to upload file");
    } finally {
      setUploadingFile(false);
      e.target.value = "";
    }
  };

  const sendInvite = async () => {
    if (!inviteSub?.email) return;
    setInviteSending(true);
    try {
      const portalUrl = `${window.location.origin}/ContractorPortal?projectId=${project.id}`;
      let attachmentSection = "";
      if (inviteAttachments.length > 0) {
        attachmentSection = `<br/><br/><strong>Attached Documents:</strong><br/>${inviteAttachments.map(a => `<a href="${a.url}">${a.name}</a>`).join("<br/>")}`;
      }
      const htmlBody = `
<p>Hi ${inviteSub.contact_name || inviteSub.company_name},</p>
<p>I hope you're doing well.</p>
<p>${inviteMsg.replace(/\n/g, '<br/>')}</p>
${attachmentSection}
<br/>
<p><strong>Contractor Portal:</strong> <a href="${portalUrl}">${portalUrl}</a></p>
<br/>
<p>Best regards,</p>
      `;
      
      // Preserved custom email integration
      await base44.integrations.Core.SendEmail({
        to: inviteSub.email,
        subject: `Quote Request — ${project.name}`,
        body: htmlBody,
      });
      
      const alreadyAssigned = assignments.some(a => a.subcontractor_id === inviteSub.id);
      if (!alreadyAssigned) {
        await supabase.from("project_subcontractors").insert([{
          company_id: companyId,
          project_id: project.id,
          subcontractor_id: inviteSub.id,
          status: "Proposed",
          role_notes: "Invited to quote",
        }]);
        qc.invalidateQueries({ queryKey: ["pm_proj_subs", project.id] });
      }
      setInviteSent(true);
    } catch (err) {
      toast.error("Failed to send invite email");
    } finally {
      setInviteSending(false);
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <Tabs value={subTab} onValueChange={setSubTab}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
          <TabsList className="bg-slate-100/50">
            <TabsTrigger value="assigned">Assigned ({assignments.length})</TabsTrigger>
            <TabsTrigger value="directory">Directory ({mergedSubs.length})</TabsTrigger>
          </TabsList>
          <div className="flex gap-2 shrink-0">
            {subTab === "assigned" && <Button size="sm" className="bg-slate-900 hover:bg-slate-800 text-white" onClick={() => setAssignOpen(true)}><Plus className="h-4 w-4 mr-1.5" /> Assign Sub</Button>}
            {subTab === "directory" && <Button size="sm" className="bg-slate-900 hover:bg-slate-800 text-white" onClick={() => setNewSubOpen(true)}><Plus className="h-4 w-4 mr-1.5" /> New Sub</Button>}
          </div>
        </div>

        <TabsContent value="assigned" className="mt-0">
          <div className="space-y-3">
            {assignments.map(a => {
              const sub = subMap[a.subcontractor_id];
              return (
                <Card key={a.id} className="shadow-sm border-slate-200">
                  <CardContent className="p-4 flex flex-col md:flex-row items-start gap-4">
                    
                    <div className="flex-1 min-w-0 w-full">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <HardHat className="h-4 w-4 text-amber-500 shrink-0" />
                        <span className="font-bold text-slate-900 text-base">{sub?.company_name || "Unknown Company"}</span>
                        <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">{sub?.trade || "Trade"}</span>
                        {a.phase_id && <span className="text-xs text-slate-500 border border-slate-200 px-1.5 py-0.5 rounded">Phase: {phaseMap[a.phase_id]}</span>}
                      </div>
                      
                      {a.role_notes && <p className="text-xs text-slate-500 mb-3 ml-6">{a.role_notes}</p>}
                      
                      <div className="flex gap-4 text-xs font-medium text-slate-500 flex-wrap ml-6">
                        {a.scheduled_start && <span>Start: <span className="text-slate-700">{a.scheduled_start}</span></span>}
                        {a.scheduled_end && <span>End: <span className="text-slate-700">{a.scheduled_end}</span></span>}
                        {a.agreed_amount != null && <span className="font-bold text-emerald-600">${Number(a.agreed_amount).toLocaleString()}</span>}
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2 w-full md:w-auto md:justify-end ml-6 md:ml-0 border-t md:border-t-0 border-slate-100 pt-3 md:pt-0">
                      <Select value={a.status} onValueChange={v => {
                        updateAssignment.mutate({ id: a.id, data: { status: v } });
                        toast.success("Status updated");
                      }}>
                        <SelectTrigger className={`w-36 h-8 text-xs font-semibold ${a.status === 'Scheduled' || a.status === 'On Site' ? 'bg-amber-50 text-amber-700 border-amber-200' : a.status === 'Completed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-white'}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>{ASSIGNMENT_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                      </Select>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-slate-400 hover:bg-red-50 hover:text-red-600 shrink-0" onClick={() => {
                        if(window.confirm("Remove this subcontractor from the project?")) {
                          deleteAssignment.mutate(a.id);
                        }
                      }}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            
            {assignments.length === 0 && (
              <div className="text-center bg-white border border-slate-200 border-dashed rounded-xl py-12 shadow-sm">
                <HardHat className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                <p className="text-sm font-medium text-slate-600 mb-1">No subcontractors assigned</p>
                <p className="text-xs text-slate-400 mb-4">Assign subs from your directory to track schedules and costs.</p>
                <Button size="sm" variant="outline" onClick={() => setAssignOpen(true)}>Assign Subcontractor</Button>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="directory" className="mt-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {mergedSubs.map(s => (
              <Card key={s.id} className="shadow-sm border-slate-200">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-start gap-2">
                      <Building2 className="h-4 w-4 text-slate-400 mt-1 shrink-0" />
                      <div>
                        <p className="font-bold text-slate-900">{s.company_name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">{s.trade}</span>
                          {s._source === "vendor" && <span className="text-[10px] text-blue-500 border border-blue-200 bg-blue-50 px-1.5 py-0.5 rounded">Vendor File</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="space-y-1.5 pl-6">
                    {s.contact_name && <p className="text-xs font-medium text-slate-700">{s.contact_name}</p>}
                    {s.phone && <span className="flex items-center gap-1.5 text-xs text-slate-500"><Phone className="h-3.5 w-3.5" />{s.phone}</span>}
                    {s.email && <span className="flex items-center gap-1.5 text-xs text-slate-500"><Mail className="h-3.5 w-3.5" />{s.email}</span>}
                    {s.insurance_expiry && <p className="text-xs text-slate-400 pt-1 flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" />Ins. exp: <span className="font-medium">{s.insurance_expiry}</span></p>}
                  </div>
                  
                  <div className="mt-4 pt-4 border-t border-slate-100">
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full text-xs"
                      disabled={!s.email}
                      onClick={() => openInvite(s)}
                      title={!s.email ? "No email on file" : "Send quote invitation"}
                    >
                      <Send className="h-3.5 w-3.5 mr-1.5" /> Invite to Quote
                    </Button>
                    {!s.email && <p className="text-[10px] text-slate-400 text-center mt-1">Add email to enable invitations</p>}
                  </div>
                </CardContent>
              </Card>
            ))}
            
            {mergedSubs.length === 0 && <p className="text-center text-slate-400 py-8 col-span-1 md:col-span-2">No subcontractors in directory yet.</p>}
          </div>
        </TabsContent>
      </Tabs>

      {/* Invite to Quote Dialog */}
      <Dialog open={inviteOpen} onOpenChange={v => { setInviteOpen(v); if (!v) setInviteSent(false); }}>
        <DialogContent aria-describedby={undefined} className="max-w-lg">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Send className="h-5 w-5 text-blue-500" /> Invite to Quote</DialogTitle></DialogHeader>
          {inviteSent ? (
            <div className="flex flex-col items-center py-6 gap-3">
              <CheckCircle2 className="h-12 w-12 text-emerald-500" />
              <p className="font-bold text-slate-800 text-lg">Invitation Sent!</p>
              <p className="text-sm text-slate-500 text-center px-4">An email with the portal link has been sent to <strong>{inviteSub?.email}</strong>.</p>
              <Button className="mt-2 bg-slate-900" onClick={() => setInviteOpen(false)}>Done</Button>
            </div>
          ) : (
            <div className="space-y-4 pt-2">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm">
                <p className="font-bold text-slate-800">{inviteSub?.company_name}</p>
                <p className="text-slate-500 text-xs mt-0.5">{inviteSub?.email}</p>
              </div>
              <div>
                <Label>Email Message</Label>
                <textarea
                  className="mt-1 flex min-h-[160px] w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 shadow-sm"
                  value={inviteMsg}
                  onChange={e => setInviteMsg(e.target.value)}
                />
              </div>
              <div>
                <Label className="flex items-center gap-1"><Paperclip className="h-3.5 w-3.5" /> Attachments</Label>
                <label className="mt-1 flex items-center justify-center gap-2 cursor-pointer px-3 py-3 border border-dashed border-slate-300 rounded-md hover:bg-slate-50 text-sm font-medium text-slate-500 transition-colors">
                  <input type="file" className="hidden" onChange={handleAttachFile} disabled={uploadingFile} />
                  {uploadingFile ? "Uploading..." : "Click to attach a document (Plans, Scope, etc.)"}
                </label>
                {inviteAttachments.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {inviteAttachments.map((att, i) => (
                      <div key={i} className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-xs shadow-sm">
                        <span className="flex items-center gap-1.5 text-slate-700 font-medium truncate"><FileText className="h-3.5 w-3.5 shrink-0 text-blue-500" />{att.name}</span>
                        <button onClick={() => setInviteAttachments(prev => prev.filter((_, idx) => idx !== i))} className="ml-2 text-slate-400 hover:text-red-500"><X className="h-4 w-4" /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
                <Button className="bg-amber-500 hover:bg-amber-600 text-slate-900" disabled={inviteSending || !inviteMsg} onClick={sendInvite}>
                  {inviteSending ? "Sending..." : <><Send className="h-3.5 w-3.5 mr-1.5" /> Send Invitation</>}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Assign Dialog */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent aria-describedby={undefined}><DialogHeader><DialogTitle>Assign Subcontractor</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label>Subcontractor *</Label>
              <Select value={assignForm.subcontractor_id} onValueChange={v => setAssignForm({...assignForm, subcontractor_id: v})}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select from directory..." /></SelectTrigger>
                <SelectContent>
                  {mergedSubs.length === 0 && <div className="px-3 py-4 text-sm text-slate-400 text-center">No subcontractors on file yet.</div>}
                  {[...new Set(mergedSubs.map(s => s.trade || "Other"))].sort().map(trade => {
                    const tradeSubs = mergedSubs.filter(s => (s.trade || "Other") === trade);
                    return (
                      <React.Fragment key={trade}>
                        <div className="px-2 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 border-y border-slate-100">{trade}</div>
                        {tradeSubs.map(s => (
                          <SelectItem key={s.id} value={s.id} className="pl-4">
                            {s.company_name}{s.contact_name ? ` · ${s.contact_name}` : ""}
                          </SelectItem>
                        ))}
                      </React.Fragment>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Phase</Label>
                <Select value={assignForm.phase_id || "none"} onValueChange={v => setAssignForm({...assignForm, phase_id: v === "none" ? null : v})}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Optional" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— General / Unassigned —</SelectItem>
                    {phases.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={assignForm.status} onValueChange={v => setAssignForm({...assignForm, status: v})}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{ASSIGNMENT_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div><Label>Scheduled Start</Label><Input type="date" className="mt-1 w-full" value={assignForm.scheduled_start} onChange={e => setAssignForm({...assignForm, scheduled_start: e.target.value})} /></div>
              <div><Label>Scheduled End</Label><Input type="date" className="mt-1 w-full" value={assignForm.scheduled_end} onChange={e => setAssignForm({...assignForm, scheduled_end: e.target.value})} /></div>
            </div>
            
            <div>
              <Label>Agreed Amount ($)</Label>
              <div className="relative mt-1">
                <span className="absolute left-3 top-2.5 text-slate-500 text-sm">$</span>
                <Input type="number" className="pl-7" value={assignForm.agreed_amount} onChange={e => setAssignForm({...assignForm, agreed_amount: e.target.value})} placeholder="0.00" />
              </div>
            </div>
            
            <div><Label>Role Notes</Label><Textarea className="mt-1" rows={2} value={assignForm.role_notes} onChange={e => setAssignForm({...assignForm, role_notes: e.target.value})} placeholder="Scope of work details..." /></div>
            
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setAssignOpen(false)}>Cancel</Button>
              <Button className="bg-slate-900 hover:bg-slate-800 text-white" disabled={!assignForm.subcontractor_id || createAssignment.isPending} onClick={() => createAssignment.mutate({ ...assignForm, agreed_amount: assignForm.agreed_amount ? Number(assignForm.agreed_amount) : null })}>
                {createAssignment.isPending ? "Assigning..." : "Assign Subcontractor"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* New Sub Dialog */}
      <Dialog open={newSubOpen} onOpenChange={setNewSubOpen}>
        <DialogContent aria-describedby={undefined} className="max-h-[90vh] overflow-y-auto max-w-md"><DialogHeader><DialogTitle>Add to Directory</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div><Label>Company Name *</Label><Input className="mt-1" value={subForm.company_name} onChange={e => setSubForm({...subForm, company_name: e.target.value})} placeholder="Subcontractor Inc." /></div>
            <div>
              <Label>Trade Focus</Label>
              <Select value={subForm.trade} onValueChange={v => setSubForm({...subForm, trade: v})}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{TRADES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Primary Contact Name</Label><Input className="mt-1" value={subForm.contact_name} onChange={e => setSubForm({...subForm, contact_name: e.target.value})} placeholder="John Doe" /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Phone</Label><Input className="mt-1" value={subForm.phone} onChange={e => setSubForm({...subForm, phone: e.target.value})} placeholder="(555) 123-4567" /></div>
              <div><Label>Email</Label><Input type="email" className="mt-1" value={subForm.email} onChange={e => setSubForm({...subForm, email: e.target.value})} placeholder="john@sub.com" /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>WCB / Safety Policy</Label><Input className="mt-1" value={subForm.wcb_policy} onChange={e => setSubForm({...subForm, wcb_policy: e.target.value})} /></div>
              <div><Label>Insurance Expiry</Label><Input type="date" className="mt-1 w-full" value={subForm.insurance_expiry || ""} onChange={e => setSubForm({...subForm, insurance_expiry: e.target.value})} /></div>
            </div>
            <div><Label>Internal Notes</Label><Textarea className="mt-1" rows={2} value={subForm.notes} onChange={e => setSubForm({...subForm, notes: e.target.value})} placeholder="Quality of work, payment terms, etc." /></div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <Button variant="outline" onClick={() => setNewSubOpen(false)}>Cancel</Button>
              <Button className="bg-slate-900 hover:bg-slate-800 text-white" disabled={!subForm.company_name || createSub.isPending} onClick={() => createSub.mutate(subForm)}>
                {createSub.isPending ? "Saving..." : "Add to Directory"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
