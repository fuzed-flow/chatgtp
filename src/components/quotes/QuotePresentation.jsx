import React, { useMemo, useState } from "react";
import { Building2, Calendar, FileText, MapPin, Receipt } from "lucide-react";
import { format, parseISO } from "date-fns";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCurrencyForCompany } from "@/components/utils/formatCurrency";

const safeNum = value => Number.isFinite(Number(value)) ? Number(value) : 0;

export function documentDate(value, pattern = "MMM d, yyyy") {
  if (!value) return "N/A";
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? parseISO(String(value)) : new Date(value);
  return Number.isNaN(parsed.getTime()) ? "N/A" : format(parsed, pattern);
}

export function readableBrandText(hex = "#f59e0b") {
  const clean = String(hex).replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(clean)) return "#0f172a";
  const channels = [0, 2, 4].map(index => parseInt(clean.slice(index, index + 2), 16) / 255)
    .map(value => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return luminance > 0.46 ? "#0f172a" : "#ffffff";
}

export function calculateQuoteTotals({ quote, phases = [], items = [], selections = {}, company }) {
  const settings = company?.settings || {};
  const primaryRate = safeNum(settings.tax_rate ?? 5) / 100;
  const secondaryRate = settings.enable_secondary_tax ? safeNum(settings.secondary_tax_rate ?? 0) / 100 : 0;
  const phaseMap = new Map(phases.map(phase => [phase.id, phase]));
  const phaseActive = phase => !phase?.is_optional || (selections[phase.id] ?? phase.default_selected === true);
  const itemActive = item => {
    const phase = phaseMap.get(item.phase_id);
    return phaseActive(phase) && (!item.is_optional || (selections[item.id] ?? item.default_selected === true));
  };

  let subtotal = 0;
  let taxable = 0;
  for (const item of items) {
    if (!itemActive(item)) continue;
    const lineTotal = safeNum(item.quantity) * safeNum(item.unit_price);
    subtotal += lineTotal;
    if (item.taxable) taxable += lineTotal;
  }
  const primaryTax = taxable * primaryRate;
  const secondaryTax = taxable * secondaryRate;
  const totalTax = primaryTax + secondaryTax;
  const discount = quote?.discount_type === "percentage"
    ? (subtotal + totalTax) * safeNum(quote?.discount_percentage) / 100
    : safeNum(quote?.discount_amount);

  return {
    subtotal,
    primaryTax,
    secondaryTax,
    totalTax,
    discount,
    total: Math.max(0, subtotal + totalTax - discount),
    phaseActive,
    itemActive,
  };
}

