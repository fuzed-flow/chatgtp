import { supabase } from "@/api/supabaseClient";

export async function convertQuoteToInvoice({
  quoteId,
  projectId = null,
  selections = null,
  totals = null,
}) {
  if (!quoteId) throw new Error("A quote is required before creating an invoice.");

  const { data, error } = await supabase.rpc("convert_quote_to_invoice", {
    p_quote_id: quoteId,
    p_project_id: projectId,
    p_selected_items: selections,
    p_subtotal: totals?.subtotal ?? null,
    p_tax: totals?.tax ?? null,
    p_total: totals?.total ?? null,
  });

  if (error) throw new Error(error.message || "The invoice could not be created.");
  if (!data?.id) throw new Error("The invoice conversion returned no invoice.");
  return data;
}
