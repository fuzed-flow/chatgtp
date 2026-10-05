import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export default function LeaveIdentityPicker({ request }) {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const people = useQuery({
    queryKey: ["leave_identity_options", profile?.company_id], enabled: !!profile?.company_id,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id,full_name,email").eq("company_id", profile.company_id).or("is_active.is.null,is_active.eq.true");
      if (error) throw error;
      return data || [];
    },
  });
  const link = useMutation({
    mutationFn: async userId => {
      const { data, error } = await supabase.from("time_off_requests").update({ user_id: userId }).eq("company_id", profile.company_id).eq("id", request.id).is("user_id", null).select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("The request changed. Reload time off before linking its employee.");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["hr_time_off"] }); toast.success("Time off linked to the employee"); },
    onError: error => toast.error(error.message || "Could not link this employee."),
  });
  return <div className="mt-2 min-w-[180px] space-y-1"><Select value="none" disabled={link.isPending || people.isPending || people.isError} onValueChange={id => id !== "none" && link.mutate(id)}><SelectTrigger className="min-h-11" aria-label={`Link employee for ${request.employee_name || "time off request"}`}><SelectValue placeholder="Link employee before approval" /></SelectTrigger><SelectContent><SelectItem value="none">Link employee before approval</SelectItem>{(people.data || []).map(person => <SelectItem key={person.id} value={person.id}>{person.full_name || "Team member"}{person.email ? ` (${person.email})` : ""}</SelectItem>)}</SelectContent></Select>{people.isError && <p role="alert" className="text-xs text-red-700">Employees could not load.</p>}</div>;
}
