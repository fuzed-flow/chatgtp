import React, { useId } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function DailyLogWorkflowFields({ value, onChange, canReview = false, disabled = false }) {
  const id = useId();
  const update = patch => onChange({ ...value, ...patch });
  return (
    <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/50 p-3">
      <div>
        <Label htmlFor={`${id}-category`}>Log category</Label>
        <Select value={value.category || "General"} disabled={disabled} onValueChange={category => update({ category })}>
          <SelectTrigger id={`${id}-category`} className="mt-1 min-h-11 bg-white"><SelectValue /></SelectTrigger>
          <SelectContent>{["General", "Work Completed", "Site Issue", "Safety"].map(category => <SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium" htmlFor={`${id}-weather`}>
        <input id={`${id}-weather`} type="checkbox" className="h-4 w-4 accent-amber-500" checked={!!value.weather_delay} disabled={disabled} onChange={event => update({ weather_delay: event.target.checked })} />
        Weather delayed or stopped work
      </label>
      {canReview && [
        { field: "safety_status", content: "safety_concerns", label: "Safety review" },
        { field: "blocker_status", content: "blockers", label: "Issue review" },
      ].filter(item => value[item.content]?.trim()).map(item => (
        <div key={item.field}>
          <Label htmlFor={`${id}-${item.field}`}>{item.label}</Label>
          <Select value={value[item.field] || "Open"} disabled={disabled} onValueChange={status => update({ [item.field]: status })}>
            <SelectTrigger id={`${id}-${item.field}`} className="mt-1 min-h-11 bg-white"><SelectValue /></SelectTrigger>
            <SelectContent>{["Open", "Acknowledged", "Resolved"].map(status => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      ))}
    </div>
  );
}
