import { verifyTwilioSignature } from "../_shared/providerSignatures.js";

const FUNCTION_NAME = "twilio-recording-email";
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_RECIPIENT = "fuzedflow@gmail.com";
const MAX_WEBHOOK_BYTES = 1_100_000;
const MAX_ATTACHMENT_BYTES = 18 * 1024 * 1024;
const FULL_CALL_RECORDING_SOURCES = new Set([
  "DialVerb",
  "Conference",
  "OutboundAPI",
  "Trunking",
  "StartCallRecordingAPI",
  "StartConferenceRecordingAPI",
]);

const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}[character]!));

const cleanHeader = (value: unknown, fallback: string) => String(value ?? "")
  .replace(/[\r\n]+/g, " ")
  .trim()
  .slice(0, 120) || fallback;

const emailRecipients = (value: string | undefined) => {
  const recipients = String(value || DEFAULT_RECIPIENT)
    .split(",")
    .map(email => email.trim().toLowerCase())
    .filter(email => /^\S+@[^\s@]+\.[^\s@]+$/.test(email));
  return [...new Set(recipients)].slice(0, 5).length
    ? [...new Set(recipients)].slice(0, 5)
    : [DEFAULT_RECIPIENT];
};

const base64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return btoa(chunks.join(""));
};

const localTimestamp = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Edmonton",
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
}).format(new Date());

async function recordingAttachment(accountSid: string, authToken: string, recordingSid: string) {
  const recordingUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${recordingSid}.mp3`;
  const response = await fetch(recordingUrl, {
    headers: { Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}` },
  });
  if (!response.ok) throw new Error(`Twilio recording download failed with ${response.status}`);

  const announcedLength = Number(response.headers.get("content-length") || 0);
  if (announcedLength > MAX_ATTACHMENT_BYTES) return null;
  const audio = await response.arrayBuffer();
  if (!audio.byteLength || audio.byteLength > MAX_ATTACHMENT_BYTES) return null;
  return {
    content: base64(audio),
    filename: `fuzedflow-call-${recordingSid}.mp3`,
  };
}

