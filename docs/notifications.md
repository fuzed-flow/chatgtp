# Subscriber notifications

This release adds the missing event sources and the workflows subscribers need to act on them. Future notifications name the trusted actor, saved record and date, for example: “Gary Byrne created lead Tim Rich on October 2, 2026.” Dates use the company timezone. Automated events use Fuzed Flow; validated customer actions use the saved contact. Historical alerts retain their original wording rather than inventing an actor.

## Coverage

| Area | Added notifications and workflows |
| --- | --- |
| Leads and clients | Assignment, follow-up, won/lost, conversion, incoming replies, unanswered messages and client reminders |
| Sales documents | Separate internal review and customer acceptance, expiry, deadlines, follow-ups, confirmed sends, copies, receipts and delivery failures |
| Payments and subscriptions | Confirmed deposits and invoice payments, partial payments, failures, refunds, disputes, renewal reminders, card expiry and usage limits |
| Projects and tasks | Start dates, phases, prerequisites, milestones, staff removal, priority/due changes, comments and dependencies |
| People and field work | Leave decisions, approved-leave exclusions, allocated submission reminders, missing clock-out, overtime and PM-hour caps; structured daily-log safety, weather and blocker review |
| Purchasing and trades | PO acknowledgement, delay, partial delivery, cancellation and over-approved cost; trade invitation/response and vendor insurance/certificate expiry |
| Equipment and costs | Reservations, checkout requests, returns, conflicts, maintenance and condition; atomic material usage/refunds; category, committed and labour budgets |
| Warranty and documents | Claims, repair visits, customer updates and closure; review/signature requests, expiry, immutable audit and document snapshot; drawing revisions |
| Permits and inspections | Status, information requests, expiry, inspection schedules and results |
| Support and updates | Private subscriber support threads, support replies/resolution and platform feature/help/service announcements |

Notifications link to the saved record on desktop and mobile. Field staff can open assigned projects, plans and phases without an HR-plan upgrade. Personal staff decisions open their own employee portal rather than restricted management screens.

## Delivery and access

Existing role and module routing remains in place. Owners/admins receive company events; office staff receive permitted modules; managers receive assigned projects; field staff receive their own work. Inactive users and revoked permissions are rechecked. Finance details remain restricted. Public customer/trade response tokens expose only a projected request and cannot list internal tables.

In-app alerts remain automatic. Personal email, SMS, browser/phone push and daily/weekly summaries are opt-in in notification settings. Quiet hours, categories and timezones are configurable. Settings capture future events and do not replay historical alerts. A private leased outbox prevents duplicate sends; delivery failures produce a private in-app alert and cannot recursively send themselves.

Reminders run through the existing hourly minute-10 company-timezone schedule. Allocated-work reminders exclude approved leave. The delivery dispatcher is activated separately after the complete release is approved and deployed. Push requires browser permission and a registered device; phone availability depends on browser support.

## Verification

Tests use synthetic tenants, users, saved documents and mocked provider responses. They exercise SQL policies/triggers/RPCs, real handler authentication/signatures/replay behavior, actor/date formatting, confirmation of accepted sends, record destinations, permission changes, summaries and UI workflows. No customer messages, payments or live test notifications are sent.

See [notification-release.md](notification-release.md) for rollout status, exact production approval scope and external receiving-email DNS requirements.
