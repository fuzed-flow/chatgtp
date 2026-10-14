import { supabase } from "@/api/supabaseClient";

export async function convertLeadToClient(leadId) {
  if (!leadId) throw new Error("A lead is required before creating a client.");

  const { data, error } = await supabase.rpc("convert_lead_to_client", {
    p_lead_id: leadId,
  });

  if (error) throw new Error(error.message || "The lead could not be converted to a client.");
  if (!data?.id) throw new Error("The lead conversion returned no client.");
  return data;
}

export async function ensureQuoteClient(quoteId) {
  if (!quoteId) throw new Error("A quote is required before creating a project or invoice.");

  const { data, error } = await supabase.rpc("ensure_quote_client", {
    p_quote_id: quoteId,
  });

  if (error) throw new Error(error.message || "The quote contact could not be converted to a client.");
  if (!data?.client_id) throw new Error("The quote conversion returned no client.");
  return data;
}
