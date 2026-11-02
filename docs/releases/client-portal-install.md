# Branded Client Portal installation and desktop shortcut

Clients see a prominent company-branded **Download Client Portal** button above portal content. It uses the subscriber's uploaded company logo and labels the installed app or downloaded shortcut **Client Portal**. The saved destination retains the existing private client portal link and its access tokens, so launching it opens that client's portal.

The button uses a matching browser install prompt when one is available. Otherwise it shows device-specific instructions for iPhone/iPad, Android, Windows or Mac. Windows desktop-link downloads use `Client Portal.url`; Mac downloads use `Client Portal.webloc`. Native browser installations use the company icon; the downloadable desktop-link file's icon handling remains controlled by the operating system.

## Implementation

- Per-client manifest IDs stay separate from the subscriber FuzedFlow app. Portal metadata is restored on leaving the portal; queued prompts cannot install the wrong app in either direction.
- The manifest is served with private/no-store headers. It preserves only recognized portal parameters and accepts only same-origin `/ClientPortal` start destinations with the matching client ID.
- Public company logos are resized without cropping into square PNGs (32, 180, 192 and 512 pixels), plus a 256-pixel ICO for desktop links. Missing/unavailable logos use company initials. The image handler only fetches bounded images from the existing public Supabase storage origin and rejects redirects or external SVG references.
- Two Vercel Node functions serve the manifest and icons. Sharp is pinned to `0.35.5`; it is server-side only. API routes bypass the SPA catch-all. No database migration, Supabase function, company setting or service worker change is needed.

## Verification

All 111 automated checks pass. Coverage includes native-prompt scoping, company branding, private link preservation, desktop downloads, phone/Mac instructions, metadata cleanup, route changes, manifest validation, image sizing, ICO structure, fetch restrictions and existing portal/PWA/messaging workflows. The app builds and targeted lint passes. Browser/device installation remains unverified because the browser kernel cannot start in this workspace; final installation is controlled by the user's browser and operating system.
