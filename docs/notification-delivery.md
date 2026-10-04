# Personal notification delivery

Personal notification settings are available in Settings → Notifications and the notification bell's settings panel. In-app is enabled by default; instant email, SMS, web push, and email digests require explicit opt-in. Company document alert preferences remain separate. Delivery starts with future, already recipient-routed notifications; enabling a channel never replays historical rows or expands a company's notifications to additional people.

Personal categories and Action Required Only apply across these personal channels. Quiet hours delay outbound delivery using the saved timezone without removing in-app history. Daily and weekly digests are separate from instant email, include up to 200 eligible updates per batch, and are scheduled after the selected local hour. Recipient access and preferences are checked again before provider delivery. Explicitly requested external document/warranty emails use a separate transactional queue and the workflow capability validator.

## Deployment contract

Apply `20261004173154_notification_personal_delivery.sql` after the base notification migration. The document/warranty migration supplies `workflow_private.notification_request_mail_allowed(uuid,text,text)`, which validates queued customer-request links both when claimed and immediately before sending. The privileged `notification_private.enqueue_transactional_email(uuid,uuid,text,text,text,text,text)` helper accepts only server-derived request context; browser access is revoked. Identical request retries deduplicate; renewed capability URLs can enqueue a new request.

Deploy `notification-dispatch` with `verify_jwt=false`. It authenticates only the dedicated `X-Notification-Cron-Secret`; browser JWTs do not authorize dispatch. `notification_delivery_server_config()` is restricted to service_role and reads these encrypted Vault names (or matching Edge environment overrides):

| Vault name | Value |
| --- | --- |
| `notification_cron_secret` | Dedicated random worker secret |
| `notification_vapid_public_key` | Base64url uncompressed 65-byte P-256 public point |
| `notification_vapid_private_key` | Base64url raw 32-byte P-256 private scalar |
| `notification_vapid_subject` | `https://app.fuzedflow.com` or an operator contact URI |
| `project_url` | Canonical Supabase project HTTPS origin |

Browser `notification_push_config()` returns only the VAPID public key, app origin, and configured flag. Private keys and cron credentials never enter the browser. The dispatcher also uses existing server-only `RESEND_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER`. Its email sender is `Fuzed Flow <alerts@mail.fuzedflow.com>` and requires a verified Resend sending domain. SMS requires the configured Twilio sender to support outbound messaging.

After migrations, secrets, function deployment, and verification, schedule the protected worker:

```sql
select cron.schedule('notification-personal-dispatch', '* * * * *',
  $$select notification_private.dispatch_tick();$$);
```

The migration deliberately leaves this cron inactive. A missing Vault worker secret or project URL causes the tick to send nothing. The worker claims at most ten deliveries per tick with leases and retries. Resend uses a stable provider idempotency key and frozen request bytes within a conservative 23-hour-55-minute window. Push retries reuse the notification identity; expired devices are removed. Twilio 429 is safe to retry; ambiguous SMS outcomes are marked unconfirmed to avoid duplicate texts. A failed worker lease after an SMS attempt is also marked unconfirmed. Provider acceptance is recorded separately from recipient delivery receipts.

## Devices

`Connect this device` requests browser permission only after a click, registers `/notification-worker.js`, and saves an account-owned subscription through a protected RPC. Save personal preferences to enable push. HTTPS, Service Worker, Push API, and Notifications API are required. On iOS/iPadOS 16.4 or later, add the app to the Home Screen and open it there. Sign-out and `Disable on this device` remove the browser subscription; expired subscriptions require reconnecting. The worker does not cache authenticated application pages and opens only links on the app's own origin.

## Temporary provider setup

`notification-provider-setup` accepts only POST `{ "action": "inspect" }`, `configure_resend`, or `configure_twilio` with `X-Notification-Setup-Secret`. `notification_provider_setup_config()` is service-only and supplies the dedicated setup secret plus fixed callback/domain configuration. No arbitrary provider paths, recipient inputs, DNS mutations, signing-secret rotations, or message-send endpoints are exposed.

The fixed callback endpoints are the project functions `email-events` and `sms-events`. Resend configuration reuses a matching webhook, securely stores its secret through `notification_store_provider_secret`, and enables the receiving domain `reply.fuzedflow.com` or reuses an already verified receiving subdomain belonging to Fuzed Flow. Pending receiving domains trigger the fixed `POST /domains/{id}/verify` endpoint followed by a status retrieval. This starts/checks provider DNS verification without changing DNS. Repeating setup reuses the same webhook/domain; after DNS propagation it can finish verification. The storage whitelist is exactly `resend_webhook_secret` and `resend_reply_domain`, and the reply domain is stored only once `status` is `verified` and receiving is enabled. Configuration receipts include `verification_requested`, `reply_routing_ready`, and public `domain` details (`id`, `name`, `status`, `capabilities`, `records`). A pending domain returns `reply_routing_ready: false` and the needed DNS records. Inspection returns public domain status/DNS records and sanitized account-permission errors. Twilio configuration updates only the configured sender's inbound SMS URL/method; an existing SMS application integration blocks automatic modification. Remove the encrypted `notification_provider_setup_secret` after setup (the helper then returns 410), or remove the temporary function.

## Synthetic validation

```sh
node --test tests/notifications/delivery.test.mjs tests/notifications/channels-ui.test.mjs tests/notifications/notification-center.test.mjs tests/notifications/provider-setup.test.mjs
```

The suite uses synthetic PGlite tenants, JSDOM browser APIs, and fake provider adapters. It verifies permissions, future-only opt-in, preference cancellation, immutable retries, document token renewal/revocation, SMS crash protection, quiet-hour timezone transitions, digest dedupe, push/logout lifecycle, safe worker links, and restricted provider configuration. These tests send no customer emails, SMS, or push messages. Actual provider permissions/domain DNS and real-device permission behavior require deployment verification.
