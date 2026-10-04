import React, { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient"; // NEW: Supabase!
import { useAuth } from "@/lib/AuthContext"; // NEW: Auth Hook!
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Mail, Phone, MessageSquare, Calendar, Send, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { format } from "date-fns";
import { communicationSendPayload, communicationText } from "@/lib/clientCommunications";

export default function CommunicationPanel({ clientId, leadId, clientEmail, clientPhone, clientName }) {
  const { profile } = useAuth();
  const companyId = profile?.company_id;
  const partyId = leadId || clientId;
  const partyColumn = leadId ? "lead_id" : "client_id";
  const party = { client_id: clientId || null, lead_id: leadId || null };

  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [logDialogOpen, setLogDialogOpen] = useState(false);
  const [reminderDialogOpen, setReminderDialogOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [replyId, setReplyId] = useState(null);
  const sendIntent = useRef(null);
  
  const [emailForm, setEmailForm] = useState({ subject: "", message: "" });
  const [logForm, setLogForm] = useState({ type: "Phone Call", subject: "", message: "" });
  const [reminderForm, setReminderForm] = useState({ title: "", description: "", due_date: "", priority: "Medium" });
  
  const queryClient = useQueryClient();

  const { data: replyStatus } = useQuery({
    queryKey: ['communication-reply-status', companyId], enabled: !!companyId, staleTime: 60000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('communication_reply_status');
      if (error) throw error;
      return data;
    },
  });

  // 1. FETCH COMMUNICATIONS FROM SUPABASE
  const { data: communications = [], isError: communicationsFailed } = useQuery({
    queryKey: ["client-communications", partyId, companyId],
    enabled: !!partyId && !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_communications")
        .select("*")
        .eq(partyColumn, partyId)
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // 2. FETCH REMINDERS FROM SUPABASE
  const { data: reminders = [] } = useQuery({
    queryKey: ["client-reminders", partyId, companyId],
    enabled: !!partyId && !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_reminders")
        .select("*")
        .eq(partyColumn, partyId)
        .eq("company_id", companyId)
        .order("due_date", { ascending: true }); // Earliest due dates first!
      if (error) throw error;
      return data;
    },
  });

  // 3. MUTATIONS
  const logCommunicationMutation = useMutation({
    mutationFn: async (data) => {
      const { error } = await supabase.from("client_communications").insert([{ ...data, company_id: companyId }]);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client-communications", partyId, companyId] });
      setLogDialogOpen(false);
      setLogForm({ type: "Phone Call", subject: "", message: "" });
      toast.success("Communication logged");
    },
    onError: error => toast.error(error.message || "Communication could not be logged")
  });

  const createReminderMutation = useMutation({
    mutationFn: async (data) => {
      const { error } = await supabase.from("client_reminders").insert([{ ...data, company_id: companyId, status: "Pending" }]);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client-reminders", partyId, companyId] });
      setReminderDialogOpen(false);
      setReminderForm({ title: "", description: "", due_date: "", priority: "Medium" });
      toast.success("Reminder created");
    },
    onError: error => toast.error(error.message || "Reminder could not be saved")
  });

  const updateReminderMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      const { error } = await supabase.from("client_reminders").update(data).eq("id", id).eq("company_id", companyId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["client-reminders", partyId, companyId] }),
    onError: error => toast.error(error.message || "Reminder could not be updated")
  });

  const markAnsweredMutation = useMutation({
    mutationFn: async id => {
      const { error } = await supabase.from("client_communications").update({ answered_at: new Date().toISOString(), answered_delivery_id: null }).eq("id", id).eq("company_id", companyId).eq(partyColumn, partyId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["client-communications", partyId, companyId] }),
    onError: error => toast.error(error.message || "Reply could not be marked handled")
  });

  // 4. SEND EMAIL VIA SUPABASE EDGE FUNCTIONS
  const handleSendEmail = async () => {
    if (!emailForm.subject || !emailForm.message) {
      toast.error("Please fill in all fields");
      return;
    }

    setSending(true);
    try {
      const signature = JSON.stringify([partyId, clientEmail, emailForm.subject, emailForm.message, replyId]);
      if (sendIntent.current?.signature !== signature) sendIntent.current = { signature, requestId: crypto.randomUUID() };
      const { data, error } = await supabase.functions.invoke('send-email', {
        body: communicationSendPayload({ clientId, leadId, recipient: clientEmail, subject: emailForm.subject,
          message: emailForm.message, requestId: sendIntent.current.requestId, replyId })
      });

      if (error) throw error;
      if (data?.success !== true) throw new Error(data?.error || "Email delivery could not be confirmed");
      sendIntent.current = null;

      toast.success(`Email sent successfully!`);
      setEmailDialogOpen(false);
      setEmailForm({ subject: "", message: "" });
      setReplyId(null);
      
      queryClient.invalidateQueries({ queryKey: ["client-communications", partyId, companyId] });

    } catch (error) {
      console.error("Email Error:", error);
      toast.error(error.message || "Email could not be sent. Your draft is still here.");
    } finally {
      setSending(false);
    }
  };

  const handleLogCommunication = () => {
    if (!logForm.subject) {
      toast.error("Please add a subject");
      return;
    }

    logCommunicationMutation.mutate({
      ...party,
      type: logForm.type,
      subject: logForm.subject,
      message: logForm.message,
      direction: "Outbound",
      status: "Sent",
      sent_by: profile?.full_name || "Unknown"
    });
  };

  const handleCreateReminder = () => {
    if (!reminderForm.title || !reminderForm.due_date) {
      toast.error("Please fill in required fields");
      return;
    }

    createReminderMutation.mutate({
      ...party,
      title: reminderForm.title,
      description: reminderForm.description,
      due_date: reminderForm.due_date,
      priority: reminderForm.priority,
      assigned_to: profile?.id // The actual Supabase UUID
    });
  };

  const typeIcons = {
    Email: Mail,
    "Phone Call": Phone,
    Meeting: Calendar,
    "Text Message": MessageSquare,
    Other: MessageSquare
  };

  return (
    <div className="space-y-6">
      {/* Action Buttons */}
      <div className="flex gap-2 flex-wrap">
        <Button onClick={() => { setReplyId(null); setEmailDialogOpen(true); }} disabled={!clientEmail} className="gap-2 bg-gradient-to-br from-amber-500 to-amber-600 text-slate-900 shadow-sm">
          <Mail className="h-4 w-4" />
          Send Email
        </Button>
        <Button variant="outline" onClick={() => setLogDialogOpen(true)} className="gap-2 bg-white shadow-sm hover:shadow">
          <Plus className="h-4 w-4" />
          Log Communication
        </Button>
        <Button variant="outline" onClick={() => setReminderDialogOpen(true)} className="gap-2 bg-white shadow-sm hover:shadow">
          <Calendar className="h-4 w-4" />
          Add Reminder
        </Button>
      </div>

      <p className="text-xs text-slate-500 leading-relaxed">
        {replyStatus?.email === true ? 'Email replies to tracked messages appear in this history.' : 'Automatic email reply capture is unavailable. Replies use your configured company email address.'}
        {replyStatus?.sms === true && ' SMS replies to tracked messages also appear here.'}
      </p>

      {/* Reminders */}
      {reminders.length > 0 && (
        <Card className="p-4 border-slate-200/80 shadow-sm bg-white">
          <h3 className="font-semibold mb-3 flex items-center gap-2 text-slate-900">
            <Calendar className="h-4 w-4 text-amber-500" />
            Follow-up Reminders
          </h3>
          <div className="space-y-2">
            {reminders.map(reminder => (
              <div key={reminder.id} className={`flex items-center justify-between p-3 rounded-lg border ${reminder.status === 'Completed' ? 'bg-slate-50 border-slate-100 opacity-60' : 'bg-white border-amber-200 shadow-sm'}`}>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className={`font-medium text-sm ${reminder.status === 'Completed' ? 'line-through text-slate-500' : 'text-slate-900'}`}>{reminder.title}</h4>
                    <Badge variant="outline" className="text-xs bg-white">{reminder.priority}</Badge>
                    {reminder.status === "Completed" && <Badge className="text-xs bg-green-100 text-green-800 border-green-200 hover:bg-green-100">Done</Badge>}
                  </div>
                  {reminder.description && <p className="text-xs text-slate-600 mt-1">{reminder.description}</p>}
                  <p className="text-xs text-slate-500 mt-1 font-medium">Due: {format(new Date(reminder.due_date), "MMM d, yyyy")}</p>
                </div>
                {reminder.status === "Pending" && (
                  <Button 
                    size="sm" 
                    variant="ghost"
                    className="text-green-600 hover:text-green-700 hover:bg-green-50"
                    onClick={() => updateReminderMutation.mutate({ id: reminder.id, data: { status: "Completed" } })}
                  >
                    Mark Done
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Communication History */}
      <Card className="p-4 border-slate-200/80 shadow-sm">
        <h3 className="font-semibold mb-3 text-slate-900">Communication History</h3>
        <div className="space-y-3">
          {communicationsFailed ? (
            <p role="alert" className="text-sm text-red-700">Communication history could not be loaded. <button className="underline font-semibold" onClick={() => queryClient.invalidateQueries({ queryKey: ["client-communications", partyId, companyId] })}>Retry</button></p>
          ) : communications.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-8 bg-slate-50 rounded-lg border border-dashed border-slate-200">No communications yet</p>
          ) : (
            communications.map(comm => {
              const Icon = typeIcons[comm.type] || MessageSquare;
              return (
                <div key={comm.id} className="border-l-4 border-amber-400 bg-slate-50 rounded-r-lg pl-4 pr-4 py-3 shadow-sm">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <Icon className="h-4 w-4 text-slate-500" />
                        <span className="font-semibold text-sm text-slate-900">{comm.subject || comm.type}</span>
                        <Badge variant="outline" className="text-xs bg-white">{comm.type}</Badge>
                        {["failed", "bounced", "undelivered", "complained"].includes(comm.status?.toLowerCase()) && <Badge className="text-xs bg-red-100 text-red-800 border-red-200">Delivery failed</Badge>}
                        {comm.direction?.toLowerCase() === "inbound" && !comm.answered_at && <Badge className="bg-amber-100 text-amber-900">Needs reply</Badge>}
                      </div>
                      {comm.message && (
                        <div className="text-sm text-slate-700 mt-2 whitespace-pre-wrap break-words overflow-hidden">{communicationText(comm.message)}</div>
                      )}
                      <p className="text-xs text-slate-500 mt-3 font-medium">
                        {comm.direction} • {comm.sent_by} • {comm.created_at ? format(new Date(comm.created_at), "MMM d, yyyy h:mm a") : "—"}
                      </p>
                      {comm.direction?.toLowerCase() === "inbound" && !comm.answered_at && <div className="flex flex-wrap gap-2 mt-2"><Button size="sm" className="min-h-10 bg-amber-500 hover:bg-amber-600 text-slate-900" disabled={!clientEmail || sending} onClick={() => { setReplyId(comm.id); setEmailForm({ subject: /^Re:/i.test(comm.subject || "") ? comm.subject : `Re: ${comm.subject || "Your message"}`, message: "" }); setEmailDialogOpen(true); }}>Reply by email</Button><Button size="sm" variant="outline" className="min-h-10 hover:bg-amber-50" disabled={markAnsweredMutation.isPending} onClick={() => markAnsweredMutation.mutate(comm.id)}>Mark handled</Button></div>}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Card>

      {/* Send Email Dialog */}
      <Dialog open={emailDialogOpen} onOpenChange={setEmailDialogOpen}>
        <DialogContent aria-describedby={undefined} className="max-w-2xl w-[95vw]">
          <DialogHeader>
            <DialogTitle>Send Email to {clientName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>To</Label>
              <Input value={clientEmail || ""} disabled className="bg-slate-50" />
              <p className="text-xs text-slate-500 mt-1">Replies will be sent to: <span className="font-medium">{profile?.email}</span></p>
            </div>
            <div>
              <Label>Subject *</Label>
              <Input 
                value={emailForm.subject}
                onChange={(e) => setEmailForm({...emailForm, subject: e.target.value})}
                placeholder="Email subject"
                className="bg-white"
              />
            </div>
            <div>
              <Label>Message *</Label>
              <Textarea 
                value={emailForm.message}
                onChange={(e) => setEmailForm({...emailForm, message: e.target.value})}
                placeholder="Write your message here..."
                rows={8}
                className="bg-white"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="outline" onClick={() => setEmailDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleSendEmail} disabled={sending} className="bg-slate-900 hover:bg-slate-800 text-white">
                <Send className="h-4 w-4 mr-2" />
                {sending ? "Sending securely..." : "Send Email"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Log Communication Dialog */}
      <Dialog open={logDialogOpen} onOpenChange={setLogDialogOpen}>
        <DialogContent aria-describedby={undefined} className="w-[95vw]">
          <DialogHeader>
            <DialogTitle>Log Communication</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Type</Label>
              <Select value={logForm.type} onValueChange={(v) => setLogForm({...logForm, type: v})}>
                <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Phone Call">Phone Call</SelectItem>
                  <SelectItem value="Meeting">Meeting</SelectItem>
                  <SelectItem value="Text Message">Text Message</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Subject *</Label>
              <Input 
                value={logForm.subject}
                onChange={(e) => setLogForm({...logForm, subject: e.target.value})}
                placeholder="Brief description (e.g. Left a voicemail)"
                className="bg-white"
              />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea 
                value={logForm.message}
                onChange={(e) => setLogForm({...logForm, message: e.target.value})}
                placeholder="Details of the conversation..."
                rows={4}
                className="bg-white"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="outline" onClick={() => setLogDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleLogCommunication} className="bg-slate-900 hover:bg-slate-800 text-white">Log Communication</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Reminder Dialog */}
      <Dialog open={reminderDialogOpen} onOpenChange={setReminderDialogOpen}>
        <DialogContent aria-describedby={undefined} className="w-[95vw]">
          <DialogHeader>
            <DialogTitle>Schedule Follow-up Reminder</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Title *</Label>
              <Input 
                value={reminderForm.title}
                onChange={(e) => setReminderForm({...reminderForm, title: e.target.value})}
                placeholder="e.g. Call to check on quote approval"
                className="bg-white"
              />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea 
                value={reminderForm.description}
                onChange={(e) => setReminderForm({...reminderForm, description: e.target.value})}
                placeholder="Any specific details you need to remember..."
                rows={3}
                className="bg-white"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Due Date *</Label>
                <Input 
                  type="date"
                  value={reminderForm.due_date}
                  onChange={(e) => setReminderForm({...reminderForm, due_date: e.target.value})}
                  className="bg-white"
                />
              </div>
              <div>
                <Label>Priority</Label>
                <Select value={reminderForm.priority} onValueChange={(v) => setReminderForm({...reminderForm, priority: v})}>
                  <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Low">Low</SelectItem>
                    <SelectItem value="Medium">Medium</SelectItem>
                    <SelectItem value="High">High</SelectItem>
                    <SelectItem value="Urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="outline" onClick={() => setReminderDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleCreateReminder} className="bg-slate-900 hover:bg-slate-800 text-white">Create Reminder</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
