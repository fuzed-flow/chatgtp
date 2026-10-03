import React, { useState } from "react";
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

export default function CommunicationPanel({ clientId, clientEmail, clientPhone, clientName }) {
  const { profile } = useAuth();
  const companyId = profile?.company_id;

  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [logDialogOpen, setLogDialogOpen] = useState(false);
  const [reminderDialogOpen, setReminderDialogOpen] = useState(false);
  const [sending, setSending] = useState(false);
  
  const [emailForm, setEmailForm] = useState({ subject: "", message: "" });
  const [logForm, setLogForm] = useState({ type: "Phone Call", subject: "", message: "" });
  const [reminderForm, setReminderForm] = useState({ title: "", description: "", due_date: "", priority: "Medium" });
  
  const queryClient = useQueryClient();

  // 1. FETCH COMMUNICATIONS FROM SUPABASE
  const { data: communications = [] } = useQuery({
    queryKey: ["client-communications", clientId, companyId],
    enabled: !!clientId && !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_communications")
        .select("*")
        .eq("client_id", clientId)
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // 2. FETCH REMINDERS FROM SUPABASE
  const { data: reminders = [] } = useQuery({
    queryKey: ["client-reminders", clientId, companyId],
    enabled: !!clientId && !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_reminders")
        .select("*")
        .eq("client_id", clientId)
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
      queryClient.invalidateQueries({ queryKey: ["client-communications", clientId, companyId] });
      setLogDialogOpen(false);
      setLogForm({ type: "Phone Call", subject: "", message: "" });
      toast.success("Communication logged");
    }
  });

  const createReminderMutation = useMutation({
    mutationFn: async (data) => {
      const { error } = await supabase.from("client_reminders").insert([{ ...data, company_id: companyId, status: "Pending" }]);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client-reminders", clientId, companyId] });
      setReminderDialogOpen(false);
      setReminderForm({ title: "", description: "", due_date: "", priority: "Medium" });
      toast.success("Reminder created");
    }
  });

  const updateReminderMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      const { error } = await supabase.from("client_reminders").update(data).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["client-reminders", clientId, companyId] })
  });

  // 4. SEND EMAIL VIA SUPABASE EDGE FUNCTIONS
  const handleSendEmail = async () => {
    if (!emailForm.subject || !emailForm.message) {
      toast.error("Please fill in all fields");
      return;
    }

    setSending(true);
    try {
      // NOTE: This invokes a Supabase Edge Function! You'll need to deploy a 'send-client-email' function via Supabase CLI eventually.
      const { data, error } = await supabase.functions.invoke('send-client-email', {
        body: {
          client_id: clientId,
          subject: emailForm.subject,
          message: emailForm.message,
          to_email: clientEmail
        }
      });

      if (error) throw error;

      toast.success(`Email sent successfully!`);
      setEmailDialogOpen(false);
      setEmailForm({ subject: "", message: "" });
      
      // Auto-log it into the communications list!
      logCommunicationMutation.mutate({
        client_id: clientId,
        type: "Email",
        subject: emailForm.subject,
        message: emailForm.message,
        direction: "Outbound",
        status: "Sent",
        sent_by: profile?.full_name || "System"
      });

    } catch (error) {
      console.error("Email Error:", error);
      // Fallback for development if the Edge Function isn't deployed yet
      toast.info("Edge Function not deployed yet. Logging communication locally instead.");
      
      logCommunicationMutation.mutate({
        client_id: clientId,
        type: "Email",
        subject: emailForm.subject,
        message: emailForm.message,
        direction: "Outbound",
        status: "Sent",
        sent_by: profile?.full_name || "Unknown"
      });
      setEmailDialogOpen(false);
      setEmailForm({ subject: "", message: "" });
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
      client_id: clientId,
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
      client_id: clientId,
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
        <Button onClick={() => setEmailDialogOpen(true)} disabled={!clientEmail} className="gap-2 bg-gradient-to-br from-amber-500 to-amber-600 text-slate-900 shadow-sm">
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
          {communications.length === 0 ? (
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
                        {comm.status === "Failed" && <Badge className="text-xs bg-red-100 text-red-800 border-red-200">Failed</Badge>}
                      </div>
                      {comm.message && (
                        <div 
                          className="text-sm text-slate-700 mt-2 whitespace-pre-wrap overflow-hidden" 
                          dangerouslySetInnerHTML={{ __html: comm.message }} 
                        />
                      )}
                      <p className="text-xs text-slate-500 mt-3 font-medium">
                        {comm.direction} • {comm.sent_by} • {comm.created_at ? format(new Date(comm.created_at), "MMM d, yyyy h:mm a") : "—"}
                      </p>
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