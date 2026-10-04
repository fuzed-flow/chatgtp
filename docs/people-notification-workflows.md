# People, tasks and project workflow notifications

Implementation migration: `20261004174541_people_pm_task_workflows.sql`. Apply after the existing role-based notification migration. It adds domain triggers and reminder helpers; the existing `source_event`, `row_event` and `emit` functions remain the canonical notification transport.

## User workflows

| Workflow | Where to use it | Stored context and event |
|---|---|---|
| Task changes and discussion | Tasks → Details, employee Tasks → task details, or PM Staff & Tasks → Edit task | Priority and due-date changes notify task assignees and permitted management. **Post comment** stores the current author, company and task; failed saves retain the draft. |
| Task readiness | Production task details → **Prerequisites** → **Add prerequisite** | Same-project production tasks only. Removing a prerequisite is company/task scoped. Completion of the final prerequisite emits `task_dependency_ready`; it does not silently change task status. Cycles, duplicates and cross-project links are rejected. |
| Daily work and site concerns | Employee Portal → Project Notes → **Submit New Log**; PM workspace → Daily Logs → create/edit | Assigned project and authoritative company/user IDs are saved. **Log category** supports Work Completed, General, Site Issue and Safety. **Weather delayed or stopped work** records an explicit delay. PM **Safety review** and **Issue review** support Open, Acknowledged and Resolved when the associated concern is present. Photo replacements/removals have a separate change event. |
| Time off | Employee Portal → My Time Off → **Request Time Off**; Human Resources → Time Off | Requests store the employee UUID, inclusive dates and Pending status. **Cancel Request** changes Pending to Cancelled and keeps the history. HR decisions notify that employee. Ambiguous older records require **Link employee before approval**; known employee identities cannot be reassigned. |
| Phase readiness | PM workspace → Phases → expanded phase or new phase → **Prerequisite phase** | Same-project, acyclic phase dependencies. **Ready** requires the prerequisite to be complete. Completion emits readiness for dependent unfinished phases. Status/date/lead/dependency changes emit `phase_changed`. |
| Field phase and plan review | Employee Portal → **My Projects** | Assigned projects show **Project phases**, their dates/status and saved prerequisite completion. A phase notification selects its exact phase. The plans view provides the assigned project's read-only drawings and revisions. Field staff review the schedule with their manager before starting work. |
| Staff and management allowances | PM workspace → Staff & Tasks → **Project management hours** | Assigned management staff can have an optional positive **hour cap**. Eligible managers and office staff submit their own management time with **Submit management hours**; these are Pending manual time entries requiring the normal HR approval process. Caps compare submitted/approved management hours, with one alert at 90% and another above the cap. |
| Resource allowances | Project Details → Resource Allocation | Both `project_allocations` and older `resource_allocations` are read consistently; editing preserves the original table. **Hours for this allocation period** is the saved allowance used for scheduled-hour alerts. Zero utilization remains zero. |

## Schema requirements

The migration adds `project_phases.depends_on_phase_id`, `project_staff.pm_hours_cap`, `resource_allocations.allocated_hours`, `time_entries.is_project_management`, `time_off_requests.user_id` and `approved_by`, plus daily-log `weather_delay`, `safety_status` and `blocker_status`. It creates `task_comments` and secures the existing production-only `task_dependencies` table. Existing columns such as `project_allocations.allocated_hours`, task priority/due fields, phase dates/status, daily-log concerns/photos and time-entry clock fields are reused.

The migration does not update or delete any existing leave or task-dependency rows. A name, even when unique today, is not durable proof of an older leave record's employee identity. Every existing leave row with a missing employee UUID therefore remains available to HR for explicit **Link employee before approval**; personal access is enabled only after that link is confirmed.

Valid legacy dependency context is derived read-only from its existing task UUIDs. Both tasks must belong to the same company/project, and any stored non-null company/project must agree. Valid null-context links remain visible to authorized task readers and participate in readiness/cycle checks. Invalid pairs remain stored but are quarantined from those workflow reads and checks. The private, service-only `notification_private.people_legacy_workflow_review` view identifies `identity_unlinked`, `context_derived` and `quarantined_dependency` records for explicit review; it does not rewrite or delete them. Future dependency writes validate and store canonical context, reject duplicates and cycles, and lock by the actual parent-task company.

