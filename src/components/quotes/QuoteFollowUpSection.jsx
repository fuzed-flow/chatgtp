import React from "react";
import FollowUpSettings from "./FollowUpSettings";
import FollowUpHistory from "./FollowUpHistory";

export default function QuoteFollowUpSection({ form, setForm, followUpHistory = [] }) {
  return (
    <div className="space-y-4">
      <FollowUpSettings form={form} setForm={setForm} />
      {followUpHistory.length > 0 && (
        <FollowUpHistory followUpHistory={followUpHistory} />
      )}
    </div>
  );
}