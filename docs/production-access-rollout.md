# Production access migration applied

The approved `20261004204119_project_tenant_boundaries.sql` migration was applied to production on 2026-10-04. Supabase recorded it as `20261004230012_project_tenant_boundaries`. The application and storefront changes, and the additive payment, enquiry and schedule-draft migrations, are also published.

The Stripe platform webhook receives subscription lifecycle events. A separate Connect webhook receives checkout payment and onboarding events from connected accounts. The receiver verifies the distinct signing keys and requires the connected account to match the document's company before recording a payment. Its signing key is encrypted in Supabase Vault and readable only through a service-role function; it is not in this repository. A signed diagnostic event tested the deployed verification path without changing payments or accounts. Historical connected-account payments predating this setup may need reconciliation from Stripe records.

## Applied access changes

| Change | Scope and effect |
| --- | --- |
| Company boundaries | All 71 current tables with `company_id` have RLS enabled. 69 have a restrictive authenticated company boundary; projects and contractor files have explicit company policies. Active users can access their own company's rows. Service-role operations retain access. |
| Public project access | Direct anonymous project/file reads and writes are denied. Public documents resolve minimal project information through the deployed function; contractor links require the project's random token. |
| Billing fields | Browser clients cannot change plan, status, purchased seats or Stripe connection fields directly. Payment functions retain service access. |
| Starter projects | Five active projects are enforced; completed/cancelled/lead projects do not count. Existing active projects above the cap are retained. |
| Purchased seats | Company seat limits are checked when inactive users or expired invitations are reactivated, as well as on creation. |
| Business modules | Fifteen policies enforce selected module access on related project and financial records. Owners/admins retain access; an empty selection uses the existing role defaults. |

The token-aware production app is deployed. Older contractor links must be copied again from the project so they include the token. Prices and included plan features are unchanged. The internal project timeline remains separate from the public ClientPortal.

## Verification

- Captured the existing policies, affected grants, trigger definitions and previous seat-limit function before application. A separate rollback checkpoint includes the restoration SQL; no customer records or signing secrets are in that checkpoint or this repository.
- Applied the approved committed SQL successfully and confirmed the migration in production history.
- Checked two existing company admins under the authenticated database role across all 71 company tables: no cross-company rows were visible. Each admin could still read their own profile, company and complete existing project set.
- A cross-company project update affected zero rows. The verification transaction was rolled back.
- Confirmed anonymous project and contractor-file REST reads return permission errors. A current contractor token, invoice capability and change-order capability each returned minimal project data successfully; missing and incorrect contractor tokens were rejected.
- Confirmed existing public quote, invoice and change-order document reads remain available.
- Confirmed project-limit, billing-guard and seat creation/reactivation triggers are active. Payment recording and Connect signing-key access remain unavailable to authenticated browser clients; the signing key remains readable by the service role.
- PGlite regression tests passed for payment retries/deposit credit, cross-company writes, project limits, purchased seats, invitation consumption and schedule application. Additional tests run the existing production signup trigger against the migrated schema: owner signup, reserved invitation acceptance at seat capacity and signup without company metadata all produce accessible accounts.
- Live verification did not create users, charges, emails or persistent test records. New signup/invitation mutations were exercised locally; an authenticated browser billing purchase was not made.

## Remaining scope

This rollout does not replace every legacy anonymous document/storage policy or complete a general authorization audit. Supabase still reports legacy [user-metadata authorization policies](https://supabase.com/docs/guides/database/database-linter?lint=0015_rls_references_user_metadata), [publicly callable privileged functions](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), mutable function search paths, the extension schema and disabled leaked-password protection. The service-only enquiry table intentionally has no authenticated policy. Further changes require their own compatibility review.

Google Search Console verification/submission and publishable customer evidence still require owner access and approved evidence, as described in the storefront measurement document. The internal timeline/public portal connection remains deferred.
