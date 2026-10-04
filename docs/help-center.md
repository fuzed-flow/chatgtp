# Knowledge Base & FAQ

The FAQ table is the canonical answer source for both the help page and the active `ai-help` Edge Function. Editing an answer updates the text returned to AI without a separate knowledge-chunk synchronization step. Existing question embeddings support semantic retrieval; keyword search also includes long answers, categories, and search terms, so new articles are immediately searchable without an embedding.

The help migration updates 34 existing articles, adds 20, retires the inaccurate quote-lock FAQ, and adds related-page routes. The article updates are recorded in `help-content-updates.json`. The separate legacy knowledge-chunk store remains available as reference; its inaccurate lock, role, and integration statements are corrected, and it is not the active AI answer source.

## Access

Signed-in users with an active company profile can access Help, FAQ, Contact, and Tutorials. Owners and admins can read all active articles. Managers and office staff cannot read articles explicitly marked admin-only. Employees, subcontractors, and legacy field users receive field-help topics, excluding office-only articles. The same rules apply in database row-level security and the UI. Customer-specific records are never used as help content. The embedding-maintenance view is restricted to the service role and uses caller permissions, preventing a legacy view from bypassing article policies.

The AI function verifies the caller with Supabase Auth and queries as that caller; it does not use a service-role client. Retrieval gives a modest preference to the current page, retains semantic search for typo tolerance, and supports keyword retrieval if query embedding is unavailable. Conversation history is bounded to six messages; input and output lengths are limited. Uncovered questions receive a support/FAQ fallback instead of invented app instructions.

## Mobile interaction

Search and topic selection use 48px controls and 16px input text. Search includes full answers; results have accessible disclosures and safe page links. Initial results are limited to 18 with an explicit Show more action. Loading, connection errors/retry, empty content, and no matches have distinct states. Help navigation supports keyboard focus, Escape, and touch.

Support prepares an email draft for the existing published support address. The button is explicitly labelled Open email app and never claims the email has been sent. The user sends from their own mail app; copy-email and tap-to-call fallbacks remain available.

## Verification

Run `npm run test:help`, `npm run test:notifications`, and `npm run build`. Help tests execute the actual migration and pgvector search with synthetic profiles across all roles, check RLS and write denial, verify immediate canonical answer updates and unembedded keyword retrieval, and exercise FAQ search, deep links, formatted steps, pagination, role changes, and load recovery.

The browser fixture under `tests/help-center/browser` renders actual FAQ, support, help-menu, and AI-widget components with synthetic help records and mocked AI replies. Use it to check 320px and 390px phones, landscape, desktop, contact drafts, and role changes without changing customer records or sending support email.
