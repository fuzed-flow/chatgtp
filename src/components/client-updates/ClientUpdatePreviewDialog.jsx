import React from "react";
import { CalendarDays, CheckCircle2, Download, MapPin, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { generateClientUpdatePDF } from "@/components/pdf/PDFGenerator";

export function ClientUpdatePreview({ update, project, client, company }) {
  if (!update) return null;
  const date = new Intl.DateTimeFormat("en-CA", { month: "long", day: "numeric", year: "numeric" })
    .format(new Date(`${update.update_date}T12:00:00`));

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="border-l-4 border-amber-500 bg-slate-950 px-6 py-6 text-white sm:px-8">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-400">Project update</p>
        <h2 className="mt-2 text-2xl font-black">{update.title}</h2>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-300">
          <span className="flex items-center gap-1.5"><CalendarDays className="h-4 w-4" />{date}</span>
          {project?.site_address && <span className="flex items-center gap-1.5"><MapPin className="h-4 w-4" />{project.site_address}</span>}
        </div>
      </header>
      <div className="space-y-7 p-6 sm:p-8">
        <div>
          <p className="text-xs font-black uppercase tracking-wider text-slate-500">{project?.name || "Project"}{client?.name ? ` - ${client.name}` : ""}</p>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-700">{update.summary}</p>
        </div>
        <section>
          <h3 className="flex items-center gap-2 text-base font-black text-slate-950"><CheckCircle2 className="h-5 w-5 text-emerald-600" />Completed since the last update</h3>
          <ul className="mt-3 space-y-2">
            {(update.completed_work || []).map((item, index) => <li key={`${item}-${index}`} className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">{item}</li>)}
            {!update.completed_work?.length && <li className="text-sm text-slate-500">No completed items were added.</li>}
          </ul>
        </section>
        <section>
          <h3 className="flex items-center gap-2 text-base font-black text-slate-950"><Sparkles className="h-5 w-5 text-amber-600" />Upcoming work</h3>
          <ul className="mt-3 space-y-2">
            {(update.upcoming_work || []).map((item, index) => <li key={`${item}-${index}`} className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-950">{item}</li>)}
            {!update.upcoming_work?.length && <li className="text-sm text-slate-500">No upcoming items were added.</li>}
          </ul>
        </section>
        {update.client_notes && <section className="rounded-xl border border-slate-200 bg-slate-50 p-4"><h3 className="text-sm font-black text-slate-950">Important notes</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{update.client_notes}</p></section>}
        <p className="border-t border-slate-200 pt-4 text-xs text-slate-500">Prepared by {update.prepared_by_name || company?.name || "Project team"}</p>
      </div>
    </article>
  );
}

export default function ClientUpdatePreviewDialog({ open, onOpenChange, update, project, client, company }) {
  const download = () => generateClientUpdatePDF(update, project, client, company);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94dvh] w-[97vw] overflow-y-auto p-4 sm:max-w-3xl sm:p-6">
        <DialogHeader className="pr-10">
          <DialogTitle>Client update preview</DialogTitle>
          <DialogDescription>This is the content the client will see in the portal and branded PDF.</DialogDescription>
        </DialogHeader>
        <ClientUpdatePreview update={update} project={project} client={client} company={company} />
        <div className="flex justify-end">
          <Button onClick={download} className="bg-amber-500 font-bold text-slate-950 hover:bg-amber-600"><Download className="mr-2 h-4 w-4" />Download PDF</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
