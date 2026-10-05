import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { toast } from "sonner";

const DOCUMENTS = {
  quote: { table: "quotes", detailKeys: ["quote"], listKeys: ["quotes"] },
  change_order: { table: "change_orders", detailKeys: ["change-order", "change_order"], listKeys: ["change-orders", "change_orders"] },
  invoice: { table: "invoices", detailKeys: ["invoice", "invoice_client_view"], listKeys: ["invoices"] },
  client_update: {
    table: "client_updates",
    detailKeys: ["client-update"],
    listKeys: ["client-updates"],
    sentPatch: () => ({ status: "Published", published_at: new Date().toISOString(), email_sent_at: new Date().toISOString() }),
  },
};
const SAFE_RETRY_AGE_MS = (24 * 60 - 5) * 60 * 1000;

export function isValidCompanyEmail(value) {
  if (typeof value !== "string") return false;
  const email = value.trim();
  const localPart = email.split("@")[0];
  return email.length <= 254 && localPart.length <= 64
    && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(email)
    && !localPart.startsWith(".") && !localPart.endsWith(".") && !localPart.includes("..");
}

async function functionError(error) {
  let message = error?.message || "Email could not be sent.";
  try {
    const response = await error?.context?.json?.();
    if (typeof response?.error === "string") message = response.error;
  } catch { /* Preserve the transport error when its response cannot be read. */ }
  const result = new Error(message);
  result.status = error?.context?.status;
  return result;
}

// A retry keeps the complete original request, including generated PDF bytes.
// The server's request ID makes a retry safe after an uncertain network result.
export function useDocumentEmailSend({
  open, documentId, documentType, companyEmail, onOpenChange, onSuccess,
  successMessage = "Email sent successfully!", loadingMessage = "Sending email...",
}) {
  const queryClient = useQueryClient();
  const [sendCopy, setSendCopy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasRetry, setHasRetry] = useState(false);
  const [copyPending, setCopyPending] = useState(false);
  const [retryExpired, setRetryExpired] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const intentRef = useRef(null);
  const lockRef = useRef(null);
  const generationRef = useRef(0);
  const copyEmail = typeof companyEmail === "string" ? companyEmail.trim() : "";
  const copyAvailable = isValidCompanyEmail(copyEmail);

  useEffect(() => {
    generationRef.current += 1;
    intentRef.current = null;
    lockRef.current = null;
    setSendCopy(false);
    setSaving(false);
    setHasRetry(false);
    setCopyPending(false);
    setRetryExpired(false);
    setErrorMessage("");
    return () => { generationRef.current += 1; };
  }, [open, documentId, documentType]);

  const handleOpenChange = nextOpen => {
    if (!nextOpen && lockRef.current) return;
    onOpenChange(nextOpen);
  };

  const send = async buildPayload => {
    if (lockRef.current) return;
    if (!open || !documentId || !DOCUMENTS[documentType]) {
      toast.error("Save the document before sending an email.");
      return;
    }
    if (!intentRef.current && sendCopy && !copyAvailable) {
      toast.error("Add a valid company email in Settings to receive a copy.");
      return;
    }

    const lock = {};
    lockRef.current = lock;
    const generation = generationRef.current;
    const isCurrent = () => generationRef.current === generation;
    setSaving(true);
    setErrorMessage("");
    const loadingToast = toast.loading(copyPending ? "Retrying your company copy..." : loadingMessage);
    let intent = intentRef.current;

    try {
      if (!intent) {
        const original = await buildPayload();
        if (!isCurrent()) return;
        const payload = JSON.parse(JSON.stringify({
          ...original,
          send_copy_to_company: sendCopy,
          document_type: documentType,
          document_id: documentId,
          request_id: crypto.randomUUID(),
        }));
        intent = { payload, response: null, statusSaved: false, createdAt: Date.now() };
        if (isCurrent()) intentRef.current = intent;
      }

      // A confirmed delivery needs only its local status write retried. That
      // can finish safely even after the provider's email retry window closes.
      const copyComplete = intent.response?.success === true
        && (!intent.payload.send_copy_to_company || intent.response.copy_status === "sent");
      if (!copyComplete && Date.now() - intent.createdAt >= SAFE_RETRY_AGE_MS) {
        const message = intent.response?.success === true
          ? "The client email was sent, but this copy request is too old to retry safely. Close this dialog and contact your company to obtain the copy."
          : "This email request is too old to retry safely. Close this dialog and check delivery before sending another email.";
        setRetryExpired(true);
        setErrorMessage(message);
        toast.error(message, { id: loadingToast });
        return;
      }

      // When delivery was confirmed and only the status write failed, retry
      // that write without making another email request.
      if (!copyComplete) {
        const { data, error } = await supabase.functions.invoke("send-email", { body: { ...intent.payload, track_replies: true } });
        if (error) throw await functionError(error);
        if (data?.success !== true) throw new Error(data?.error || "Email delivery could not be confirmed. Please retry.");
        intent.response = data;
      }

      const pendingCopy = intent.payload.send_copy_to_company && intent.response.copy_status !== "sent";
      if (isCurrent()) {
        setCopyPending(pendingCopy);
        setHasRetry(true);
      }

      const document = DOCUMENTS[intent.payload.document_type];
      if (!intent.statusSaved) {
        const { error } = await supabase.from(document.table).update(document.sentPatch ? document.sentPatch() : { status: "Sent" }).eq("id", intent.payload.document_id);
        if (error) throw new Error("The client email was sent, but the document status could not be saved. Retry to finish safely.");
        intent.statusSaved = true;
        for (const key of document.detailKeys) queryClient.invalidateQueries({ queryKey: [key, intent.payload.document_id] });
        for (const key of document.listKeys) queryClient.invalidateQueries({ queryKey: [key] });
        queryClient.invalidateQueries({ queryKey: ["project_documents"] });
      }

      if (!isCurrent()) return;
      if (pendingCopy) {
        const message = "The client email was sent, but your company copy could not be sent. Retry copy to send it without emailing the client again.";
        setErrorMessage(message);
        toast.error(message, { id: loadingToast });
        return;
      }

      intentRef.current = null;
      setHasRetry(false);
      setCopyPending(false);
      toast.success(successMessage, { id: loadingToast });
      try {
        onOpenChange(false);
        onSuccess?.();
      } catch {
        toast.error("The email was sent, but the page could not refresh. Reload the page to see the updated status.");
      }
    } catch (error) {
      if (!isCurrent()) return;
      // A validation rejection happens before customer delivery. Allow the
      // user to correct the form instead of retaining an invalid send intent.
      if (error.status === 400 && intent?.response?.success !== true) {
        intentRef.current = null;
        setHasRetry(false);
      } else {
        setHasRetry(!!intent);
      }
      const message = intent?.response?.success === true && !intent.statusSaved
        ? error.message
        : intent?.response?.success === true
          ? "The client email was sent. Your company copy is still pending; retry copy without emailing the client again."
          : error.message || "Email could not be sent. Please retry.";
      setErrorMessage(message);
      toast.error(message, { id: loadingToast });
    } finally {
      if (lockRef.current === lock) lockRef.current = null;
      if (isCurrent()) setSaving(false);
      if (!isCurrent()) toast.dismiss(loadingToast);
    }
  };

  return {
    saving, sendCopy, setSendCopy, copyEmail, copyAvailable, hasRetry, copyPending, retryExpired,
    inputsLocked: saving || hasRetry, errorMessage, handleOpenChange, send,
  };
}
