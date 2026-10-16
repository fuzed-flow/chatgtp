import React, { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertCircle, ChevronDown, ChevronUp, Clock, Edit2, Mail, MessageSquare, MoreVertical, Phone, Pin, Send, Trash2, Users } from "lucide-react";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

const CATEGORIES = [
  { value: "General", icon: MessageSquare, color: "text-slate-600 bg-slate-100 border-slate-200" },
  { value: "Email", icon: Mail, color: "text-blue-600 bg-blue-50 border-blue-200" },
  { value: "Call", icon: Phone, color: "text-emerald-600 bg-emerald-50 border-emerald-200" },
  { value: "Meeting", icon: Users, color: "text-purple-600 bg-purple-50 border-purple-200" },
  { value: "Issue", icon: AlertCircle, color: "text-red-600 bg-red-50 border-red-200" },
];

const categoryConfig = name => CATEGORIES.find(item => item.value === name) || CATEGORIES[0];

export default function CrmNotesFeed({ relatedType, relatedId }) {
  const { profile } = useAuth();
  const companyId = profile?.company_id;
  const queryClient = useQueryClient();
  const autoCollapsed = useRef(false);
  const [collapsed, setCollapsed] = useState(false);
  const [visibleCount, setVisibleCount] = useState(5);
  const [newNote, setNewNote] = useState("");
  const [category, setCategory] = useState("General");
  const [mentions, setMentions] = useState([]);
  const [isPinned, setIsPinned] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [expandedNoteIds, setExpandedNoteIds] = useState(() => new Set());
  const [editForm, setEditForm] = useState({ content: "", category: "General" });

  const queryKey = ["notes", companyId, relatedType, relatedId];
  const { data: members = [] } = useQuery({
    queryKey: ["crm-note-members", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id,full_name,role").eq("company_id", companyId).eq("is_active", true);
      if (error) throw error;
      return (data || []).filter(member => ["owner", "admin", "office", "manager"].includes(member.role));
    },
  });

  const { data: notes = [], isLoading, isError } = useQuery({
    queryKey,
    enabled: !!companyId && !!relatedId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notes")
        .select("id,content,category,author_name,created_at,is_pinned,mention_user_ids")
        .eq("company_id", companyId)
        .eq("related_type", relatedType)
        .eq("related_id", relatedId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  useEffect(() => {
    autoCollapsed.current = false;
    setCollapsed(false);
    setVisibleCount(5);
    setEditingId(null);
    setExpandedNoteIds(new Set());
  }, [relatedId, relatedType]);

  useEffect(() => {
    if (!autoCollapsed.current && notes.length > 5) {
      autoCollapsed.current = true;
      setCollapsed(true);
    }
  }, [notes.length]);

  const sortedNotes = useMemo(() => [...notes].sort((a, b) => {
    if (!!a.is_pinned !== !!b.is_pinned) return a.is_pinned ? -1 : 1;
    return new Date(b.created_at) - new Date(a.created_at);
  }), [notes]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["notes", companyId] });
  const addNote = useMutation({
    mutationFn: async () => {
      const content = newNote.trim();
      if (!content) throw new Error("Note cannot be empty.");
      const { error } = await supabase.from("notes").insert({
        company_id: companyId,
        related_type: relatedType,
        related_id: relatedId,
        content,
        category,
        author_name: profile?.full_name || "Team Member",
        is_pinned: isPinned,
        mention_user_ids: mentions,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      setNewNote("");
      setCategory("General");
      setMentions([]);
      setIsPinned(false);
      setCollapsed(false);
      toast.success("Note saved successfully.");
    },
    onError: error => toast.error(error.message),
  });

  const editNote = useMutation({
    mutationFn: async () => {
      const content = editForm.content.trim();
      if (!content) throw new Error("Note cannot be empty.");
      const { error } = await supabase.from("notes").update({ content, category: editForm.category }).eq("id", editingId).eq("company_id", companyId);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); setEditingId(null); toast.success("Note updated."); },
    onError: error => toast.error(error.message),
  });

  const deleteNote = useMutation({
    mutationFn: async id => {
      const { error } = await supabase.from("notes").delete().eq("id", id).eq("company_id", companyId);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success("Note removed."); },
    onError: error => toast.error(error.message),
  });

  const togglePin = useMutation({
    mutationFn: async note => {
      const { error } = await supabase.from("notes").update({ is_pinned: !note.is_pinned }).eq("id", note.id).eq("company_id", companyId);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: error => toast.error(error.message),
  });

  return (
    <div className="w-full">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/60 px-4 py-4 text-left hover:bg-slate-100/70"
        onClick={() => setCollapsed(value => !value)}
        aria-expanded={!collapsed}
      >
        <span>
          <span className="block text-base font-black text-slate-900">Notes ({notes.length})</span>
          <span className="mt-0.5 block text-xs font-medium text-slate-500">Internal notes for this {relatedType.toLowerCase()}</span>
        </span>
        {collapsed ? <ChevronDown className="h-5 w-5 text-slate-500" /> : <ChevronUp className="h-5 w-5 text-slate-500" />}
      </button>

      {!collapsed ? (
        <div className="p-3 sm:p-4">
          {isLoading ? <p className="py-6 text-center text-sm text-slate-500">Loading notes…</p> : null}
          {isError ? <p role="alert" className="py-4 text-sm text-red-700">Notes could not be loaded.</p> : null}
          {!isLoading && !isError && sortedNotes.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 py-6 text-center text-sm text-slate-500">No notes yet.</p>
          ) : null}

          <div className="space-y-3">
            {sortedNotes.slice(0, visibleCount).map(note => {
              const config = categoryConfig(note.category);
              const Icon = config.icon;
              const editing = editingId === note.id;
              return (
                <article key={note.id} className={`rounded-xl border p-3 sm:p-4 ${note.is_pinned ? "border-amber-300 bg-amber-50/60" : "border-slate-200 bg-white"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold text-slate-900">{note.author_name || "Team Member"}</span>
                        <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${config.color}`}>
                          <Icon className="h-2.5 w-2.5" /> {note.category || "General"}
                        </span>
                        {note.is_pinned ? <Pin className="h-3 w-3 fill-amber-600 text-amber-600" /> : null}
                      </div>
                      <span className="mt-1 flex items-center gap-1 text-[10px] font-medium text-slate-400">
                        <Clock className="h-3 w-3" /> {format(new Date(note.created_at), "MMM d, yyyy h:mm a")}
                      </span>
                    </div>
                    {!editing ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" className="h-8 w-8"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => togglePin.mutate(note)}><Pin className="mr-2 h-4 w-4" />{note.is_pinned ? "Unpin note" : "Pin to top"}</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => { setEditingId(note.id); setEditForm({ content: note.content, category: note.category || "General" }); }}><Edit2 className="mr-2 h-4 w-4" />Edit note</DropdownMenuItem>
                          <DropdownMenuItem className="text-red-600" onClick={() => { if (window.confirm("Delete this note?")) deleteNote.mutate(note.id); }}><Trash2 className="mr-2 h-4 w-4" />Delete note</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </div>

                  {editing ? (
                    <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <Select value={editForm.category} onValueChange={value => setEditForm(current => ({ ...current, category: value }))}>
                        <SelectTrigger className="h-9 bg-white"><SelectValue /></SelectTrigger>
                        <SelectContent>{CATEGORIES.map(item => <SelectItem key={item.value} value={item.value}>{item.value}</SelectItem>)}</SelectContent>
                      </Select>
                      <Textarea value={editForm.content} onChange={event => setEditForm(current => ({ ...current, content: event.target.value }))} className="min-h-24 bg-white" />
                      <div className="flex justify-end gap-2"><Button type="button" variant="outline" size="sm" onClick={() => setEditingId(null)}>Cancel</Button><Button type="button" size="sm" onClick={() => editNote.mutate()} disabled={editNote.isPending}>Save changes</Button></div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={`mt-3 block w-full whitespace-pre-wrap break-words text-left text-sm leading-relaxed text-slate-700 ${expandedNoteIds.has(note.id) ? "" : "line-clamp-2"}`}
                      onClick={() => setExpandedNoteIds(current => {
                        const next = new Set(current);
                        if (next.has(note.id)) next.delete(note.id);
                        else next.add(note.id);
                        return next;
                      })}
                      aria-expanded={expandedNoteIds.has(note.id)}
                      title={expandedNoteIds.has(note.id) ? "Collapse note" : "View full note"}
                    >
                      {note.content}
                    </button>
                  )}
                </article>
              );
            })}
          </div>

          {sortedNotes.length > 5 ? (
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {visibleCount < sortedNotes.length ? <Button type="button" variant="ghost" size="sm" onClick={() => setVisibleCount(Math.min(sortedNotes.length, visibleCount + 10))}>Show {Math.min(10, sortedNotes.length - visibleCount)} more</Button> : null}
              {visibleCount > 5 ? <Button type="button" variant="ghost" size="sm" onClick={() => setVisibleCount(5)}>Show less</Button> : null}
            </div>
          ) : null}

          <div className="mt-4 rounded-xl border border-slate-300 bg-white shadow-sm">
            <div className="flex flex-wrap gap-2 p-3 pb-0">
              <label className="flex items-center gap-2 text-xs text-slate-600">Mention a teammate
                <select value="" onChange={event => {
                  const member = members.find(item => item.id === event.target.value);
                  if (!member) return;
                  setMentions(current => [...new Set([...current, member.id])]);
                  setNewNote(current => `${current}${current ? " " : ""}@${member.full_name} `);
                }} className="max-w-44 rounded border border-slate-200 p-1" aria-label="Mention a teammate">
                  <option value="">Choose teammate</option>
                  {members.filter(member => !mentions.includes(member.id)).map(member => <option key={member.id} value={member.id}>{member.full_name}</option>)}
                </select>
              </label>
            </div>
            <Textarea value={newNote} onChange={event => setNewNote(event.target.value)} placeholder="Add an internal note…" className="min-h-20 resize-y border-0 focus-visible:ring-0" />
            <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => setIsPinned(value => !value)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 text-xs font-bold text-slate-600"><Pin className={`h-3.5 w-3.5 ${isPinned ? "fill-amber-500 text-amber-500" : ""}`} />Pin</button>
                <Select value={category} onValueChange={setCategory}><SelectTrigger className="h-8 w-28 bg-white text-xs"><SelectValue /></SelectTrigger><SelectContent>{CATEGORIES.map(item => <SelectItem key={item.value} value={item.value}>{item.value}</SelectItem>)}</SelectContent></Select>
              </div>
              <Button type="button" size="sm" onClick={() => addNote.mutate()} disabled={addNote.isPending || !newNote.trim()} className="bg-slate-900 text-white"><Send className="mr-2 h-3.5 w-3.5" />{addNote.isPending ? "Saving…" : "Post note"}</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
