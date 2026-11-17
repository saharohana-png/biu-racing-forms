# Standalone deployment and private-data migration

The repository is independent source code. It is not itself a hosted form service. It targets Cloudflare Workers with D1 for records and R2 for uploaded evidence. GitHub Pages cannot run the authenticated backend.

## Prepare a destination

1. In the intended Cloudflare account, create a D1 database and an R2 bucket. Check the built Worker size, CPU use and storage against the current plan limits. As of 18 November 2026, Cloudflare documents a 64 MiB uncompressed Worker bundle limit for both free and paid plans ([size limit change](https://developers.cloudflare.com/changelog/post/2026-09-04-increased-worker-size-limit/)). Inspect the generated bundle with `wrangler deploy --config dist/server/wrangler.json --dry-run`; workbook export must also be checked against the CPU and memory allowance. R2 requires its own subscription, with included free usage and possible usage charges; review the account's billing settings before enabling it. No paid plan is selected by this project.
2. Copy `wrangler.jsonc` to the ignored `wrangler.production.jsonc`. Replace the placeholder database ID and resource names with the actual resources. Configure an explicit domain/route for the deployment.
3. Configure Cloudflare Access for the intended audience and domain. Set the configuration vars `ACCESS_TEAM_DOMAIN` (for example `team.cloudflareaccess.com`) and `ACCESS_AUD` to that Access application's values. These are configuration identifiers, not inference credentials. The Worker verifies RS256 signatures, issuer, audience and expiry and rejects direct unauthenticated origin requests. Never set `LOCAL_DEV` in production.
4. Apply the migrations to the destination with `npx wrangler d1 migrations apply <database-name> --remote --config wrangler.production.jsonc`.
5. Before inviting users, set the `workspace` row for ID `2027` to the intended owner's verified Access subject, prefixed with `access:`. Obtain the subject from the correct Access identity. Do not promote the first visitor or guess an identifier. A missing owner deliberately blocks access. Subsequent roles are managed by the coordinator in the app.
6. Install dependencies and prepare official templates, then build with `FORMS_WRANGLER_CONFIG=./wrangler.production.jsonc npm run build` (set that environment variable using the equivalent shell syntax on Windows). Review the generated `dist/server/wrangler.json`. Deploy with `npm run deploy` only after the target resources, access policy and data migration are reviewed.

Use an Access identity provider suitable for your collaborators. The retained self-declared university-email form does not verify mailbox ownership and must remain behind the deployment-wide Access policy. Application roles and system scopes are enforced separately from the perimeter policy.

## Transfer existing private data separately

The public repository deliberately excludes source answers, membership records, attachments, example photos, environment files and database state. A source-code deployment cannot migrate them.

Before cutover, export the original D1 database and R2 objects using the source hosting account's authorized tools, and preserve an untouched backup. Import into the isolated destination, preserving revision IDs, attachment IDs/keys, provenance and mutation history. Map historical actor identities to the new verified Access identities explicitly; do not overwrite them by matching a self-declared email. Verify record counts, representative Hebrew answers, file downloads, revision history, role boundaries, translation and each official workbook export before pointing collaborators at the new URL.

Do not commit these backups or import them into browser-test fixtures. Keep the existing service available until the destination is tested and the owner chooses the cutover. No production migration or live cutover is performed merely by cloning this repository.
