import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Maximize2, Minimize2, RotateCcw, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { PlainTextarea } from "@/components/ui/textarea-base";
import { canAttemptAIRewrite, friendlyRetryDelay } from "@/lib/aiRewrite";
import { useAuthState } from "@/lib/AuthStateContext";
import { cn } from "@/lib/utils";

async function functionError(error) {
  let message = error?.message || "AI Rewrite is unavailable right now.";
  let code = "AI_REWRITE_ERROR";
  let retryAfterSeconds = 0;
  try {
    const payload = await error?.context?.json?.();
    if (payload?.error) message = payload.error;
    if (payload?.code) code = payload.code;
    if (payload?.retry_after_seconds) retryAfterSeconds = Number(payload.retry_after_seconds);
  } catch { /* Keep the transport error when no JSON response is available. */ }
  const result = new Error(message);
  result.code = code;
  result.retryAfterSeconds = retryAfterSeconds;
  return result;
}

const AIRewriteTextarea = forwardRef(function AIRewriteTextarea({
  value,
  onValueChange,
  onChange,
  rewriteField,
  disabled = false,
  className,
  ...props
}, forwardedRef) {
  const { user, company } = useAuthState();
  const [rewriting, setRewriting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [undoValue, setUndoValue] = useState(null);
  const requestId = useRef(0);
  const textareaRef = useRef(null);
  useImperativeHandle(forwardedRef, () => textareaRef.current);

  useEffect(() => () => { requestId.current += 1; }, []);

  const rewrite = async () => {
    const source = value.trim();
    if (!source) {
      toast.error("Add some text before using AI Rewrite.");
      return;
    }
    if (!canAttemptAIRewrite({ user, company })) {
      toast.info("AI Rewrite is available on Professional and Business plans.");
      return;
    }
    const currentRequest = ++requestId.current;
    setRewriting(true);
    try {
      const { supabase } = await import("@/api/supabaseClient");
      const { data, error } = await supabase.functions.invoke("rewrite-text", {
        body: {
          text: source,
          field: rewriteField || "general_business_text",
          ...(globalThis.crypto?.randomUUID ? { request_id: globalThis.crypto.randomUUID() } : {}),
        },
      });
      if (error) throw await functionError(error);
      if (typeof data?.text !== "string" || !data.text.trim()) throw new Error("AI Rewrite returned an empty response. Please try again.");
      if (currentRequest !== requestId.current) return;
      setUndoValue(value);
      emitValue(data.text.trim());
      toast.success("Text rewritten. You can undo the change below.");
    } catch (error) {
      if (currentRequest === requestId.current) {
        const retry = error.retryAfterSeconds ? ` Try again in ${friendlyRetryDelay(error.retryAfterSeconds)}.` : "";
        toast.error(`${error.message || "AI Rewrite is unavailable right now."}${retry}`);
      }
    } finally {
      if (currentRequest === requestId.current) setRewriting(false);
    }
  };

  const change = event => {
    setUndoValue(null);
    if (onValueChange) onValueChange(event.target.value);
    else onChange?.(event);
  };

  const emitValue = nextValue => {
    if (onValueChange) onValueChange(nextValue);
    else onChange?.({
      target: { value: nextValue, name: props.name, id: props.id },
      currentTarget: { value: nextValue, name: props.name, id: props.id },
    });
  };

  const undo = () => {
    if (undoValue === null) return;
    emitValue(undoValue);
    setUndoValue(null);
    toast.success("Original text restored.");
  };

  const toggleExpanded = () => {
    if (textareaRef.current) textareaRef.current.style.height = "";
    setExpanded(current => !current);
  };

  return (
    <div className="overflow-hidden rounded-md border border-slate-300 bg-white shadow-sm transition focus-within:border-slate-900 focus-within:ring-1 focus-within:ring-slate-900">
      <PlainTextarea
        {...props}
        ref={textareaRef}
        value={value}
        aria-busy={rewriting}
        disabled={disabled || rewriting}
        onChange={change}
        className={cn(
          "max-h-[60dvh] resize-none rounded-none border-0 shadow-none focus-visible:ring-0 sm:resize-y",
          className,
          expanded && "min-h-[45dvh]",
        )}
      />
      <div className="flex min-h-11 items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-1.5 py-1">
        <div className="flex min-w-0 items-center gap-1">
          {user ? <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-9 px-2.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 hover:text-amber-900"
            disabled={disabled || rewriting || !value.trim()}
            onClick={rewrite}
          >
            <Sparkles className={cn("mr-1.5 h-4 w-4", rewriting && "animate-pulse")} />
            {rewriting ? "Rewriting…" : "AI Rewrite"}
          </Button> : null}
          {undoValue !== null && (
            <Button type="button" variant="ghost" size="sm" className="min-h-9 px-2 text-xs" disabled={disabled || rewriting} onClick={undo}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />Undo
            </Button>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-9 shrink-0 px-2 text-xs text-slate-600"
          disabled={disabled || rewriting}
          aria-expanded={expanded}
          onClick={toggleExpanded}
        >
          {expanded ? <Minimize2 className="mr-1.5 h-3.5 w-3.5" /> : <Maximize2 className="mr-1.5 h-3.5 w-3.5" />}
          {expanded ? "Collapse" : "Expand"}
        </Button>
      </div>
      <span className="sr-only" aria-live="polite">{rewriting ? "AI is rewriting this text." : ""}</span>
    </div>
  );
});
AIRewriteTextarea.displayName = "AIRewriteTextarea";

export default AIRewriteTextarea;
