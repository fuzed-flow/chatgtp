# Notification workflow release

## Authorized production rollout

The user approved continuing this unfinished rollout on October 4, 2026, after the previous approval-review blocker was explained. The recovered notification work is integrated on top of production commit `9e8dc407741ac3864a8a0e83d5136720d6bf89bb`.

This release adds recipient-routed notifications; warranty/document request records and capability links; equipment/material/PO/trade/permit workflows; task/dependency/phase/leave/allocation/time-entry safeguards; communication tracking and signed provider callbacks; and notification events for confirmed Stripe payments, refunds/disputes/failures and subscriptions. Personal outbound channels require opt-in. Deployment itself does not initiate charges, refunds or customer messages.

The compatibility migration retains the already deployed company boundaries, public project tokens, purchased-seat mapping, confirmed payment ledger, deposit credits and Connect signing key. Retried payments from before or after this rollout cannot credit a saved document twice. The internal project timeline remains separate from the public client portal.

## Prepared infrastructure

The personal delivery schema and service-only provider configuration migration have been applied. VAPID and provider callback secrets are encrypted in Vault. Personal external channels default to off, and the dispatcher cron remains inactive until rollout. The fixed Resend callback is configured; receiving reply routing remains disabled while DNS is pending. The temporary provisioning helper is retired by removing its setup secret. Existing production frontend and payment handlers remain in place until approval.

## Rollout order

1. Apply warranty/documents, costs/assets, sales/finance, people/PM, final-integration and current-release compatibility migrations. Personal delivery/provider configuration already exist. Apply the Help catalog migration last.
2. Deploy curated Edge handlers with exact shared modules: send-email, send-sms, company-notifier, stripe-webhook, createDepositCheckout, create-checkout, quote/co/invoice reminder crons, send-vendor-request, email-events, sms-events and notification-dispatch.
3. Extend existing platform Stripe webhook events without changing its URL, API version or secret. Reuse the existing Connect endpoint and its Vault signing key. Configure Twilio incoming callback after the handler exists, then mark SMS replies ready.
4. Activate the minute-by-minute dispatcher and verify service grants, event triggers/rules and cron configuration without sending synthetic customer messages.
5. Merge the exact reviewed commit and verify Vercel production is READY for that commit and both production domains. Refresh changed Help embeddings through the authenticated service workflow; lexical retrieval remains available while embeddings refresh.

## Receiving-email DNS

Fuzed Flow uses external Namecheap DNS. Add these records for reply.fuzedflow.com and verify the receiving-only domain in Resend before storing resend_reply_domain in Vault:

| Type | Host | Value | Priority | TTL |
| --- | --- | --- | --- | --- |
| MX | reply | inbound-smtp.us-east-1.amazonaws.com | 10 | Automatic |
| TXT | resend._domainkey.reply | p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC5Nh5k65dDBBFFZREFho1vbnXbyDGpkcGmjSaWutuFsueQFVnCJDq+GKD0FHitbxpXZRFHQADK7FxdBC3X722xjVx3/gnjO02lK8yuLVphZBMx64y6re4LleLBMsRhUFiTt6erqfB8tkHjTvI44CaK0m270JW/Y/Fcsueu3p18wQIDAQAB | — | Automatic |

Until verified, replies use the existing company inbox. Once verified, both the tracking alias and saved company inbox appear in Reply-To, preserving company access to original replies and attachments.
