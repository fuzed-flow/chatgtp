import React from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const COPY = {
  "internal_review:Approved": {
    title: "Approve this draft for sending?",
    body: "This records the internal approval and returns the document to Draft. It will still need to be sent to the client separately.",
    confirm: "Approve for sending",
  },
  "internal_review:Changes Required": {
    title: "Return this draft for changes?",
    body: "This records that changes are required and returns the document to Draft for editing.",
    confirm: "Return for changes",
    destructive: true,
  },
  "change_order:Approved": {
    title: "Approve this change order?",
    body: "This records the change order as approved. Confirm the scope and total before continuing.",
    confirm: "Approve change order",
  },
  "change_order:Rejected": {
    title: "Reject this change order?",
    body: "This records the change order as rejected and removes it from the pending decision queue.",
    confirm: "Reject change order",
    destructive: true,
  },
  "purchase_order:Approved": {
    title: "Approve this purchase order?",
    body: "This records the current total as the approved spending limit. Later increases will be flagged for review.",
    confirm: "Approve purchase order",
  },
  "purchase_order:Rejected": {
    title: "Reject this purchase order?",
    body: "This records the purchase order as rejected and removes it from the pending approval queue.",
    confirm: "Reject purchase order",
    destructive: true,
  },
};

export default function ApprovalDecisionDialog({ decision, busy, onOpenChange, onConfirm, formatCurrency }) {
  const content = decision ? COPY[`${decision.kind}:${decision.outcome}`] : null;
  return (
    <AlertDialog open={!!decision} onOpenChange={open => { if (!busy) onOpenChange(open); }}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{content?.title || "Confirm decision"}</AlertDialogTitle>
          <AlertDialogDescription className="space-y-3 text-left">
            <span className="block text-slate-700">{decision?.number || decision?.title || "Selected document"}{decision?.title && decision?.number ? ` · ${decision.title}` : ""}</span>
            {decision?.amount != null && <span className="block font-bold text-slate-900">{formatCurrency(decision.amount)}</span>}
            <span className="block">{content?.body}</span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={event => { event.preventDefault(); onConfirm(decision); }}
            className={content?.destructive ? "bg-red-600 text-white hover:bg-red-700" : "bg-amber-500 text-slate-950 hover:bg-amber-600"}
          >
            {busy ? "Saving…" : content?.confirm || "Confirm"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
