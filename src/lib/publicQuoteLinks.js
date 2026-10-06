// Keep access credentials in the path so opening/copying a quote does not
// depend on email clients retaining its query string. Existing links still work.
export function buildPublicQuoteUrl(origin, quoteId, token) {
  if (!origin || !quoteId || !token) throw new Error("A secure quote link requires a quote and token.");
  return new URL(`/PublicQuoteView/${encodeURIComponent(quoteId)}/${encodeURIComponent(token)}`, origin).toString();
}

export function readPublicQuoteLink(location) {
  const path = String(location.pathname || "").match(/^\/PublicQuoteView\/([^/]+)\/([^/]+)\/?$/i);
  if (path) {
    try {
      return { quoteId: decodeURIComponent(path[1]), token: decodeURIComponent(path[2]) };
    } catch {
      return { quoteId: null, token: null };
    }
  }
  const params = new URLSearchParams(location.search || "");
  return { quoteId: params.get("id"), token: params.get("token") || params.get("amp;token") };
}
