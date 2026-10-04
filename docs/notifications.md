# Role-based in-app notifications

This release extends the existing bell and notification centre. It uses private rows per recipient, three priority levels, the Unread/All/Mentions/Projects/Financial/Action Required filters, paginated history, consistent read state, and a personal action-only preference. The preference filters both the feed and unread badge; it does not delete history.

## Delivery and access

Owners and administrators receive company-level events. Office staff receive events for their permitted modules. Project managers receive project events for assigned projects and allowed modules. Employees and subcontractors receive their own assignments, timesheet/expense decisions, mentions, and personal security alerts. Invoice/payment alerts are limited to owners, administrators, and office staff. Inactive users are excluded. Read access rechecks current permissions so role revocation also restricts historical notifications.

Database triggers create internal alerts; public document activity uses the validated company-notifier relay. Client-side notification inserts were removed. Duplicate payments, document views, change requests, and reminder runs are deduplicated. Internal document previews do not count as client views. Realtime updates refresh the feed; a 60-second poll is the fallback.

## Working event sources

| Area | Supported events |
| --- | --- |
| Projects and tasks | Project creation, staff assignment, status/date/budget changes, milestone completion, task creation/assignment/reassignment/completion, due-today and overdue reminders |
| Quotes | Creation, review status, sent/approved/declined/expired status, revisions, conversion to a project, client views/change requests, saved optional-item selections |
| Change orders | Creation, review/approval/decline status, revisions, client views/change requests, successful project-budget sync |
| Invoices and payments | Creation, sent status, revisions, recorded payments/partial payments, due-soon and overdue reminders; payment-failed status if recorded by a source workflow |
| Scheduling | Event creation/change/cancellation, subcontractor scheduling/rescheduling, tomorrow's scheduled-work reminders, inspection/site-meeting timeline entries |
| Daily logs and communication | Log submission, photos, safety concerns, blockers, weather-delay text, completed-work categories, project comments, explicit mentions, incoming client messages |
| Timesheets and expenses | Submitted/pending, approved, rejected; missing submissions only with explicit resource allocation and scheduled work; approved weekly payroll hours |
| Documents | Uploads and file changes on existing document/resource/permit tables, inspection-report document types |
| Subcontractors and materials | Added/invited, quote-received status, work accepted/declined/completed, insurance-expiry reminders, recorded material readiness/backorders |
| Inventory and financials | Stock thresholds and recorded transactions; budget and labour allowance thresholds; expense/profit impact and significant stored budget-margin changes |
| Users and security | Invitations, user/profile changes, roles/permissions, deactivation/removal, settings/subscription changes; password/email/MFA changes and unfamiliar stored session user agents |

## Limits and follow-up work

These are in-app alerts, not a new phone push-notification system. Existing company email/SMS preferences remain separate from the personal in-app action-only setting.

The app does not currently provide complete warranty-claim handling, general document e-signing/review, standalone client selections with deadlines/allowances, direct team messaging/replies/announcements, WCB-expiry tracking, client-portal login tracking, final-invoice classification, per-category budget thresholds, PM-hour caps, or failed-login event ingestion. Those events need source workflows or fields before working notifications can be added. Basic project issues exist; resolving them produces a completion alert, but this is not a warranty-claims module. Quote/change-order approval is supported and is separate from capturing a signed document. Inspection scheduling exists; a dedicated inspection-result workflow is not added here.

Security changes are fail-open for the notification operation so an alert failure cannot block sign-in, account recovery, or MFA. A changed browser user agent is a heuristic, not a verified new-device identity. Existing source-table authorization and unrelated legacy security-advisor findings are outside this notification release; it does not claim a complete app security audit.

Reminders run hourly at minute 10, after 8 AM in the company timezone. Invalid or missing timezones fall back to America/Edmonton. Repeated runs create one reminder per relevant due date/threshold. Missing submissions are never inferred for every employee merely because a date has passed. Budget checks currently compare approved expenses with the stored total cost budget; labour checks compare approved time with estimated task hours.

## Verification and rollout

Run `node --test tests/notifications/notifications.test.mjs` and `npm run build`. Database tests use synthetic records in two companies and all six roles, checking real SQL RLS/column grants, self-promotion denial, role revocation, tenant isolation, links, read state, portal deduplication, reminders, legacy null read state, and expansion of the legacy role constraint.

The browser fixture in tests/notifications/browser uses synthetic data only and is not included in the normal production bundle. Apply the SQL migration, deploy company-notifier with its existing public-portal JWT configuration, then deploy the frontend. Validate notification grants/triggers/cron and verify the Vercel production commit. The public relay retains existing shared-document access conventions; public-link authentication is not redesigned in this release.
