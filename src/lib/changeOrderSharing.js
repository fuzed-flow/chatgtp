import { supabase } from "@/api/supabaseClient";

const unwrap = ({ data, error }) => {
  if (error) throw error;
  return data;
};

export async function issueChangeOrderShareToken(changeOrderId) {
  return unwrap(await supabase.rpc("issue_change_order_share_token", { p_change_order: changeOrderId }));
}

export function buildPublicChangeOrderUrl(changeOrderId, token, origin = window.location.origin) {
  const url = new URL("/PublicChangeOrderView", origin);
  url.searchParams.set("id", changeOrderId);
  url.searchParams.set("token", token);
  return url.toString();
}

export async function getPublicChangeOrderBundle(changeOrderId, token) {
  return unwrap(await supabase.rpc("get_public_change_order_bundle", {
    p_change_order: changeOrderId,
    p_token: token,
  }));
}

export async function trackPublicChangeOrderView(changeOrderId, token) {
  return unwrap(await supabase.rpc("track_public_change_order_view", {
    p_change_order: changeOrderId,
    p_token: token,
  }));
}

export async function respondToPublicChangeOrder(changeOrderId, token, action, selections = {}, message = null) {
  return unwrap(await supabase.rpc("respond_to_public_change_order", {
    p_change_order: changeOrderId,
    p_token: token,
    p_action: action,
    p_selections: selections,
    p_message: message,
  }));
}
