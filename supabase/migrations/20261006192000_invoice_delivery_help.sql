-- Keep subscriber-facing help aligned with the secure invoice delivery flow.
-- Update only existing canonical articles and invalidate embeddings only when
-- their searchable content actually changes.
with article_updates as (
  select *
  from jsonb_to_recordset($articles$[
    {
      "slug": "guide-invoices-share-customer-pay",
      "answer_short": "Save and review the invoice, then email or text the customer a private invoice link; optional company copies contain the same link but no PDF attachment.",
      "answer_long": "## Review the saved document\n\nBefore sharing, confirm the client, invoice number, addresses, scope, dates, payment schedule, total, and balance. Use **Client Preview** or **Download PDF** to inspect the document. Choosing email or text saves pending edits first; the send dialog opens only after that save succeeds.\n\n## Email or text\n\n1. Choose **Send via Email** or **Send via Text Message**.\n2. For email, review the auto-filled **To (Client Email)**, **Subject**, **Message**, and **Email Signature**. Templates support Client Name, Invoice # and Balance Due.\n3. For text, review the auto-filled phone number and message. The private link stays outside the editable message and is appended when sending.\n4. Wait for the confirmed result.\n\nThe link is scoped to the saved invoice. FuzedFlow requires both its invoice ID and private token before showing it. Email uses **View & Pay Invoice**; it does not add a Client Portal link or PDF attachment.\n\nA confirmed email or text changes only **Draft** to **Sent**. It preserves **Partial**, **Paid**, **Overdue**, **Cancelled**, and other accounting statuses. The payment ledger and processor confirmation determine whether money was received.\n\n## Send your company a copy\n\n**Send me a copy** starts unchecked. Select it to send a separate copy to the company email under **Settings → Branding & PDFs → Email Address**. An owner or administrator can correct a missing address.\n\nThe company copy has the same formatted body and private invoice link as the customer email. Email has no PDF attachment, so the copy does not contain one either. Its subject identifies the document and customer, for example: `[COPY] Invoice from LBProjects - Invoice #INV-1001 for Jane Smith`. This applies to email, not text.\n\nIf the client email succeeds but the copy fails, use **Retry copy**. It retries the captured copy without sending another client email. On mobile, scroll to the dialog footer for the checkbox.\n\nFor an uncertain text result, use **Retry text** to reuse the captured request instead of creating a duplicate. If the text was accepted but its status update failed, use **Retry status**; this does not send the text again. Check communication history when prompted.\n\n## Customer payment flow\n\nWhen online payment is available, the customer opens secure checkout. The server calculates the amount from the saved balance or next unpaid milestone; browser-entered amounts are ignored. The customer should check the checkout amount.\n\nCustomers can download the displayed PDF and review payment history. Confirm a completed transaction in both the processor and app ledger before treating it as resolved; a return to the invoice page alone is not confirmation.\n\n## Troubleshooting\n\nIf checkout is unavailable, ask an authorized administrator to confirm payment setup. After a card error, check whether the processor recorded a charge before retrying. For an incorrect amount, check milestone allocation and invoice balance.\n\nIf a private link is invalid or has been revoked, resend the invoice. Do not edit the invoice ID or token. Keep the invoice number and error for support, and never request card details by email or invoice notes.\n\n## Access and support\n\nAvailability depends on role and subscription. If the page redirects or is missing, ask the company owner or administrator to confirm access.",
      "search_terms": ["send invoice", "email invoice", "text invoice", "public invoice", "pay now", "checkout", "pdf invoice", "payment failed", "send me a copy", "company email copy", "copy failed", "retry copy", "invoice token", "invalid link", "revoked link", "retry status"],
      "last_verified_at": "2026-10-06"
    },
    {
      "slug": "guide-message-templates",
      "answer_short": "Edit document communications and use Insert buttons for client names, document numbers, invoice balances and sender details.",
      "answer_long": "## What Message Templates controls\nOwners, administrators, and managers can open **Settings → Message Templates**. The page provides communication text for quotes, invoices, change orders, and purchase orders, plus a company email signature. These are shared defaults used by the relevant dispatch workflow; saving a template does not send a message.\n\nQuotes, invoices, and change orders have **Email Body** and **Text Message (SMS)** fields. Purchase orders use an email body. The **Email Signature** is appended to outbound dispatch email where that workflow supports it.\n\n## Edit safely\n1. Choose the document's template section.\n2. Place the cursor where a dynamic value should appear.\n3. Use the small **+ Insert** token buttons instead of typing placeholder punctuation manually.\n4. Add clear surrounding text, leaving document links to the appropriate dispatch workflow rather than inventing a link.\n5. Repeat for SMS if your company uses text delivery.\n6. Review the company signature.\n7. Select **Save All Templates** and wait for confirmation.\n8. Check the next actual draft or dispatch preview before sending it to a client or vendor.\n\nQuote tokens include Client Name, Quote #, and Quote Title. Invoice tokens include Client Name, Invoice #, and Balance Due. Change orders include Client Name and CO #. Purchase orders include Vendor Name and PO #. Signature tokens include My Name (Sender) and Company Name. The invoice send dialog replaces `{{balance_due}}` with the saved balance and auto-fills the recipient, subject, message and signature.\n\n## Understand the token syntax\nA placeholder such as `{{client_name}}` is replaced with the relevant record value by the workflow. Changing or deleting its braces can leave literal placeholder text in a message. The Insert buttons add the supported token at your cursor position and reduce these errors.\n\nKeep SMS wording short enough to be useful on a phone, and make the document and next action clear. The invoice workflow adds its private invoice link when sending. Its email is currently link-based, so do not promise a PDF attachment or add a Client Portal link to the invoice template. Your wording should match the workflow that is actually available; an email template cannot enable a missing general signature or payment capability.\n\n## Troubleshooting\nIf a client receives a raw placeholder, compare it with the supported token and the source record, then correct the template. If the wrong number or recipient appears, review the document and contact details as well as the template. An email/SMS switch, saved template, or success saving settings does not prove delivery. Use the relevant document send result and preserve any dispatch error. Office staff should ask a permitted manager or administrator for template changes.",
      "search_terms": ["email template", "SMS", "tokens", "client_name", "balance_due", "email signature", "dispatch wording"],
      "last_verified_at": "2026-10-06"
    },
    {
      "slug": "invoice-email-template",
      "answer_short": "Yes. The email dialog uses the company template and auto-fills the recipient, subject, message and signature, including the invoice balance when that token is used.",
      "answer_long": "Yes. Configure the shared invoice email body and email signature under **Settings → Message Templates**. The send dialog auto-fills the client email, subject, message and signature for the saved invoice, and you can review or edit them before sending.\n\nSupported invoice body tokens include `{{client_name}}`, `{{invoice_number}}` and `{{balance_due}}`. The private invoice link is added by the send workflow. The current invoice email is link-based: it does not attach a PDF or add an Access Client Portal link.",
      "search_terms": ["invoice email", "template", "client name", "invoice number", "balance due", "email signature", "auto fill"],
      "last_verified_at": "2026-10-06"
    },
    {
      "slug": "invoice-sms-link",
      "answer_short": "No. The editable message is separate, and FuzedFlow appends a private invoice link when the SMS is sent.",
      "answer_long": "No. The text message remains editable while the private invoice link is kept in a separate, locked area. FuzedFlow creates and appends the link when you send.\n\nThe link is scoped to that invoice and is validated using both its invoice ID and private token. If the link is invalid or has been revoked, resend the invoice to give the client a valid link rather than editing the URL manually.",
      "search_terms": ["invoice", "sms", "secure link", "payment link"],
      "last_verified_at": "2026-10-06"
    },
    {
      "slug": "invoice-statuses",
      "answer_short": "Invoice workflows use Draft, Sent, Partial, Paid, Overdue and Cancelled statuses.",
      "answer_long": "Invoice workflows use **Draft**, **Sent**, **Partial**, **Paid**, **Overdue** and **Cancelled** statuses. A confirmed invoice email or text changes only a **Draft** invoice to **Sent**. It does not replace **Partial**, **Paid**, **Overdue**, **Cancelled**, or another accounting status.",
      "search_terms": ["invoice", "status", "partial", "paid", "overdue"],
      "last_verified_at": "2026-10-06"
    },
    {
      "slug": "send-invoice-email",
      "answer_short": "Use Send via Email. FuzedFlow saves pending edits, then opens a pre-filled email with a private View & Pay Invoice link.",
      "answer_long": "1. Open the invoice and choose **Actions → Send via Email**.\n2. If the invoice has pending edits, FuzedFlow saves them before opening the send dialog. The dialog stays closed if saving fails.\n3. Review the auto-filled client email, subject, message and email signature. Invoice templates can insert Client Name, Invoice # and Balance Due.\n4. Select **Send Email** and wait for the confirmed result.\n\nThe email contains a private **View & Pay Invoice** link scoped to the saved invoice. FuzedFlow validates both the invoice ID and private token. It does not attach a PDF or include an Access Client Portal link. **Send me a copy** sends the company the same formatted email and private link, without a PDF attachment.\n\nA confirmed send changes only a **Draft** invoice to **Sent**; **Partial**, **Paid**, **Overdue**, **Cancelled**, and other accounting statuses are preserved. Opening the dialog does not prove delivery. If a client reports an invalid or revoked link, resend the invoice to issue a valid link.",
      "search_terms": ["invoice", "email", "send", "pay", "balance due", "send me a copy", "private link", "invalid link"],
      "last_verified_at": "2026-10-06"
    },
    {
      "slug": "send-invoice-sms",
      "answer_short": "Yes. FuzedFlow saves pending invoice edits, then sends the client a text with the invoice details and a private invoice link.",
      "answer_long": "Yes. Open the saved invoice and choose **Actions → Send via Text Message**. FuzedFlow saves any pending edits before opening the dialog, then auto-fills the client phone number and message. Review them before sending.\n\nThe private link is kept separate from the editable message and appended when the SMS is sent. It is scoped to the invoice and requires both the invoice ID and private token. A confirmed text changes only **Draft** to **Sent** and preserves **Partial**, **Paid**, **Overdue**, **Cancelled**, and other payment or accounting statuses.\n\nIf sending is uncertain, use **Retry text** so FuzedFlow reuses the same captured message and request instead of creating a duplicate. If the text was accepted but the invoice status could not be saved, use **Retry status**; this does not send the text again. If the dialog says to check communication history, do that before starting a new text. If the client sees an invalid or revoked link, resend the invoice instead of editing the URL.",
      "search_terms": ["invoice", "sms", "text", "balance due", "private link", "save changes", "invalid link"],
      "last_verified_at": "2026-10-06"
    }
  ]$articles$::jsonb) as article(
    slug text,
    answer_short text,
    answer_long text,
    search_terms text[],
    last_verified_at date
  )
)
update public.help_faqs current_article
set answer_short = article_updates.answer_short,
    answer_long = article_updates.answer_long,
    search_terms = article_updates.search_terms,
    last_verified_at = article_updates.last_verified_at,
    embedding = null
from article_updates
where current_article.slug = article_updates.slug
  and (
    current_article.answer_short,
    current_article.answer_long,
    current_article.search_terms,
    current_article.last_verified_at
  ) is distinct from (
    article_updates.answer_short,
    article_updates.answer_long,
    article_updates.search_terms,
    article_updates.last_verified_at
  );
