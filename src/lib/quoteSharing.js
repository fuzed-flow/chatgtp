import { supabase } from "@/api/supabaseClient";

export function buildPublicQuoteUrl(origin, quoteId, token) {
  if (!origin || !quoteId || !token) throw new Error("A secure quote link requires a quote and token.");
  const url = new URL("/PublicQuoteView", origin);
  url.searchParams.set("id", quoteId);
  url.searchParams.set("token", token);
  return url.toString();
}

export function buildClientPortalQuoteUrl(origin, clientId, token) {
  if (!origin || !clientId || !token) throw new Error("A secure portal link requires a client and quote token.");
  const url = new URL("/ClientPortal", origin);
  url.searchParams.set("id", clientId);
  url.searchParams.set("tab", "quotes");
  url.searchParams.set("quote_token", token);
  return url.toString();
}

export async function issueQuoteShareToken(quoteId) {
  if (!quoteId) throw new Error("Save the quote before creating a client link.");
  const { data, error } = await supabase.rpc("issue_quote_share_token", { p_quote: quoteId });
  if (error || !data) throw error || new Error("A secure quote link could not be created.");
  return data;
}

export async function getPublicQuoteBundle(quoteId, token) {
  if (!quoteId || !token) throw new Error("This quote link is incomplete.");
  const { data, error } = await supabase.rpc("get_public_quote_bundle", {
    p_quote: quoteId,
    p_token: token,
  });
  if (error || !data?.quote) throw error || new Error("This quote is unavailable.");
  return data;
}

export async function trackPublicQuoteView(quoteId, token) {
  const { error } = await supabase.rpc("track_public_quote_view", {
    p_quote: quoteId,
    p_token: token,
  });
  if (error) throw error;
}

export async function respondToPublicQuote({
  quoteId,
  token,
  action,
  selections = {},
  signerName = null,
  signerEmail = null,
  termsAccepted = false,
  message = null,
}) {
  const { data, error } = await supabase.rpc("respond_to_public_quote", {
    p_quote: quoteId,
    p_token: token,
    p_action: action,
    p_selections: selections,
    p_signer_name: signerName,
    p_signer_email: signerEmail,
    p_terms_accepted: termsAccepted,
    p_message: message,
  });
  if (error) throw error;
  return data;
}

export function publicQuoteErrorMessage(error, fallback = "This quote could not be updated. Please refresh and try again.") {
  const message = String(error?.message || "");
  if (/expired/i.test(message)) return message;
  if (/terms/i.test(message)) return "Please confirm that you accept the quote and its terms.";
  if (/email/i.test(message)) return "Enter a valid email address or leave the email field blank.";
  if (/approving client name|signer/i.test(message)) return "Enter your full name before approving the quote.";
  if (/no longer accepts|decision|status/i.test(message)) return "This quote already has a response or is no longer available.";
  if (/invalid|unavailable|permission|42501/i.test(message)) return "This secure quote link is invalid or no longer available.";
  return fallback;
}
