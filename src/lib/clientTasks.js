const TASK_TABLES = ["project_tasks", "tasks"];

export function clientTaskTable(task) {
  if (!TASK_TABLES.includes(task?._taskTable)) throw new Error("Task source is missing. Refresh and try again.");
  return task._taskTable;
}

export async function loadClientTasks(db, companyId, clientId) {
  const groups = await Promise.all(TASK_TABLES.map(async table => {
    const { data, error } = await db.from(table).select("*")
      .eq("company_id", companyId).eq("client_id", clientId).order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map(task => ({ ...task, _taskTable: table }));
  }));
  return groups.flat().sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

export function clientTaskUpdates(form) {
  const table = clientTaskTable(form);
  const assigned = !form.assigned_to || form.assigned_to === "none" ? null : form.assigned_to;
  const originalAssigned = form._originalAssignedTo;
  const firstAssigned = Array.isArray(originalAssigned) ? originalAssigned[0] : originalAssigned;
  const date = form.due_date_target || null;
  const originalDate = form._originalDueDate;
  return {
    title: form.title,
    description: form.description || null,
    project_id: !form.project_id || form.project_id === "none" ? null : form.project_id,
    status: form.status || "Pending",
    priority: form.priority || "Medium",
    estimated_hours: form.estimated_hours === "" || form.estimated_hours == null ? null : Number(form.estimated_hours),
    [table === "tasks" ? "due_date" : "due_date_target"]:
      date && originalDate?.slice(0, 10) === date ? originalDate : date,
    assigned_to: assigned === (firstAssigned || null) ? originalAssigned ?? null :
      table === "tasks" ? assigned : assigned ? [assigned] : null,
  };
}

export async function updateClientTask(db, companyId, clientId, task, changes) {
  const { error } = await db.from(clientTaskTable(task)).update(changes)
    .eq("id", task.id).eq("company_id", companyId).eq("client_id", clientId);
  if (error) throw error;
}

export async function deleteClientTask(db, companyId, clientId, task) {
  const { error } = await db.from(clientTaskTable(task)).delete()
    .eq("id", task.id).eq("company_id", companyId).eq("client_id", clientId);
  if (error) throw error;
}
