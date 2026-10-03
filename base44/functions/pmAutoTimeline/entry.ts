import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json();
    const { event, data, old_data } = payload;

    if (!data) return Response.json({ ok: true, skipped: "no data" });

    const entityName = event?.entity_name;
    const eventType = event?.type;

    if (eventType !== "update") return Response.json({ ok: true, skipped: "not update" });

    let timelineEntry = null;

    // Phase completed → client visible event if client_visible
    if (entityName === "PMPhase" && data.status === "Completed" && old_data?.status !== "Completed") {
      timelineEntry = {
        project_id: data.project_id,
        phase_id: data.id,
        event_date: new Date().toISOString().split("T")[0],
        title: `Phase Completed: ${data.name}`,
        category: "Phase",
        visibility: data.client_visible ? "Client Visible" : "Internal Only",
        details: `Phase "${data.name}" has been marked as completed.`
      };
    }

    // Milestone completed
    if (entityName === "PMMilestone" && data.status === "Completed" && old_data?.status !== "Completed") {
      timelineEntry = {
        project_id: data.project_id,
        phase_id: data.phase_id || null,
        event_date: new Date().toISOString().split("T")[0],
        title: `Milestone Reached: ${data.title}`,
        category: "Milestone",
        visibility: data.client_visible ? "Client Visible" : "Internal Only",
        details: data.description || `Milestone "${data.title}" completed.`
      };
    }

    // Material delivered
    if (entityName === "PMMaterialScheduleItem" && data.status === "Delivered" && old_data?.status !== "Delivered") {
      timelineEntry = {
        project_id: data.project_id,
        phase_id: data.phase_id || null,
        event_date: new Date().toISOString().split("T")[0],
        title: `Materials Delivered: ${data.custom_material_name || "Material"}`,
        category: "Material",
        visibility: "Internal Only",
        details: `${data.quantity} ${data.unit} of "${data.custom_material_name || "material"}" delivered${data.supplier ? " from " + data.supplier : ""}.`
      };
    }

    // Subcontractor status changed to Scheduled, On Site, or Completed
    if (entityName === "PMProjectSubcontractor" && ["Scheduled", "On Site", "Completed"].includes(data.status) && data.status !== old_data?.status) {
      timelineEntry = {
        project_id: data.project_id,
        phase_id: data.phase_id || null,
        event_date: new Date().toISOString().split("T")[0],
        title: `Subcontractor ${data.status}`,
        category: "Subcontractor",
        visibility: "Internal Only",
        details: `Subcontractor status changed to "${data.status}".${data.role_notes ? " " + data.role_notes : ""}`
      };
    }

    if (timelineEntry) {
      await base44.asServiceRole.entities.PMTimelineEvent.create(timelineEntry);
      console.log("Created timeline event:", timelineEntry.title);
    }

    return Response.json({ ok: true, created: !!timelineEntry });
  } catch (error) {
    console.error("pmAutoTimeline error:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});