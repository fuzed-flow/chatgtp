import React from "react";
import { CheckCircle2, Eye, RotateCcw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import StatusBadge from "@/components/shared/StatusBadge";

const TYPE_LABELS = {
  internal_review: "Internal review",
  change_order: "Change order decision",
  purchase_order: "Purchase order approval",
};

export default function ApprovalQueueCard({ item, busy, onOpen, onDecision, formatCurrency, formatDate }) {
  const internal = item.kind === "internal_review";
  return (
    <Card className="border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">{TYPE_LABELS[item.kind]}</span>
            <StatusBadge status={item.status} />
          </div>
          <h3 className="mt-2 break-words text-base font-bold text-slate-950">{item.number || "Draft"} · {item.title || "Untitled document"}</h3>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
            {item.party && <span>{item.party}</span>}
            {item.project && <span>{item.project}</span>}
            {item.date && <span>{formatDate(item.date)}</span>}
            {item.amount != null && <span className="font-bold text-slate-900">{formatCurrency(item.amount)}</span>}
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row lg:justify-end">
          <Button variant="outline" className="min-h-11" onClick={() => onOpen(item)}>
            <Eye className="mr-2 h-4 w-4" /> Review
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            className="min-h-11 border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
            onClick={() => onDecision(item, internal ? "Changes Required" : "Rejected")}
          >
            {internal ? <RotateCcw className="mr-2 h-4 w-4" /> : <XCircle className="mr-2 h-4 w-4" />}
            {internal ? "Return for changes" : "Reject"}
          </Button>
          <Button disabled={busy} className="min-h-11 bg-amber-500 font-bold text-slate-950 hover:bg-amber-600" onClick={() => onDecision(item, "Approved")}>
            <CheckCircle2 className="mr-2 h-4 w-4" /> {internal ? "Approve for sending" : "Approve"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
