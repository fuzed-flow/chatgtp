# FuzedFlow

FuzedFlow is a React application built with Vite and Tailwind CSS. The active backend uses Supabase for authentication, data, storage, and Edge Functions. GitHub updates to `main` trigger the connected Vercel production deployment.

## Local development

Install the dependencies with `npm ci`. Create an untracked `.env.local` file containing the public Supabase connection settings:

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-key
```

Run `npm run dev` to start the development server. Run `npm run build` to create the production output in `dist`, and `npm run preview` to preview that output locally.

## Project folders

- `src`: application pages, components, routes, and Supabase client.
- `public`: static assets, including the app manifest.
- `supabase/functions`: backend Edge Function source and its deployment configuration.
- `supabase/migrations`: versioned database migrations; keep applied migrations in source control.
- `tests`: notification regression tests and synthetic browser fixtures for notifications, AI help, and PM tasks. Fixtures do not use customer records.
- `docs`: feature documentation, including [notification behavior and workflow limits](docs/notifications.md).
- `base44`: original entity definitions and function source retained as migration references. Some legacy feature modules still refer to Base44 APIs, so this folder has not been removed as part of repository cleanup.

## Verification

```sh
npm run build
npm run test:notifications
```

The notification tests use synthetic browser records and an isolated in-memory PostgreSQL database. The fixture Vite configurations under `tests/*/browser` can also be used for focused browser previews.

Backup archives, downloaded CLI binaries, build output, dependencies, and Supabase CLI link/cache metadata are excluded from source control. Earlier versions of removed files remain available in Git history.
