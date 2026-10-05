import React, { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

const complete = status => ["done", "completed", "complete"].includes(String(status || "").toLowerCase());

export default function TaskWorkflowPanel({ task, sourceTable = "project_tasks" }) {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [comment, setComment] = useState("");
  const [prerequisite, setPrerequisite] = useState("none");
  const lock = useRef(false);
  const key = ["task_workflow", profile?.company_id, profile?.id, profile?.role, sourceTable, task?.id];
  useEffect(() => { setComment(""); setPrerequisite("none"); }, [task?.id, sourceTable]);
  const workflow = useQuery({
    queryKey: key, enabled: !!task?.id && !!profile?.company_id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_task_workflow", { p_table: sourceTable, p_task: task.id });
      if (error) throw error;
      return data;
    },
  });
  const save = useMutation({
    mutationFn: async action => {
      try {
        let result;
        if (action === "comment") {
          if (!comment.trim()) return false;
          result = await supabase.from("task_comments").insert({ company_id: profile.company_id, user_id: profile.id, source_table: sourceTable, task_id: task.id, body: comment.trim() });
        } else if (action === "dependency") {
          if (prerequisite === "none") return false;
          result = await supabase.from("task_dependencies").insert({ company_id: profile.company_id, project_id: task.project_id, task_id: task.id, depends_on_task_id: prerequisite, dependency_type: "Finish-to-Start" });
        } else {
          result = await supabase.from("task_dependencies").delete().or(`company_id.eq.${profile.company_id},company_id.is.null`).eq("task_id", task.id).eq("id", action.id).select("id");
          if (!result.error && !result.data?.length) throw new Error("This prerequisite changed. Reload the task before removing it.");
        }
        if (result.error) throw result.error;
        return true;
      } finally { lock.current = false; }
    },
    onSuccess: saved => {
      if (!saved) return;
      setComment(""); setPrerequisite("none");
      qc.invalidateQueries({ queryKey: key });
      toast.success("Task update saved");
    },
    onError: error => toast.error(error.message || "Could not save this task update. Please retry."),
  });
  const requestSave = action => {
    if (lock.current) return;
    lock.current = true;
    save.mutate(action);
  };
  if (workflow.isPending) return <p className="text-sm text-slate-500">Loading task discussion...</p>;
  if (workflow.isError) return <div role="alert" className="space-y-2 text-sm text-red-700">Task discussion could not load.<Button type="button" variant="outline" onClick={() => workflow.refetch()}>Try again</Button></div>;
  const data = workflow.data || {};
  const dependencies = data.dependencies || [];
  const options = (data.options || []).filter(option => !dependencies.some(dependency => dependency.task_id === option.id));
  return (
    <section className="space-y-4 border-t border-slate-200 pt-4">
      {sourceTable === "project_tasks" && (
        <div className="space-y-2">
          <h4 className="font-semibold text-slate-900">Prerequisites</h4>
          <p className="text-xs text-slate-500">A task becomes ready when all saved prerequisites are complete.</p>
          {dependencies.length > 0 ? dependencies.map(dependency => (
            <div key={dependency.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 p-2 text-sm">
              <span className="min-w-0 break-words">{dependency.title} · {complete(dependency.status) ? "Complete" : "Waiting"}</span>
              {data.can_edit_dependencies && <Button type="button" variant="ghost" className="min-h-11 shrink-0 text-red-700" disabled={save.isPending} onClick={() => requestSave({ id: dependency.id })} aria-label={`Remove prerequisite ${dependency.title}`}>Remove</Button>}
            </div>
          )) : <p className="text-sm text-slate-500">No prerequisites.</p>}
          {data.can_edit_dependencies && options.length > 0 && <div className="flex flex-col gap-2 sm:flex-row">
            <Select value={prerequisite} disabled={save.isPending} onValueChange={setPrerequisite}>
              <SelectTrigger aria-label="Task prerequisite" className="min-h-11 bg-white"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="none">Choose a prerequisite</SelectItem>{options.map(option => <SelectItem key={option.id} value={option.id}>{option.title}</SelectItem>)}</SelectContent>
            </Select>
            <Button type="button" className="min-h-11 shrink-0 bg-amber-500 text-slate-900 hover:bg-amber-600" disabled={save.isPending || prerequisite === "none"} onClick={() => requestSave("dependency")}>Add prerequisite</Button>
          </div>}
        </div>
      )}
      <div className="space-y-3">
        <h4 className="font-semibold text-slate-900">Task discussion</h4>
        {(data.comments || []).map(item => <div key={item.id} className="rounded-lg border border-slate-200 p-3 text-sm"><p className="mb-1 font-semibold">{item.name || "Team member"}</p><p className="whitespace-pre-wrap break-words text-slate-700">{item.body}</p></div>)}
        <Label htmlFor={`task-comment-${task.id}`}>Add a comment</Label>
        <Textarea id={`task-comment-${task.id}`} value={comment} maxLength={4000} disabled={save.isPending} onChange={event => setComment(event.target.value)} rows={3} placeholder="Share a task update with the team" />
        <Button type="button" className="min-h-11 bg-amber-500 text-slate-900 hover:bg-amber-600" disabled={save.isPending || !comment.trim()} onClick={() => requestSave("comment")}>{save.isPending ? "Saving..." : "Post comment"}</Button>
      </div>
    </section>
  );
}
