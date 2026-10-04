# Help Articles, Knowledge Base & FAQ

`/HelpArticles`, available through **Help → Help Articles** in the top navigation, is the subscriber help portal. It provides search, topic collections, guides and quick-answer filters, stable article links, section navigation, related articles, and a support fallback. The existing `/FAQ` remains a focused quick-answer view. Both read the canonical `help_faqs` table, which is also the source for the active `ai-help` Edge Function. Editing an answer updates AI retrieval without a separate knowledge-chunk synchronization step. Existing question embeddings support semantic retrieval; keyword search includes current long answers, categories, and search terms, so new articles are immediately searchable without an embedding.

The help migration updates 34 existing articles, adds 20, retires the inaccurate quote-lock FAQ, and adds related-page routes. The article updates are recorded in `help-content-updates.json`. The separate legacy knowledge-chunk store remains available as reference; its inaccurate lock, role, and integration statements are corrected, and it is not the active AI answer source.

The Help Articles release adds 86 detailed guides across 29 topics and corrects 22 existing quick answers after checking actual page and component behavior. Guide sources are recorded in `help-guides-*.json`; corrections in `help-faq-corrections-*.json`. `help-articles-coverage.json` maps every active page to its guides and explicitly labels legacy/policy pages. The documentation states current limitations for incomplete signatures, warranty claims, videos, integrations, reports export, and other visible controls instead of describing unavailable workflows as working features.

To regenerate the stable-slug content migration, coverage report, and synthetic browser catalog, run `node scripts/build-help-guides.mjs --migration supabase/migrations/20261004071225_help_articles_portal_content.sql`. The generator validates article metadata, source paths, minimum guide detail, current routes, and related links. Apply the portal schema migration before the generated content migration.

## Access

Signed-in users with an active company profile can access Help Articles, FAQ, Contact, and Tutorials. Owners and admins can read all active articles. Managers and office staff cannot read articles explicitly marked admin-only. Employees, subcontractors, and legacy field users receive field-help topics, excluding office-only articles. The same rules apply in database row-level security and the UI. Customer-specific records are never used as help content. The embedding-maintenance view is restricted to the service role and uses caller permissions, preventing a legacy view from bypassing article policies.

The AI function verifies the caller with Supabase Auth and queries as that caller; it does not use a service-role client. Retrieval gives a modest preference to the current page, retains semantic search for typo tolerance, and supports keyword retrieval if query embedding is unavailable. Long guides return relevant Markdown sections from the current canonical answer, with bounded excerpts; there is no second copy of the guide text to become stale. Vague follow-up questions use preceding user questions for retrieval. Conversation history is bounded to six messages; input and output lengths are limited. AI replies include links back to accessible Help Articles. Uncovered questions receive a portal/support fallback instead of invented app instructions.

AI links are validated against the articles actually included by the current authorized retrieval, plus the existing Help Articles, FAQ, Contact, and Tutorials pages. The server removes unverified destinations from model replies and returns explicit allowed-link metadata. The answer renderer independently checks every inline link and source card against that metadata. Guessed article slugs, feature/record routes, external addresses, and links inherited from earlier replies cannot grant a destination. Chat resets when the signed-in profile or role changes, and replies from the previous profile are discarded.

## Mobile interaction

Search and topic selection use 48px controls and 16px input text. Search includes full answers; results have accessible disclosures and safe page links. Initial results are limited to 18 with an explicit Show more action. Loading, connection errors/retry, empty content, and no matches have distinct states. Help navigation supports keyboard focus, Escape, and touch.

The new portal uses FuzedFlow yellow and slate styling, 12-result pagination, large topic and filter controls, and a reader with a mobile section selector and desktop table of contents. Search filters survive opening and returning from an article. The AI modal sits above the application header, including short landscape screens. Markdown rendering excludes raw HTML and unsafe or inaccessible page links.

Support prepares an email draft for the existing published support address. The button is explicitly labelled Open email app and never claims the email has been sent. The user sends from their own mail app; copy-email and tap-to-call fallbacks remain available.

## Verification

Run `npm run test:help`, `npm run test:notifications`, and `npm run build`. Help tests execute the actual migration and pgvector search with synthetic profiles across all roles, check RLS and write denial, verify immediate canonical answer updates and unembedded keyword retrieval, and exercise FAQ search, deep links, formatted steps, pagination, role changes, and load recovery.

The browser fixture under `tests/help-center/browser` renders the actual Help Articles, FAQ, support, help-menu, and AI-widget components with the complete synthetic help catalog and mocked AI replies. Its **Actual app layout** mode adds the real top navigation and sidebar with a mocked notification center. Use it to check 320px and 390px phones, landscape, desktop, contact drafts, and role changes without changing customer records or sending support email.
