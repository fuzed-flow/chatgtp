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

export const SMS_MESSAGE_LIMIT = 1600;

export function communicationPhone(value) {
  const phone = String(value || "").trim().replace(/[\s().-]/g, "");
  if (/^\d{10}$/.test(phone)) return `+1${phone}`;
  if (/^1\d{10}$/.test(phone)) return `+${phone}`;
  if (/^\+[1-9]\d{7,14}$/.test(phone)) return phone;
  return null;
}

export function isSmsCommunication(communication) {
  return ["sms", "text message"].includes(String(communication.type || "").toLowerCase());
}

export function communicationSmsPayload({ clientId, leadId, phone, message, requestId, replyId }) {
  const recipient = communicationPhone(phone);
  const text = String(message || "").trim();
  if (!recipient) throw new Error("Update this contact's phone number, including the country code, before sending SMS.");
  if (!text || text.length > SMS_MESSAGE_LIMIT) throw new Error(`Enter an SMS message of 1–${SMS_MESSAGE_LIMIT} characters.`);
  return {
    client_id: clientId || null, lead_id: leadId || null,
    phone_number: recipient, message_body: text, request_id: requestId,
    notification_kind: "communication", reply_to_communication_id: replyId || null,
  };
}

export async function communicationSendError(error, data) {
  try {
    const payload = await error?.context?.clone().json();
    if (typeof payload?.error === "string") return payload.error;
  } catch { /* Transport failures may not contain an HTTP response. */ }
  return data?.error || "SMS delivery could not be confirmed. Your draft is still here. Check communication history before sending again.";
}
