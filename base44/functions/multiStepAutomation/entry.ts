import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { automationId, triggerData } = await req.json();

    if (!automationId) {
      return Response.json({ error: 'Missing automationId' }, { status: 400 });
    }

    // Fetch automation and its steps
    const automation = await base44.asServiceRole.entities.Automation.get(automationId);
    const steps = await base44.asServiceRole.entities.AutomationStep.filter(
      { automation_id: automationId },
      'step_order'
    );

    if (!automation || !steps || steps.length === 0) {
      return Response.json({ error: 'Automation or steps not found' }, { status: 404 });
    }

    let executionResult = {
      automationId,
      startedAt: new Date().toISOString(),
      stepsExecuted: [],
      errors: [],
    };

    // Execute steps sequentially
    for (const step of steps) {
      if (!step.is_active) {
        executionResult.stepsExecuted.push({
          stepOrder: step.step_order,
          status: 'skipped',
          reason: 'Step inactive',
        });
        continue;
      }

      try {
        // Handle delays
        if (step.action_type === 'delay') {
          await new Promise((resolve) => setTimeout(resolve, (step.delay_seconds || 0) * 1000));
          executionResult.stepsExecuted.push({
            stepOrder: step.step_order,
            status: 'completed',
            action: 'delay',
          });
          continue;
        }

        // Handle conditionals
        if (step.action_type === 'conditional') {
          const conditionConfig = JSON.parse(step.condition_config || '{}');
          const conditionMet = evaluateCondition(conditionConfig, triggerData);

          if (!conditionMet) {
            executionResult.stepsExecuted.push({
              stepOrder: step.step_order,
              status: 'skipped',
              reason: 'Condition not met',
            });
            continue;
          }
        }

        // Execute action based on type
        let actionResult;
        const actionConfig = JSON.parse(step.action_config || '{}');

        switch (step.action_type) {
          case 'send_email':
            actionResult = await base44.asServiceRole.integrations.Core.SendEmail({
              to: actionConfig.to || triggerData.email,
              subject: actionConfig.subject,
              body: actionConfig.body,
              from_name: actionConfig.from_name,
            });
            break;

          case 'create_task':
            actionResult = await base44.asServiceRole.entities.Task.create({
              title: actionConfig.title,
              description: actionConfig.description,
              status: actionConfig.status || 'Pending',
              project_id: actionConfig.project_id || triggerData.project_id,
              assigned_to: actionConfig.assigned_to,
            });
            break;

          case 'update_entity':
            actionResult = await base44.asServiceRole.entities[actionConfig.entityName].update(
              actionConfig.entityId || triggerData.entity_id,
              actionConfig.updateData
            );
            break;

          case 'send_notification':
            actionResult = await base44.asServiceRole.entities.Notification.create({
              user_id: actionConfig.user_id || user.id,
              type: actionConfig.type,
              title: actionConfig.title,
              body: actionConfig.body,
              related_type: actionConfig.related_type,
              related_id: actionConfig.related_id || triggerData.entity_id,
              action_url: actionConfig.action_url,
            });
            break;

          case 'call_function':
            actionResult = await base44.asServiceRole.functions.invoke(actionConfig.functionName, {
              ...actionConfig.params,
              triggerData,
            });
            break;

          default:
            throw new Error(`Unknown action type: ${step.action_type}`);
        }

        executionResult.stepsExecuted.push({
          stepOrder: step.step_order,
          status: 'completed',
          action: step.action_type,
          result: actionResult,
        });
      } catch (stepError) {
        executionResult.stepsExecuted.push({
          stepOrder: step.step_order,
          status: 'failed',
          error: stepError.message,
        });
        executionResult.errors.push({
          step: step.step_order,
          error: stepError.message,
        });

        // Stop execution if critical error
        if (actionConfig.stopOnError) {
          break;
        }
      }
    }

    executionResult.completedAt = new Date().toISOString();

    return Response.json({
      success: executionResult.errors.length === 0,
      execution: executionResult,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});

function evaluateCondition(condition, data) {
  const { field, operator, value } = condition;

  if (!field || !operator) return true;

  const fieldValue = data[field];

  switch (operator) {
    case 'equals':
      return fieldValue === value;
    case 'not_equals':
      return fieldValue !== value;
    case 'contains':
      return String(fieldValue).includes(String(value));
    case 'greater_than':
      return Number(fieldValue) > Number(value);
    case 'less_than':
      return Number(fieldValue) < Number(value);
    case 'is_true':
      return Boolean(fieldValue);
    case 'is_false':
      return !Boolean(fieldValue);
    default:
      return true;
  }
}