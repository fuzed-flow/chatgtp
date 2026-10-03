import React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Clock, CheckCircle, AlertCircle } from "lucide-react";

export default function FollowUpHistory({ followUpHistory = [] }) {
  if (followUpHistory.length === 0) {
    return (
      <Card className="p-5 mb-4 bg-gradient-to-br from-slate-50 to-slate-100 border-2 border-slate-300 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900 mb-3">Follow-Up History</h3>
        <div className="text-center py-6">
          <p className="text-slate-500 text-sm">No follow-ups sent yet</p>
        </div>
      </Card>
    );
  }

  const getStatusIcon = (status) => {
    switch (status) {
      case 'sent':
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'failed':
        return <AlertCircle className="h-4 w-4 text-red-600" />;
      default:
        return <Clock className="h-4 w-4 text-slate-400" />;
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'sent':
        return <Badge className="bg-green-100 text-green-800">Sent</Badge>;
      case 'failed':
        return <Badge className="bg-red-100 text-red-800">Failed</Badge>;
      case 'bounced':
        return <Badge className="bg-orange-100 text-orange-800">Bounced</Badge>;
      default:
        return <Badge className="bg-slate-100 text-slate-800">Unknown</Badge>;
    }
  };

  return (
    <Card className="p-5 mb-4 bg-gradient-to-br from-slate-50 to-slate-100 border-2 border-slate-300 shadow-sm">
      <h3 className="text-lg font-semibold text-slate-900 mb-4">Follow-Up History</h3>
      <div className="space-y-3">
        {followUpHistory.map((record, idx) => (
          <div key={idx} className="p-3 bg-white rounded border border-slate-200 hover:border-slate-400 transition-colors">
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                {getStatusIcon(record.status)}
                <div>
                  <p className="font-medium text-slate-900">
                    Follow-Up #{record.follow_up_number}
                  </p>
                  <p className="text-xs text-slate-500">
                    {format(new Date(record.sent_at), "MMM d, yyyy h:mm a")}
                  </p>
                </div>
              </div>
              {getStatusBadge(record.status)}
            </div>
            
            <div className="space-y-1 text-sm">
              <p className="text-slate-700"><span className="font-medium">To:</span> {record.email_sent_to}</p>
              <p className="text-slate-700"><span className="font-medium">Subject:</span> {record.subject}</p>
              {record.notes && (
                <p className="text-slate-600 text-xs"><span className="font-medium">Note:</span> {record.notes}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}