Authenticated daily-log writes fill a missing company from the verified project only when the user explicitly saves that log; known company/project/author identities cannot be changed. Schema defaults add the new fields but do not reinterpret existing concerns, schedules, allowances or leave decisions.

## Scheduled integration and boundaries

The root scheduler must call both private functions with its timestamp:

```sql
notification_private.submission_reminders(p_now);
notification_private.people_reminders(p_now);
```

Remove the original missing-timesheet/daily-log allocation block when adding the submission helper, so there is one canonical submission check. Both helpers return the number of notifications emitted and deny direct public/anonymous/authenticated execution.

Checks use each company's valid timezone, falling back to America/Edmonton, and start at 08:00 local time. Missing submissions concern yesterday's actively allocated and scheduled workers, combine both allocation tables, and exclude approved leave. A timesheet in Cancelled/Rejected status does not satisfy the check. Daily logs are required for the allocated project. Upcoming projects are checked from today through three days ahead; incomplete milestones become overdue after their saved due date. An open Clocked In entry becomes a missing clock-out after 12 hours. Scheduled-hour overrun compares recorded submitted/approved hours against a positive saved allocation-period allowance. No allowance or cap means no speculative overrun alert.

Tenant and active-profile checks apply before emitting. Module permissions and current project assignment still constrain delivery. Task comments and task-change alerts target actual assignees plus authorized management rather than every field member. A personal staff-removal alert uses a user relationship so it remains readable after project access is removed. Time-off links require `LeaveRequest` routes `/HumanResources?tab=timeoff` for HR roles and `/EmployeePortal?tab=vacation_tracker` for field roles. Channel preferences and dispatcher behavior remain shared with all notifications; these workflows do not send client invitations or live mail themselves.

Phase landing links use `ProjectPhase` with PM tab `phases`, or `/EmployeePortal?tab=projects&notificationProject=PROJECT&notificationPhase=PHASE` for field staff. Management cap alerts use `ProjectStaff` with PM tab `staff` (**Staff & Tasks**). `missing_clock_out` leads field staff to `time_clock`, where the clock-out action exists. Task selection observes router search changes, so a second notification on the same mounted page replaces the first record without waiting for a query refresh.

The Employee Portal's HR plan gate applies to clock, timesheets, payroll, time off and expenses. Assigned projects, schedules, phases, plans, tasks, site notes, inventory and the profile remain reachable on Starter, subject to the existing company feature switches. Starter defaults to My Projects and shows operations on the mobile bottom navigation. Disabled sections remain blocked on direct notification links.

Clock entries use `employee_clock_entries` and manual shift history uses `employee_timesheets`, both keyed by company UUID and authenticated profile UUID. Reads use those UUIDs rather than employee names. Clock-out rereads the exact own open shift, calculates hours from its current saved clock-in, and confirms a conditional update matching company/user/id/status/clock-out-null/clock-in. A changed or concurrently ended shift reports an error rather than a false success. Each successful time write invalidates both own-person keys.

## Synthetic verification

`node --test tests/notifications/people-workflows.test.mjs tests/notifications/people-ui.test.mjs`

PGlite tests execute the real migrations against synthetic tenants and roles, including restrictive RLS over a legacy permissive policy, identity repair, self-approval rejection, graph cycles, all-prerequisite readiness, membership removal, leave exclusions, both allocation sources and reminder deduplication. React/JSDOM tests mount the actual workflow components with real React Query and mocked local Supabase responses; they verify stored payloads, scoped queries, preserved cancellation history, failed comment drafts and duplicate-submit prevention. No customer records or provider calls are used.

A pre-migration fixture snapshots existing leave/dependency records and the notification count, then applies the real domain migration. It verifies exact preservation of all existing stored fields, no automatic name-based reassignment, no migration-triggered notifications, working read-only legacy dependencies, hidden-but-retained invalid pairs, and explicit HR linking before personal decisions.

## Production review boundary

This migration remains pending explicit production rollout approval. Its persistent changes include the new columns/comment table, validated-write triggers, domain notification triggers, restrictive policies on comments/dependencies/leave/allocations, event-rule configuration and private reminder helpers. Removing the avoidable application-record backfills does not remove the need to approve those schema, authorization and scheduler changes. No live or indirect apply is part of the synthetic verification above.