export default function QuotePresentation({
  quote,
  client,
  company,
  phases = [],
  items = [],
  scheduleItems = [],
  selections = {},
  onTogglePhase,
  onToggleItem,
  allowSelections = false,
  preview = false,
  actions = null,
}) {
  const [lightboxImage, setLightboxImage] = useState(null);
  const settings = company?.settings || {};
  const brandColor = settings?.pdf?.brand_color || "#f59e0b";
  const logoUrl = company?.logo_url || company?.company_logo_url;
  const money = value => formatCurrencyForCompany(value, company);
  const totals = useMemo(
    () => calculateQuoteTotals({ quote, phases, items, selections, company }),
    [quote, phases, items, selections, company],
  );
  const itemsByPhase = useMemo(() => {
    const grouped = new Map();
    for (const item of items) {
      const current = grouped.get(item.phase_id) || [];
      current.push(item);
      grouped.set(item.phase_id, current);
    }
    return grouped;
  }, [items]);
  const finalClientMessage = quote?.client_message || settings.quote_client_message || "";
  const finalTerms = quote?.terms || settings.default_terms || "";

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <div className="mx-auto max-w-4xl">
        {preview ? (
          <div role="status" className="sticky top-0 z-30 border-b border-amber-300 bg-amber-100 px-4 py-2 text-center text-sm font-bold text-amber-950 shadow-sm">
            Staff preview — this is read-only and does not record a client view.
          </div>
        ) : null}

        {quote.hero_image_url ? (
          <button type="button" onClick={() => setLightboxImage(quote.hero_image_url)} className="mt-6 block w-full overflow-hidden rounded-t-xl border border-slate-200 shadow-sm focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300" aria-label="Open quote banner image">
            <img src={quote.hero_image_url} alt="Quote banner" loading="eager" className="h-52 w-full object-cover transition-opacity hover:opacity-95 sm:h-64" />
          </button>
        ) : null}

        <div className="px-3 py-6 sm:px-4 sm:py-8">
          <header className="mb-8 flex flex-col items-center text-center sm:mb-10">
            {logoUrl ? <img src={logoUrl} alt={`${company?.name || "Company"} logo`} className="mb-5 h-20 w-48 object-contain" /> : <h1 className="text-3xl font-black" style={{ color: brandColor }}>{company?.name || "FuzedFlow"}</h1>}
            <div className="mt-2 max-w-md space-y-1 text-sm text-slate-500">
              {settings.address ? <p>{settings.address}</p> : null}
              <div className="flex flex-wrap justify-center gap-x-4 gap-y-1">
                {settings.phone ? <p>Phone: {settings.phone}</p> : null}
                {settings.email ? <p>Email: {settings.email}</p> : null}
                {settings.website ? <p>{settings.website}</p> : null}
              </div>
              {settings.tax_id ? <p>Tax ID: {settings.tax_id}</p> : null}
            </div>
            <h2 className="mt-8 text-2xl font-bold text-slate-950">Project Quote</h2>
            <p className="font-medium text-slate-600">Quote #{quote.quote_number}</p>
          </header>

          <Card className={`mb-6 bg-white p-4 shadow-xl sm:p-8 ${quote.hero_image_url ? "rounded-t-none border-t-0" : ""}`}>
            <div className="mb-8 grid gap-6 border-b border-slate-100 pb-6 md:grid-cols-2">
              <section>
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Quote For</p>
                <p className="flex items-center gap-2 text-lg font-black text-slate-950"><Building2 className="h-5 w-5" style={{ color: brandColor }} />{client?.name || "Client"}</p>
                {client?.billing_address ? <Address label="Billing Address" value={client.billing_address} /> : null}
                {client?.site_address || quote.site_address ? <Address label="Project / Site Location" value={client?.site_address || quote.site_address} /> : null}
              </section>
              <section className="text-left md:text-right">
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Date Information</p>
                <p className="flex items-center gap-2 text-sm md:justify-end"><Calendar className="h-4 w-4 text-slate-400" /><span className="font-medium text-slate-500">Issued:</span><span className="font-bold text-slate-950">{documentDate(quote.issue_date)}</span></p>
                {quote.expiry_date ? <p className="mt-1.5 flex items-center gap-2 text-sm md:justify-end"><span className="font-medium text-slate-500">Expires:</span><span className="font-bold text-slate-950">{documentDate(quote.expiry_date)}</span></p> : null}
              </section>
            </div>

            <section className="mb-8">
              <h3 className="break-words text-xl font-black text-slate-950">{quote.title}</h3>
              {quote.show_overall_scope && quote.overall_scope ? <p className="mt-2 whitespace-pre-wrap break-words text-sm font-medium leading-relaxed text-slate-600">{quote.overall_scope}</p> : null}
            </section>

            <div className="mb-8 space-y-6">
              {phases.map(phase => {
                const phaseSelected = totals.phaseActive(phase);
                const phaseItems = itemsByPhase.get(phase.id) || [];
                let phaseSubtotal = 0;
                let phaseTaxable = 0;
                for (const item of phaseItems) {
                  if (!totals.itemActive(item)) continue;
                  const lineTotal = safeNum(item.quantity) * safeNum(item.unit_price);
                  phaseSubtotal += lineTotal;
                  if (item.taxable) phaseTaxable += lineTotal;
                }
                const phasePrimaryTax = phaseTaxable * safeNum(settings.tax_rate ?? 5) / 100;
                const phaseSecondaryTax = settings.enable_secondary_tax ? phaseTaxable * safeNum(settings.secondary_tax_rate ?? 0) / 100 : 0;
                return (
                  <section key={phase.id} className={`rounded-xl border p-4 transition-opacity sm:p-5 ${phaseSelected ? "border-slate-200 bg-slate-50/60" : "border-slate-200 bg-slate-100 opacity-60"}`} style={phase.is_optional && phaseSelected ? { borderColor: brandColor, backgroundColor: `${brandColor}10` } : undefined}>
                    <div className="mb-3 flex flex-wrap items-center gap-3">
                      {phase.is_optional && allowSelections ? <SelectionCheckbox checked={phaseSelected} onChange={() => onTogglePhase?.(phase.id)} color={brandColor} label={`Include ${phase.phase_name}`} /> : null}
                      <h4 className="min-w-0 flex-1 text-lg font-black" style={{ color: phaseSelected ? brandColor : "#64748b" }}>{phase.phase_name}</h4>
                      {phase.is_optional ? <span className="rounded-full border px-2 py-1 text-xs font-bold" style={phaseSelected ? { color: brandColor, borderColor: brandColor, backgroundColor: `${brandColor}16` } : undefined}>Optional {phaseSelected ? "(Selected)" : "(Not selected)"}</span> : null}
                    </div>
                    {phase.scope_of_work && phase.show_scope_to_client !== false ? <p className="mb-4 whitespace-pre-wrap break-words text-sm font-medium leading-relaxed text-slate-600">{phase.scope_of_work}</p> : null}
                    {phase.photos?.length ? <PhotoGrid photos={phase.photos} label={phase.phase_name} onOpen={setLightboxImage} /> : null}
                    <div className="mb-4 space-y-2">
                      {phaseItems.map(item => {
                        const itemSelected = totals.itemActive(item);
                        return (
                          <div key={item.id} className={`border-b border-slate-200 py-3 ${itemSelected && phaseSelected ? "" : "opacity-55"}`}>
                            <div className="flex items-start gap-3">
                              {item.is_optional && phaseSelected && allowSelections ? <SelectionCheckbox checked={itemSelected} onChange={() => onToggleItem?.(item.id)} color={brandColor} label={`Include ${item.name}`} /> : null}
                              {item.photo_url ? <button type="button" onClick={() => setLightboxImage(item.photo_url)} className="h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-slate-300 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300" aria-label={`Open photo for ${item.name}`}><img src={item.photo_url} alt={item.name} loading="lazy" className="h-full w-full object-cover" /></button> : null}
                              <div className="min-w-0 flex-1">
                                <p className="break-words font-bold text-slate-950">{item.name}{item.is_optional ? <span className="ml-2 inline-block rounded-full border px-1.5 py-0.5 text-xs font-medium" style={itemSelected ? { color: brandColor, borderColor: brandColor } : undefined}>Optional{itemSelected ? " ✓" : ""}</span> : null}</p>
                                {item.description ? <p className="mt-1 whitespace-pre-wrap break-words text-xs font-medium leading-relaxed text-slate-500">{item.description}</p> : null}
                              </div>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center justify-end gap-x-4 gap-y-1 pl-11 text-right">
                              <p className="text-xs font-medium text-slate-500">{item.quantity} {item.unit || ""} × {money(item.unit_price)}</p>
                              <p className="font-black text-slate-950">{money(safeNum(item.quantity) * safeNum(item.unit_price))}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <TotalsBlock subtotal={phaseSubtotal} primaryTax={phasePrimaryTax} secondaryTax={phaseSecondaryTax} settings={settings} money={money} total={phaseSubtotal + phasePrimaryTax + phaseSecondaryTax} brandColor={brandColor} compact />
                  </section>
                );
              })}
            </div>

            {quote.end_photos?.length ? <section className="mb-8"><h4 className="text-lg font-black text-slate-950">Similar Projects We&apos;ve Completed</h4><p className="mb-4 text-sm font-medium text-slate-500">Examples of our past work</p><PhotoGrid photos={quote.end_photos} label="Past project" onOpen={setLightboxImage} large /></section> : null}

            <div className="mb-6 rounded-xl border-2 p-4 shadow-sm sm:p-6" style={{ backgroundColor: `${brandColor}08`, borderColor: `${brandColor}35` }}>
              <TotalsBlock {...totals} settings={settings} money={money} brandColor={brandColor} discountLabel={quote.discount_type === "percentage" ? `Discount (${quote.discount_percentage}%)` : "Discount"} />
            </div>

            {quote.has_payment_schedule && scheduleItems.length ? <section className="mb-6 rounded-xl border p-5" style={{ borderColor: `${brandColor}35`, backgroundColor: `${brandColor}08` }}><h4 className="mb-2 flex items-center gap-2 text-lg font-black text-slate-950"><Receipt className="h-5 w-5" style={{ color: brandColor }} />Payment Schedule</h4><p className="mb-4 text-sm font-medium text-slate-600">This project will be invoiced according to the following schedule:</p><div className="space-y-2">{scheduleItems.map(item => { const amount = item.amount_type === "percentage" ? totals.total * safeNum(item.percentage) / 100 : safeNum(item.amount); return <div key={item.id} className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white p-3"><div><p className="text-sm font-bold text-slate-950">{item.payment_name}</p>{item.due_event ? <p className="mt-0.5 text-xs font-medium capitalize text-slate-500">Due: {item.due_event.replace(/_/g, " ")}</p> : null}</div><p className="text-right font-black" style={{ color: brandColor }}>{money(amount)}{item.amount_type === "percentage" ? <span className="block text-xs text-slate-400">{item.percentage}%</span> : null}</p></div>; })}</div></section> : null}

            {quote.documents?.length ? <section className="mb-8"><h4 className="mb-3 text-lg font-black text-slate-950">Attached Documents</h4><div className="space-y-2">{quote.documents.map((doc, index) => <a key={`${doc.file_url}-${index}`} href={doc.file_url} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm font-bold text-slate-700 hover:bg-slate-100"><FileText className="h-5 w-5 text-slate-400" />{doc.file_name}</a>)}</div></section> : null}

            {finalClientMessage || finalTerms ? <section className="mt-8 space-y-6 border-t border-slate-100 pt-6">{finalClientMessage ? <div><p className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">Message from the Team</p><p className="whitespace-pre-wrap break-words text-sm font-medium leading-relaxed text-slate-700">{finalClientMessage}</p></div> : null}{finalTerms ? <div><p className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">Terms &amp; Conditions</p><p className="whitespace-pre-wrap break-words text-sm font-medium leading-relaxed text-slate-600">{finalTerms}</p></div> : null}</section> : null}
          </Card>

          {actions}
        </div>
      </div>

      <Dialog open={Boolean(lightboxImage)} onOpenChange={open => { if (!open) setLightboxImage(null); }}>
        <DialogContent className="max-w-[96vw] border-0 bg-slate-950 p-2 text-white sm:max-w-5xl">
          <DialogHeader className="sr-only"><DialogTitle>Quote image</DialogTitle><DialogDescription>Expanded image from this quote.</DialogDescription></DialogHeader>
          {lightboxImage ? <img src={lightboxImage} alt="Expanded quote attachment" className="max-h-[85vh] w-full object-contain" /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Address({ label, value }) {
  return <div className="mt-4"><p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p><p className="flex items-start gap-2 text-sm font-medium text-slate-600"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />{value}</p></div>;
}

function SelectionCheckbox({ checked, onChange, color, label }) {
  return <label className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg hover:bg-white" title={label}><input type="checkbox" checked={checked} onChange={onChange} className="h-5 w-5 cursor-pointer rounded" style={{ accentColor: color }} aria-label={label} /></label>;
}

function PhotoGrid({ photos, label, onOpen, large = false }) {
  return <div className={`mb-4 grid gap-3 ${large ? "grid-cols-2 sm:grid-cols-3 md:grid-cols-4" : "grid-cols-3 sm:grid-cols-5"}`}>{photos.map((photo, index) => <button key={`${photo}-${index}`} type="button" onClick={() => onOpen(photo)} className={`overflow-hidden rounded-lg border border-slate-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300 ${large ? "h-32" : "h-20"}`} aria-label={`Open ${label} photo ${index + 1}`}><img src={photo} alt={`${label} ${index + 1}`} loading="lazy" className="h-full w-full object-cover" /></button>)}</div>;
}

function TotalsBlock({ subtotal, primaryTax, secondaryTax, totalTax, discount = 0, total, settings, money, brandColor, compact = false, discountLabel = "Discount" }) {
  const primary = primaryTax ?? totalTax ?? 0;
  return <div className={`ml-auto space-y-2 ${compact ? "max-w-56 text-sm" : "text-lg"}`}><MoneyRow label="Subtotal" value={subtotal} money={money} /><MoneyRow label={settings.tax_label || "Tax"} value={primary} money={money} />{settings.enable_secondary_tax ? <MoneyRow label={settings.secondary_tax_label || "Secondary tax"} value={secondaryTax} money={money} /> : null}{discount > 0 ? <MoneyRow label={discountLabel} value={-discount} money={money} tone="discount" /> : null}<div className="flex items-center justify-between gap-6 border-t-2 pt-3 font-black" style={{ borderColor: `${brandColor}45`, color: brandColor }}><span>Total</span><span className={compact ? "text-base" : "text-2xl sm:text-3xl"}>{money(total)}</span></div></div>;
}

function MoneyRow({ label, value, money, tone }) {
  return <div className={`flex justify-between gap-6 font-medium ${tone === "discount" ? "text-emerald-700" : "text-slate-600"}`}><span>{label}:</span><span className="font-bold">{value < 0 ? `-${money(Math.abs(value))}` : money(value)}</span></div>;
}
