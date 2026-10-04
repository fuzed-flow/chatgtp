import { supabase } from "@/api/supabaseClient";

export function normalizeAllocation(record, sourceTable) {
  return {
    ...record, source_table: sourceTable,
    allocated_hours: record.allocated_hours ?? 0,
    utilization_percentage: sourceTable === "resource_allocations" ? record.allocation_percentage : record.utilization_percentage,
    allocation_start_date: sourceTable === "resource_allocations" ? record.start_date : record.allocation_start_date,
    allocation_end_date: sourceTable === "resource_allocations" ? record.end_date : record.allocation_end_date,
  };
}

export async function getProjectAllocations(companyId, projectId) {
  const sources = ["project_allocations", "resource_allocations"];
  const results = await Promise.all(sources.map(table => supabase.from(table).select("*").eq("company_id", companyId).eq("project_id", projectId)));
  const error = results.find(result => result.error)?.error;
  if (error) throw error;
  return results.flatMap((result, index) => (result.data || []).map(record => normalizeAllocation(record, sources[index])));
}

export function allocationPayload(data, sourceTable) {
  const payload = {
    task_id: data.task_id === "none" ? null : data.task_id,
    user_id: data.user_id,
    allocated_hours: Number(data.allocated_hours) || 0,
  };
  if (sourceTable === "resource_allocations") {
    return { ...payload, allocation_percentage: Number(data.utilization_percentage), start_date: data.allocation_start_date || null, end_date: data.allocation_end_date || null };
  }
  return { ...payload, utilization_percentage: Number(data.utilization_percentage), allocation_start_date: data.allocation_start_date || null, allocation_end_date: data.allocation_end_date || null };
}
