import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Activity, AlertTriangle, ChevronDown, ChevronUp, Mail, MessageSquare } from "lucide-react";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const FAILED_STATUSES = new Set(["failed", "bounced", "undelivered", "complained"]);

function activityText(item) {
  const label = item.related_label || item.subject || "Document";
  const action = item.delivery_kind === "receipt"
    ? "payment receipt sent"
    : item.delivery_kind === "followup"
      ? "reminder sent"
      : "sent";
  const channel = String(item.type || "").toLowerCase() === "sms" ? "by text" : "by email";
  const date = item.created_at ? format(new Date(item.created_at), "MM/dd/yyyy") : "unknown date";
  return `${label} ${action} ${channel} on ${date}`;
}

export default function ClientActivityPanel({ clientId, leadId }) {
  const { profile } = useAuth();
  const companyId = profile?.company_id;
  const partyId = leadId || clientId;
  const partyColumn = leadId ? "lead_id" : "client_id";
  const [visibleCount, setVisibleCount] = useState(5);

  const { data: activity = [], isError } = useQuery({
    queryKey: ["client-document-activity", companyId, partyColumn, partyId],
    enabled: !!companyId && !!partyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_communications")
        .select("id,type,subject,status,created_at,delivery_kind,related_type,related_id,related_label")
        .eq("company_id", companyId)
        .eq(partyColumn, partyId)
        .in("delivery_kind", ["document", "receipt", "followup"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  if (!isError && activity.length === 0) return null;
  const visibleActivity = activity.slice(0, visibleCount);

  return (
    <Card className="p-4 border-slate-200/80 shadow-sm bg-white rounded-xl">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-900 flex items-center gap-2">
            <Activity className="h-4 w-4 text-amber-500" /> Activity ({activity.length})
          </h3>
          <p className="mt-1 text-xs text-slate-500">Document delivery history</p>
        </div>
      </div>

      {isError ? (
        <p role="alert" className="text-sm text-red-700">Activity could not be loaded.</p>
      ) : (
        <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-slate-50/60">
          {visibleActivity.map(item => {
            const failed = FAILED_STATUSES.has(String(item.status || "").toLowerCase());
            const Icon = String(item.type || "").toLowerCase() === "sms" ? MessageSquare : Mail;
            const text = activityText(item);
            return (
              <div key={item.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <Icon className="h-4 w-4 shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1 truncate font-medium text-slate-700" title={text}>{text}</span>
                {failed ? (
                  <Badge className="shrink-0 border-red-200 bg-red-100 text-red-800 hover:bg-red-100">
                    <AlertTriangle className="mr-1 h-3 w-3" /> Failed
                  </Badge>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {activity.length > 5 ? (
        <div className="mt-3 flex justify-center">
          {visibleCount < activity.length ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setVisibleCount(activity.length)}>
              <ChevronDown className="mr-1 h-4 w-4" /> See all activity
            </Button>
          ) : (
            <Button type="button" variant="ghost" size="sm" onClick={() => setVisibleCount(5)}>
              <ChevronUp className="mr-1 h-4 w-4" /> Show less
            </Button>
          )}
        </div>
      ) : null}
    </Card>
  );
}
