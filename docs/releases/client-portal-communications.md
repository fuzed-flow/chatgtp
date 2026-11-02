# Client portal communication history and messaging

Clients can read their own email/SMS conversation and send or reply by email or SMS from a Communications tab. Portal messages join the existing client conversation so office staff can respond with the existing email/SMS actions. The subscriber receives the selected channel at their saved business email/phone; the browser cannot choose another recipient or impersonate another client.

## Subscriber control

Settings → Client Portal → Communication history & messaging starts **off**. Enabling it and saving exposes the feature to clients using a private link. Disabling it blocks read and send RPCs as well as hiding the tab. The per-client Direct messaging setting is also enforced. Other portal settings are preserved when saving.

## Private access and history

- Valid quote, invoice and change-order capabilities are checked against the saved client and company, document state and applicable revocation/expiry.
- New project-update and client-closeout deliveries can include a separate 180-day opaque capability when sending to the client's saved contact. Only its SHA-256 digest is stored.
- The public response contains only message ID, channel, subject, body, direction, status and timestamp. Internal notes, call logs, reminders, document deliveries, company copies and messages sent to another destination stay private.
- History pages contain 50 messages and use a timestamp/ID cursor. The visible panel refreshes every 15 seconds. Sending is rate limited to 10 new messages per client and 100 per company per hour.
- Send intents are atomic and idempotent. Unknown provider acceptance is not retried automatically. Client text is escaped for email and rendered as text in the portal and office history.

## Verification

180 focused and regression checks passed across portal capability/security, message delivery, portal/settings UI, existing SMS, lead conversion, client updates and closeouts. The production build passed; targeted lint has no errors and one existing unused-argument warning in the closeout delivery dialog. Browser verification is unavailable because the browser kernel cannot start in the workspace. Tests use synthetic data; no real email/SMS was sent.

## Release requirements

1. Apply `20261102150726_client_portal_communications.sql`.
2. Deploy `client-portal-message` with `verify_jwt=false`; the endpoint performs its own client-capability authentication through service-only RPCs. It uses the existing server-side Resend/Twilio environment configuration, without new DNS or client secrets.
3. Deploy the frontend from the tested commit. Keep the company setting off until the subscriber chooses to enable it.
