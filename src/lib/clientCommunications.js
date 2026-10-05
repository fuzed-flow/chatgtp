export function emailMessageHtml(message) {
  const escaped = String(message || "").replace(/[&<>"']/g, value => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[value]));
  return `<div style="white-space:pre-wrap;font-family:Arial,sans-serif">${escaped}</div>`;
}

// Provider/customer text is displayed as text, never inserted into the page as HTML.
export function communicationText(message) {
  const source = String(message || "").replace(/<br\s*\/?\s*>/gi, "\n").replace(/<\/(p|div|tr|h[1-6])>/gi, "\n");
  if (typeof DOMParser !== "undefined") return new DOMParser().parseFromString(source, "text/html").body.textContent || "";
  return source.replace(/<[^>]*>/g, "");
}

export function communicationSendPayload({ clientId, leadId, recipient, subject, message, requestId, replyId }) {
  return {
    client_id: clientId || null, lead_id: leadId || null, to_email: recipient,
    subject: subject.trim(), html_body: emailMessageHtml(message), request_id: requestId,
    notification_kind: "communication", track_replies: true, reply_to_communication_id: replyId || null,
  };
}
