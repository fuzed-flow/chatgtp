# Lead and client SMS communication

Run `node --test tests/contact-sms/communication.test.mjs tests/sales-notifications/sms-send.test.mjs tests/sales-notifications/provider-callbacks.test.mjs tests/sales-notifications/domain.test.mjs`.
The tests mount the actual communication panel and execute the production SMS handlers with synthetic provider calls and a disposable PostgreSQL database. They never send real texts.

Build the application with `npm run build`. Build the isolated demonstration with `npx vite build --config tests/contact-sms/browser/vite.config.mjs`.
The demonstration mounts the actual panel with in-memory contact records. Its phone frame has a real 390px viewport. Send SMS only adds a sample history entry.

This change uses the existing authenticated `send-sms` Edge Function, signed `sms-events` webhook, and company-scoped history. No migration or provider configuration change is required by this UI release. Existing Twilio inbound webhook configuration and the account's `communication_reply_status` determine whether automatic incoming reply capture is available. A real account send/receive round trip has not been performed.
