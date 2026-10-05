import React from "react";
import { CalendarDays, CheckCircle2, Clock3, MapPin, UserRoundCheck } from "lucide-react";

const dateLabel = value => value
  ? new Intl.DateTimeFormat("en-CA", { month: "long", day: "numeric", year: "numeric" }).format(new Date(`${value}T12:00:00`))
  : "Date not recorded";

const statusTone = status => status === "Complete"
  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
  : status === "Ready for Review"
    ? "border-blue-200 bg-blue-50 text-blue-800"
    : "border-amber-200 bg-amber-50 text-amber-800";

export default function ProjectCloseoutPreview({ closeout, items = [], project, client, company, compact = false }) {
  if (!closeout) return null;
  const completed = items.filter(item => item.status === "Complete").length;
  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="border-l-4 border-amber-500 bg-slate-950 px-5 py-6 text-white sm:px-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div><p className="text-xs font-black uppercase tracking-[0.2em] text-amber-400">Project closeout</p><h2 className="mt-2 text-2xl font-black">{closeout.title}</h2><div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-300"><span className="flex items-center gap-1.5"><CalendarDays className="h-4 w-4" />{dateLabel(closeout.walkthrough_date)}</span>{project?.site_address && <span className="flex items-center gap-1.5"><MapPin className="h-4 w-4" />{project.site_address}</span>}</div></div>
          {(company?.logo_url || company?.company_logo_url) && <img src={company.logo_url || company.company_logo_url} alt={`${company?.name || "Company"} logo`} className="max-h-12 max-w-40 object-contain" />}
        </div>
      </header>
      <div className="space-y-6 p-5 sm:p-8">
        <div className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2"><div><p className="text-xs font-black uppercase tracking-wider text-slate-500">Project</p><p className="mt-1 font-bold text-slate-950">{project?.project_number ? `${project.project_number} — ` : ""}{project?.name || "Project"}</p><p className="mt-1 text-sm text-slate-600">Prepared for {client?.name || "Client"}</p></div><div className="sm:text-right"><p className="text-xs font-black uppercase tracking-wider text-slate-500">Deficiencies</p><p className="mt-1 text-lg font-black text-slate-950">{completed} of {items.length} complete</p><p className="mt-1 text-sm text-slate-600">Prepared by {closeout.prepared_by_name || company?.name || "Project team"}</p></div></div>
        {closeout.notes && <section><h3 className="text-sm font-black uppercase tracking-wider text-slate-500">Walkthrough notes</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{closeout.notes}</p></section>}
        <section className="space-y-5">
          {items.length === 0 ? <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">No deficiencies have been added.</div> : items.map((item, index) => (
            <div key={item.id || index} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className={`grid ${compact ? "gap-4" : "md:grid-cols-[240px_1fr]"}`}>
                <div className="aspect-[4/3] bg-slate-100 md:aspect-auto md:min-h-44"><img src={item.photo_url} alt={`Deficiency ${index + 1}: ${item.deficiency_type}`} className="h-full w-full object-cover" loading="lazy" /></div>
                <div className="p-4 sm:p-5"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-slate-950 px-2.5 py-1 text-xs font-black text-white">#{index + 1}</span><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">{item.deficiency_type || "General"}</span><span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${statusTone(item.status)}`}>{item.status || "Open"}</span></div><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.description?.trim() || <span className="italic text-amber-700">Description to be completed</span>}</p><div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-slate-100 pt-3 text-xs font-semibold text-slate-500">{(item.vendor_name || item.vendor?.name) && <span className="flex items-center gap-1.5"><UserRoundCheck className="h-3.5 w-3.5" />Assigned to {item.vendor_name || item.vendor?.name}</span>}{item.due_date && <span className="flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />Due {dateLabel(item.due_date)}</span>}{item.status === "Complete" && <span className="flex items-center gap-1.5 text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />Confirmed complete</span>}</div></div>
              </div>
            </div>
          ))}
        </section>
      </div>
    </article>
  );
}
