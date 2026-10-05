import React, { useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2, RotateCcw, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

async function functionError(error) {
  let message = error?.message || "AI Rewrite is unavailable right now.";
  try {
    const payload = await error?.context?.json?.();
    if (payload?.error) message = payload.error;
  } catch { /* Keep the transport error when no JSON response is available. */ }
  return new Error(message);
}

export default function AIRewriteTextarea({
  value,
  onValueChange,
  rewriteField,
  disabled = false,
  className,
  ...props
}) {
  const [rewriting, setRewriting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [undoValue, setUndoValue] = useState(null);
  const requestId = useRef(0);
  const textareaRef = useRef(null);

  useEffect(() => () => { requestId.current += 1; }, []);

  const rewrite = async () => {
    const source = value.trim();
    if (!source) {
      toast.error("Add some text before using AI Rewrite.");
      return;
    }

    const currentRequest = ++requestId.current;
    setRewriting(true);
    try {
      const { data, error } = await supabase.functions.invoke("rewrite-text", {
        body: { text: source, field: rewriteField },
      });
      if (error) throw await functionError(error);
      if (typeof data?.text !== "string" || !data.text.trim()) throw new Error("AI Rewrite returned an empty response. Please try again.");
      if (currentRequest !== requestId.current) return;
      setUndoValue(value);
      onValueChange(data.text.trim());
      toast.success("Text rewritten. You can undo the change below.");
    } catch (error) {
      if (currentRequest === requestId.current) toast.error(error.message || "AI Rewrite is unavailable right now.");
    } finally {
      if (currentRequest === requestId.current) setRewriting(false);
    }
  };

  const change = event => {
    setUndoValue(null);
    onValueChange(event.target.value);
  };

  const undo = () => {
    if (undoValue === null) return;
    onValueChange(undoValue);
    setUndoValue(null);
    toast.success("Original text restored.");
  };

  const toggleExpanded = () => {
    if (textareaRef.current) textareaRef.current.style.height = "";
    setExpanded(current => !current);
  };

  return (
    <div className="overflow-hidden rounded-md border border-slate-300 bg-white shadow-sm transition focus-within:border-slate-900 focus-within:ring-1 focus-within:ring-slate-900">
      <Textarea
        {...props}
        ref={textareaRef}
        value={value}
        aria-busy={rewriting}
        disabled={disabled || rewriting}
        onChange={change}
        className={cn(
          "max-h-[60dvh] resize-none rounded-none border-0 shadow-none focus-visible:ring-0 sm:resize-y",
          expanded && "min-h-[45dvh]",
          className,
        )}
      />
      <div className="flex min-h-11 items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-1.5 py-1">
        <div className="flex min-w-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-9 px-2.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 hover:text-amber-900"
            disabled={disabled || rewriting || !value.trim()}
            onClick={rewrite}
          >
            <Sparkles className={cn("mr-1.5 h-4 w-4", rewriting && "animate-pulse")} />
            {rewriting ? "Rewriting…" : "AI Rewrite"}
          </Button>
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
}