Deno.serve(async request => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID") || "";
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
  const resendKey = Deno.env.get("RESEND_API_KEY") || "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  if (!accountSid || !authToken || !resendKey || !supabaseUrl) {
    console.error(JSON.stringify({ level: "error", route: FUNCTION_NAME, message: "Provider configuration unavailable" }));
    return new Response("Service unavailable", { status: 503 });
  }

  try {
    if (Number(request.headers.get("content-length") || 0) > MAX_WEBHOOK_BYTES) {
      return new Response("Request too large", { status: 413 });
    }
    const raw = await request.text();
    if (raw.length > MAX_WEBHOOK_BYTES) return new Response("Request too large", { status: 413 });
    const form = new URLSearchParams(raw);
    const canonicalUrl = `${supabaseUrl}/functions/v1/${FUNCTION_NAME}${new URL(request.url).search}`;
    const signatureValid = await verifyTwilioSignature(
      canonicalUrl,
      form,
      request.headers.get("X-Twilio-Signature"),
      authToken,
    );
    if (!signatureValid || form.get("AccountSid") !== accountSid) {
      return new Response("Invalid signature", { status: 401 });
    }

    const recordingSid = form.get("RecordingSid") || "";
    const callSid = form.get("CallSid") || "";
    const hasTranscription = form.has("TranscriptionStatus");
    const transcriptionSid = form.get("TranscriptionSid") || "";
    const transcriptionStatus = (form.get("TranscriptionStatus") || "").toLowerCase();
    const recordingStatus = (form.get("RecordingStatus") || "").toLowerCase();
    const recordingSource = form.get("RecordingSource") || "";

    // A Record verb is the Studio voicemail flow. Wait for its transcription
    // callback so one voicemail does not produce two emails.
    if (!hasTranscription && (!recordingSource || recordingSource === "RecordVerb")) {
      return new Response("Waiting for transcription", { status: 200 });
    }

    // Unknown recording sources and non-completed lifecycle events do not need
    // retries. Twilio will send the completed event when the media is ready.
    if (!hasTranscription && !FULL_CALL_RECORDING_SOURCES.has(recordingSource)) {
      return new Response("Recording source ignored", { status: 200 });
    }
    if (!hasTranscription && ["in-progress", "absent", "failed"].includes(recordingStatus)) {
      return new Response("Recording not ready", { status: 200 });
    }

    if (!/^RE[0-9a-f]{32}$/i.test(recordingSid)
      || !/^CA[0-9a-f]{32}$/i.test(callSid)
      || (hasTranscription && transcriptionSid && !/^TR[0-9a-f]{32}$/i.test(transcriptionSid))
      || (hasTranscription && !["completed", "failed"].includes(transcriptionStatus))
      || (!hasTranscription && recordingStatus !== "completed")) {
      return new Response("Invalid callback", { status: 400 });
    }

    const caller = cleanHeader(form.get("From"), "Unknown caller");
    const calledNumber = cleanHeader(form.get("To"), "FuzedFlow");
    const transcript = String(form.get("TranscriptionText") || "").trim().slice(0, 100_000);
    const duration = String(form.get("RecordingDuration") || "").replace(/[^0-9]/g, "").slice(0, 8);
    const channels = String(form.get("RecordingChannels") || "").replace(/[^0-9]/g, "").slice(0, 2);
    const attachment = await recordingAttachment(accountSid, authToken, recordingSid);
    const transcriptText = hasTranscription
      ? (transcriptionStatus === "completed" && transcript
        ? transcript
        : "Twilio could not create a transcript for this recording.")
      : "A transcript is not included with this call-recording callback. Full-call transcription requires Twilio Batch Transcription.";
    const receivedAt = localTimestamp();
    const attachmentNote = attachment
      ? "The MP3 recording is attached."
      : "The recording was too large to attach. Open the recording in the Twilio Console using the Recording SID below.";

    const details = [
      ["From", caller],
      ["To", calledNumber],
      ["Received", receivedAt],
      ...(duration ? [["Duration", `${duration} seconds`]] : []),
      ["Call SID", callSid],
      ["Recording SID", recordingSid],
      ...(!hasTranscription ? [["Recording source", recordingSource]] : []),
      ...(!hasTranscription && channels ? [["Channels", channels]] : []),
    ];
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>FuzedFlow call recording</title></head><body style="margin:0;background:#f8fafc;color:#0f172a;font-family:Arial,sans-serif"><main style="max-width:640px;margin:0 auto;padding:24px"><div style="background:#0b1538;color:#fff;border-radius:16px 16px 0 0;padding:22px 24px"><h1 style="margin:0;font-size:24px">New FuzedFlow call recording</h1></div><div style="background:#fff;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 16px 16px;padding:24px"><table role="presentation" style="width:100%;border-collapse:collapse">${details.map(([label, value]) => `<tr><th scope="row" style="padding:6px 12px 6px 0;text-align:left;vertical-align:top;color:#475569;font-size:14px">${escapeHtml(label)}</th><td style="padding:6px 0;font-size:14px">${escapeHtml(value)}</td></tr>`).join("")}</table><h2 style="margin:24px 0 8px;font-size:18px">Transcript</h2><div style="white-space:pre-wrap;line-height:1.6;background:#f8fafc;border-radius:12px;padding:16px">${escapeHtml(transcriptText)}</div><p style="margin:18px 0 0;color:#475569;font-size:14px">${escapeHtml(attachmentNote)}</p></div></main></body></html>`;
    const text = `New FuzedFlow call recording\n\n${details.map(([label, value]) => `${label}: ${value}`).join("\n")}\n\nTranscript:\n${transcriptText}\n\n${attachmentNote}`;
    const payload: Record<string, unknown> = {
      from: "Fuzed Flow <alerts@mail.fuzedflow.com>",
      to: emailRecipients(Deno.env.get("TWILIO_CALL_EMAIL_TO")),
      subject: hasTranscription
        ? `New FuzedFlow call recording from ${caller}`
        : `New FuzedFlow recorded call from ${caller}`,
      html,
      text,
      ...(attachment ? { attachments: [attachment] } : {}),
    };
    const email = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": hasTranscription
          ? `twilio-recording/${transcriptionSid || recordingSid}`
          : `twilio-call-recording/${recordingSid}`,
      },
      body: JSON.stringify(payload),
    });
    if (!email.ok) {
      console.error(JSON.stringify({ level: "error", route: FUNCTION_NAME, message: "Email delivery failed", status: email.status }));
      return new Response("Email delivery unavailable", { status: 503 });
    }
    return new Response("Email sent", { status: 200 });
  } catch (error) {
    console.error(JSON.stringify({ level: "error", route: FUNCTION_NAME, message: "Webhook processing failed", error: error instanceof Error ? error.message : "unknown" }));
    return new Response("Webhook processing failed", { status: 503 });
  }
});
