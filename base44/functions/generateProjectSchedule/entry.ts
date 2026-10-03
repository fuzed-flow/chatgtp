import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { project_id } = await req.json();

    if (!project_id) {
      return Response.json({ error: 'project_id required' }, { status: 400 });
    }

    // Fetch project data
    const projects = await base44.entities.Project.filter({ id: project_id });
    const project = projects[0];

    if (!project) {
      return Response.json({ error: 'Project not found' }, { status: 404 });
    }

    // Fetch related data
    const [tasks, users, allocations, dependencies, quote] = await Promise.all([
      base44.entities.Task.filter({ project_id }),
      base44.entities.User.list(),
      base44.entities.ResourceAllocation.filter({ project_id }),
      base44.entities.TaskDependency.filter({ project_id }),
      project.quote_id ? base44.entities.Quote.filter({ id: project.quote_id }).then(q => q[0]) : null
    ]);

    // Fetch quote phases if quote exists
    let quotePhases = [];
    let quoteItems = [];
    if (quote) {
      [quotePhases, quoteItems] = await Promise.all([
        base44.entities.QuotePhase.filter({ quote_id: quote.id }, "sort_order"),
        base44.entities.QuoteLineItem.filter({ quote_id: quote.id })
      ]);
    }

    // Build context for AI
    const projectContext = {
      project: {
        name: project.name,
        status: project.status,
        start_date: project.start_date,
        target_end_date: project.target_end_date,
        budget: project.budget,
        site_address: project.site_address
      },
      existing_tasks: tasks.map(t => ({
        title: t.title,
        status: t.status,
        priority: t.priority,
        assigned_to: t.assigned_to,
        due_date: t.due_date,
        estimated_hours: t.estimated_hours,
        actual_hours: t.actual_hours
      })),
      quote_phases: quotePhases.map(p => ({
        name: p.phase_name,
        scope: p.scope_of_work,
        items_count: quoteItems.filter(i => i.phase_id === p.id).length
      })),
      available_resources: users.map(u => ({
        id: u.id,
        name: u.full_name,
        role: u.role || u.user_role,
        current_allocations: allocations.filter(a => a.user_id === u.id).length
      })),
      dependencies: dependencies.map(d => ({
        task_id: d.task_id,
        depends_on_task_id: d.depends_on_task_id,
        dependency_type: d.dependency_type
      }))
    };

    const prompt = `You are an expert construction project manager. Analyze this project and generate an optimized schedule.

Project Context:
${JSON.stringify(projectContext, null, 2)}

Generate a comprehensive project schedule that includes:

1. **Timeline**: Optimal start and end dates for each task/phase
2. **Resource Assignments**: Assign tasks to available team members based on their current workload and role
3. **Bottleneck Analysis**: Identify potential scheduling conflicts, resource constraints, or dependency issues
4. **Task Breakdown**: If phases exist but tasks don't, break down phases into specific tasks with estimates

Consider:
- Construction project phases typically follow: Preparation → Foundation → Framing → Systems → Finishing
- Balance workload across team members
- Respect task dependencies and critical path
- Flag resource over-allocation or timeline conflicts
- Account for realistic work hours (40 hours/week per person)
- Current date: ${new Date().toISOString().split('T')[0]}

Return a detailed schedule plan with specific dates, assignments, and insights.`;

    const response = await base44.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: "object",
        properties: {
          timeline: {
            type: "object",
            properties: {
              project_start: { type: "string" },
              project_end: { type: "string" },
              total_working_days: { type: "number" }
            }
          },
          phases: {
            type: "array",
            items: {
              type: "object",
              properties: {
                phase_name: { type: "string" },
                start_date: { type: "string" },
                end_date: { type: "string" },
                tasks: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      description: { type: "string" },
                      assigned_to_name: { type: "string" },
                      assigned_to_id: { type: "string" },
                      start_date: { type: "string" },
                      due_date: { type: "string" },
                      estimated_hours: { type: "number" },
                      priority: { type: "string" },
                      dependencies: { type: "array", items: { type: "string" } }
                    }
                  }
                }
              }
            }
          },
          bottlenecks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string" },
                severity: { type: "string" },
                description: { type: "string" },
                affected_tasks: { type: "array", items: { type: "string" } },
                recommendation: { type: "string" }
              }
            }
          },
          resource_analysis: {
            type: "array",
            items: {
              type: "object",
              properties: {
                resource_name: { type: "string" },
                total_hours_allocated: { type: "number" },
                utilization_percentage: { type: "number" },
                status: { type: "string" }
              }
            }
          },
          insights: {
            type: "object",
            properties: {
              critical_path: { type: "array", items: { type: "string" } },
              recommended_adjustments: { type: "array", items: { type: "string" } },
              risk_factors: { type: "array", items: { type: "string" } }
            }
          }
        }
      }
    });

    console.log('AI Schedule Generated:', response);

    return Response.json({
      success: true,
      schedule: response,
      project_id
    });

  } catch (error) {
    console.error('Schedule generation error:', error);
    return Response.json({ 
      error: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
});