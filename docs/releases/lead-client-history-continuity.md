# Lead to client history continuity

When a lead becomes a client, retain the original communication, reminder and task records under the client. Preserve message IDs, delivery callbacks, answered status, deadlines, assignment, timestamps and provider reply tokens. Existing notes, attachments and quote conversion keep their current behavior.

The database migration handles manual and quote-driven conversion, repairs already-linked leads within the same company, and routes late inserts and provider registrations to the saved client. It fills missing client email/phone values from the lead while retaining populated client values. It does not delete the source lead or change pipeline reporting.

Client Detail reads both existing client project tasks and the original CRM task records. Edits, status changes and deletion target the correct table and include company/client filters. Task edits preserve unchanged timestamps, multiple project assignees and zero estimated hours.

## Validation

- 103 focused checks passed: lead conversion, historical repair, repeat conversion, email/SMS replies to earlier messages, delivery callbacks, late provider registration, company boundaries, client task CRUD, existing SMS components and provider behavior.
- Production build passed. Targeted lint has no errors (four existing unused-variable warnings in ClientDetail).
- Wider regression suite: 265/272 passed. The same seven failures reproduce on the unchanged production commit `2a9ccbb49f98a1bea68c64753788c08aebcb7c07` (five invoice reminder authentication fixtures and two public change-order decision fixtures).
- The live read-only preflight found one linked lead and zero communications, reminders or tasks needing repair at that time.
- Tests use synthetic local data. No actual SMS/email was sent. Browser verification was unavailable because the browser session could not start.

## Release

Apply `20261102145045_lead_client_history_continuity.sql` to Supabase before releasing the frontend. No Edge Function deployment or secret changes are needed. Verify that a converted lead's client shows the original task and communication records, and that a reply to an earlier message reaches that client's communication history.
