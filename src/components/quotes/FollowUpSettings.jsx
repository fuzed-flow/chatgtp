import React, { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Bell, Settings } from "lucide-react";

export default function FollowUpSettings({ form, setForm }) {
  const [showTemplate, setShowTemplate] = useState(false);

  return (
    <Card className="p-5 mb-4 bg-gradient-to-br from-blue-50 to-blue-100 border-2 border-blue-300 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
          <Bell className="h-5 w-5 text-blue-600" />
          Automated Follow-Up Reminders
        </h3>
      </div>

      {/* Enable Toggle */}
      <div className="mb-4 flex items-center gap-3 p-3 bg-white rounded border border-blue-200">
        <input
          type="checkbox"
          checked={form.enable_follow_ups || false}
          onChange={(e) => setForm({ ...form, enable_follow_ups: e.target.checked })}
          className="rounded border-blue-300 cursor-pointer"
          id="enable-follow-ups"
        />
        <Label htmlFor="enable-follow-ups" className="cursor-pointer text-slate-900 font-medium">
          Enable automatic follow-up reminders for this quote
        </Label>
      </div>

      {form.enable_follow_ups && (
        <div className="space-y-4">
          {/* Configuration Grid */}
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <Label className="text-slate-900 font-medium">Days Until First Follow-Up</Label>
              <p className="text-xs text-slate-600 mb-2">After quote is sent</p>
              <Input
                type="number"
                value={form.follow_up_days || 7}
                onChange={(e) => setForm({ ...form, follow_up_days: Number(e.target.value) })}
                className="bg-white text-slate-900"
                min="1"
              />
            </div>
            <div>
              <Label className="text-slate-900 font-medium">Days Between Follow-Ups</Label>
              <p className="text-xs text-slate-600 mb-2">Interval for subsequent reminders</p>
              <Input
                type="number"
                value={form.follow_up_interval_days || 3}
                onChange={(e) => setForm({ ...form, follow_up_interval_days: Number(e.target.value) })}
                className="bg-white text-slate-900"
                min="1"
              />
            </div>
            <div>
              <Label className="text-slate-900 font-medium">Maximum Reminders</Label>
              <p className="text-xs text-slate-600 mb-2">Stop after this many follow-ups</p>
              <Input
                type="number"
                value={form.follow_up_max_reminders || 3}
                onChange={(e) => setForm({ ...form, follow_up_max_reminders: Number(e.target.value) })}
                className="bg-white text-slate-900"
                min="1"
                max="10"
              />
            </div>
          </div>

          {/* Template Section */}
          <div className="border-t border-blue-200 pt-4">
            <button
              onClick={() => setShowTemplate(!showTemplate)}
              className="flex items-center gap-2 text-slate-900 font-medium mb-3 hover:text-blue-600"
            >
              <Settings className="h-4 w-4" />
              {showTemplate ? "Hide" : "Customize"} Email Template
            </button>

            {showTemplate && (
              <div className="space-y-3 p-3 bg-white rounded border border-blue-200">
                <div>
                  <Label className="text-slate-900 font-medium">Email Subject</Label>
                  <Input
                    value={(form.follow_up_template || "").split('\n')[0] || ""}
                    onChange={(e) => {
                      const lines = (form.follow_up_template || "").split('\n');
                      lines[0] = e.target.value;
                      setForm({ ...form, follow_up_template: lines.join('\n') });
                    }}
                    placeholder="Reminder: {quote_title} Quote"
                    className="bg-white text-slate-900"
                  />
                  <p className="text-xs text-slate-500 mt-1">Use {'{quote_title}'} for quote name</p>
                </div>
                <div>
                  <Label className="text-slate-900 font-medium">Email Body</Label>
                  <Textarea
                    value={(form.follow_up_template || "").split('\n').slice(1).join('\n')}
                    onChange={(e) => {
                      const subject = (form.follow_up_template || "").split('\n')[0] || "";
                      setForm({ ...form, follow_up_template: subject + '\n' + e.target.value });
                    }}
                    rows={4}
                    placeholder="Hi {client_name},&#10;&#10;Following up on the quote we sent...&#10;&#10;Best regards"
                    className="bg-white text-slate-900"
                  />
                  <p className="text-xs text-slate-500 mt-1">Use {'{client_name}'} and {'{quote_title}'} as placeholders</p>
                </div>
              </div>
            )}
          </div>

          {/* Info Box */}
          <div className="bg-white p-3 rounded border border-blue-200 text-sm text-slate-700">
            <p className="font-medium mb-1">📧 How it works:</p>
            <ul className="list-disc list-inside space-y-0.5 text-xs">
              <li>Reminders only send for quotes with "Sent" status</li>
              <li>Stops automatically if quote is Approved or Declined</li>
              <li>Runs daily in the background</li>
              <li>All follow-ups are tracked and visible in the history</li>
            </ul>
          </div>
        </div>
      )}
    </Card>
  );
}