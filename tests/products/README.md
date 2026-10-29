# Products and document items preview

Build the real app and the isolated interaction preview with `npm run build:products-preview`.
The preview is at `/products-preview/index.html`. Its phone frame uses a real 390px iframe
viewport. It mounts the actual Products, product picker, line item and image components.
Only the browser fixture aliases authentication and database access. Its sample records
and example uploads cannot modify production and reset when the frame reloads.

Run `npm run test:products` for UI, PDF output and local PostgreSQL migration/conversion
checks. The storage test executes the migration against a disposable PGlite database.

## Release sequence

This branch is a preview, not a production release. Before publishing the app to production,
apply `20261029164902_products_finish_colour_and_photos.sql` to the existing app database.
It adds nullable fields to existing tables and updates the explicit public document field
allowlists and the existing authenticated quote-to-invoice conversion. Existing finishes stay
blank; permissions, recipient-token checks, pricing and document totals stay in place.
Then deploy the app from this branch after reviewing its preview. The fixture entry point
is not included by the normal `npm run build` production command.
