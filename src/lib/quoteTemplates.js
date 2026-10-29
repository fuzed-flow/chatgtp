// A title-only picker result must never hydrate a document.
export const quoteTemplateDetailKey = (companyId, templateId) => ["quote-template-detail", companyId, templateId];

export async function loadQuoteTemplate(client, companyId, templateId) {
  if (!companyId || !templateId) throw new Error("Select a quote template first.");
  const { data, error } = await client.from("quotes").select("*")
    .eq("company_id", companyId).eq("id", templateId).eq("is_template", true).single();
  if (error) throw error;
  if (!data || data.id !== templateId || data.company_id !== companyId || data.is_template !== true) {
    throw new Error("This quote template is unavailable.");
  }
  return data;
}

// Copy reusable document content, never customer, status, dates, or approval data.
export function reusableQuoteTemplateFields(template) {
  return {
    overall_scope: template.overall_scope || "",
    client_message: template.client_message || "",
    terms: template.terms || "",
    notes: template.notes || "",
    show_overall_scope: template.show_overall_scope !== false,
    deposit_amount: template.deposit_amount ?? 0,
    discount_amount: template.discount_amount ?? 0,
    discount_type: template.discount_type || "fixed",
    discount_percentage: template.discount_percentage ?? 0,
    show_discount_amount: Boolean(template.show_discount_amount),
    has_payment_schedule: Boolean(template.has_payment_schedule),
    hero_image_url: template.hero_image_url || "",
    end_photos: Array.isArray(template.end_photos) ? [...template.end_photos] : [],
    documents: Array.isArray(template.documents) ? template.documents.map(document => ({ ...document })) : [],
    margin: template.margin ?? 0,
    margin_adjustment_type: template.margin_adjustment_type || "none",
  };
}

export function quoteTemplatePdfSettings(template, fallback) {
  try {
    const saved = typeof template.pdf_customization_settings_json === "string"
      ? JSON.parse(template.pdf_customization_settings_json)
      : template.pdf_customization_settings_json;
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return fallback;
    return { ...fallback, ...saved, page_margins: { ...fallback.page_margins, ...saved.page_margins } };
  } catch {
    return fallback;
  }
}

export async function loadQuoteTemplateBundle(client, companyId, templateId) {
  const [template, ...children] = await Promise.all([
    loadQuoteTemplate(client, companyId, templateId),
    client.from("quote_phases").select("*").eq("company_id", companyId).eq("quote_id", templateId).order("sort_order", { ascending: true }),
    client.from("quote_line_items").select("*").eq("company_id", companyId).eq("quote_id", templateId).order("display_order", { ascending: true }),
    client.from("quote_payment_schedules").select("*").eq("company_id", companyId).eq("quote_id", templateId).order("sort_order", { ascending: true }),
  ]);
  for (const result of children) if (result.error) throw result.error;
  return { template, phases: children[0].data || [], items: children[1].data || [], schedule: children[2].data || [] };
}
