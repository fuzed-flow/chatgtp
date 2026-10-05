import React, { useEffect, useState } from "react";
import { CalendarDays, CheckCircle2, Save } from "lucide-react";

import AIRewriteTextarea from "@/components/shared/AIRewriteTextarea";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { itemsToLines, linesToItems } from "@/lib/clientUpdates";

const today = () => new Date().toISOString().slice(0, 10);

function initialForm(update, fixedProject) {
  return {
    project_id: update?.project_id || fixedProject?.id || "",
    title: update?.title || "",
    update_date: update?.update_date || today(),
    summary: update?.summary || "",
    completed_work: itemsToLines(update?.completed_work),
    upcoming_work: itemsToLines(update?.upcoming_work),
    client_notes: update?.client_notes || "",
  };
}

export default function ClientUpdateFormDialog({ open, onOpenChange, update, projects, fixedProject, saving, onSave }) {
  const [form, setForm] = useState(() => initialForm(update, fixedProject));

  useEffect(() => {
    if (open) setForm(initialForm(update, fixedProject));
  }, [open, update, fixedProject]);

  const submit = status => {
    onSave({
      ...form,
      title: form.title.trim(),
      summary: form.summary.trim(),
      client_notes: form.client_notes.trim(),
      completed_work: linesToItems(form.completed_work),
      upcoming_work: linesToItems(form.upcoming_work),
      status,
    });
  };
  const valid = !!form.project_id && !!form.title.trim() && !!form.summary.trim();

  return (
    <Dialog open={open} onOpenChange={value => { if (!saving) onOpenChange(value); }}>
      <DialogContent
        className="flex max-h-[92dvh] w-[96vw] flex-col gap-0 overflow-hidden rounded-xl p-0 sm:max-w-2xl"
        closeButtonClassName="right-2 top-2 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-white/95 opacity-100 shadow-sm hover:bg-slate-100"
      >
        <DialogHeader className="shrink-0 border-b border-slate-200 px-5 pb-4 pt-7 pr-16 text-left sm:px-6 sm:pb-5 sm:pt-6 sm:pr-16">
          <DialogTitle className="flex items-center gap-2 text-xl font-black text-slate-950">
            <CalendarDays className="h-5 w-5 text-amber-600" />
            {update ? "Edit client update" : "Create client update"}
          </DialogTitle>
          <DialogDescription>
            Summarize progress, confirm completed work, and preview what happens next.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 overflow-y-auto px-5 pb-5 pt-4 sm:px-6 sm:pb-6">
          {!fixedProject && (
            <div className="space-y-2">
              <Label htmlFor="client-update-project">Project</Label>
              <select
                id="client-update-project"
                value={form.project_id}
                onChange={event => setForm(current => ({ ...current, project_id: event.target.value }))}
                disabled={saving || !!update}
                className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
              >
                <option value="">Choose a project</option>
                {projects.map(project => (
                  <option key={project.id} value={project.id}>
                    {project.project_number ? `${project.project_number} - ` : ""}{project.name}{project.client_name ? ` — ${project.client_name}` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
            <div className="space-y-2">
              <Label htmlFor="client-update-title">Update title</Label>
              <Input id="client-update-title" value={form.title} maxLength={200} disabled={saving} onChange={event => setForm(current => ({ ...current, title: event.target.value }))} placeholder="Weekly project update" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="client-update-date">Update date</Label>
              <Input id="client-update-date" type="date" value={form.update_date} disabled={saving} onChange={event => setForm(current => ({ ...current, update_date: event.target.value }))} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="client-update-summary">Project update</Label>
            <AIRewriteTextarea id="client-update-summary" value={form.summary} maxLength={10000} rows={5} disabled={saving} rewriteField="project_summary" onValueChange={value => setForm(current => ({ ...current, summary: value }))} placeholder="Give the client a concise, professional overview of this period’s progress." />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="client-update-completed">Completed work</Label>
              <AIRewriteTextarea id="client-update-completed" value={form.completed_work} maxLength={10000} rows={7} disabled={saving} rewriteField="completed_work" onValueChange={value => setForm(current => ({ ...current, completed_work: value }))} placeholder={"One completed item per line\nPlumbing rough-in completed\nCity inspection passed"} />
              <p className="text-xs text-slate-500">Each line becomes a confirmed completion item in the portal and PDF.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="client-update-upcoming">Upcoming work</Label>
              <AIRewriteTextarea id="client-update-upcoming" value={form.upcoming_work} maxLength={10000} rows={7} disabled={saving} rewriteField="upcoming_work" onValueChange={value => setForm(current => ({ ...current, upcoming_work: value }))} placeholder={"One upcoming item per line\nTiling begins Monday\nPainter scheduled after taping"} />
              <p className="text-xs text-slate-500">Use clear expectations without promising dates that are not confirmed.</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="client-update-notes">Important notes for the client</Label>
            <AIRewriteTextarea id="client-update-notes" value={form.client_notes} maxLength={10000} rows={4} disabled={saving} rewriteField="client_notes" onValueChange={value => setForm(current => ({ ...current, client_notes: value }))} placeholder="Optional decisions, access requirements, scheduling notes, or reminders." />
          </div>

          <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="button" variant="outline" disabled={!valid || saving} onClick={() => submit("Draft")}>
              <Save className="mr-2 h-4 w-4" />Save draft
            </Button>
            <Button type="button" disabled={!valid || saving} onClick={() => submit("Published")} className="bg-amber-500 font-bold text-slate-950 hover:bg-amber-600">
              <CheckCircle2 className="mr-2 h-4 w-4" />Publish to portal
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
