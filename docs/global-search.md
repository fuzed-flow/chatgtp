# Global search

Global search is available through the top navigation and Ctrl/Command+K for active office accounts with searchable sections. It follows the navigation permission keys for quotes, clients, leads, projects, and invoices. Managers do not receive invoice results; field roles use their portal tools. Quote templates are excluded because Templates has separate permissions.

Search begins after 275ms with at least two characters or an active filter. Requests run only while the dialog is open. Changes to the query, filters, company, profile, role, or permissions cancel pending requests and invalidate earlier responses. Closing clears the query and results; filters persist until cleared or the account scope changes.

The helper applies company, text, status, date, and amount predicates before the result limit. Literal punctuation and wildcard characters cannot broaden the PostgREST filter. Queries use the caller's Supabase client and always include the company predicate, including any embedded client details. Partial failures remain visible with a Retry search action.

Mixed searches interleave up to eight recent matches per applicable type, ranked within each type by exact or prefix match. Narrowing to one type returns up to forty matches. An extra row detects additional matches; the UI prompts users to refine their criteria. Dates refer to quote/invoice issue dates or project start dates. Amounts refer to document totals, lead estimates, or project revenue budgets. Types lacking an applicable field are excluded; switching to a specific type clears unsupported filters.

The dialog uses a focus trap, Escape, focus restoration, arrow-key result navigation, and Enter to open. Mobile inputs and controls use 16px text and 48px touch targets. All filters are available on mobile, and the filter panel and results scroll independently within the visible viewport.

The migration adds company/creation-date/ID indexes matching the query order. It does not change records or access policies. Verify with `npm run test:search`, `npm run test:help`, `npm run build`, and targeted ESLint for the component and helper.
