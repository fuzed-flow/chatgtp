# Production access migration awaiting approval

The application and storefront changes are published. The additive payment, enquiry and schedule-draft migrations are applied. `20261004204119_project_tenant_boundaries.sql` is committed but **has not been applied**: automatic approval review rejected its broad production permission changes.

## Proposed effect

| Change | Scope and effect |
| --- | --- |
| Company boundaries | Restrictive authenticated policies on 71 current tables with `company_id`; active users can access their own company's rows. Service-role operations retain access. |
| Public project access | Remove direct anonymous project/file reads and writes. Public documents resolve minimal project information through the deployed function; contractor links require the project's random token. |
| Billing fields | Prevent browser clients from changing plan, status, purchased seats or Stripe connection fields directly. Payment functions retain service access. |
| Starter projects | Enforce five active projects; completed/cancelled/lead projects do not count. Existing active projects above the cap are retained. |
| Purchased seats | Check company seat limits when inactive users or expired invitations are reactivated, as well as on creation. |
| Business modules | Enforce selected module access on the related project and financial records. Owners/admins retain access; an empty selection uses the existing role defaults. |

The token-aware production app is deployed. Older contractor links need to be copied again from the project so they include the token. The internal project timeline remains separate from the public ClientPortal.

## Validation and rollout

PGlite tests cover cross-company reads/writes, anonymous project denial, service-only payment recording, project limits, paid seat limits, invitation consumption and idempotent schedule application. Production metadata checks confirmed that direct anonymous project privileges remain present while this migration is pending; deploying the new capability function alone does not remove them.

Before an approved application, save the current policy/privilege and trigger definitions as the rollback snapshot. Apply the migration transactionally, then verify two-company isolation, admin workflows, company onboarding, public document links and a current contractor link. Keep the existing legacy policy definitions available for rollback. Live payments, emails and external-model requests were not used as verification fixtures.
