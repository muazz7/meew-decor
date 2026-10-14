# Meew Decor

A mobile-friendly home décor storefront for [Meew Decor](https://www.facebook.com/people/Meew-Decor/61590528366514/), with product discovery, a shopping bag, an owner dashboard, persistent orders and a guarded bKash checkout integration.

**Live commerce is disabled.** Product prices, stock, delivery charges, policies, owner access and merchant credentials require confirmation and configuration. The bKash adapter has not completed merchant sandbox or live acceptance. Review the [client handover](docs/CLIENT_HANDOVER.md) and [payment integration guide](docs/BKASH_INTEGRATION.md) before launch.

## Vercel / GitHub import

See [the Vercel deployment guide](docs/VERCEL_DEPLOYMENT.md). Import this folder as a Next.js project; `vercel.json` selects the production Next build automatically. The storefront deploys without secrets. Persistent orders and owner management use Turso plus the owner login variables, and bKash still requires merchant activation.

```sh
npm ci
npm run dev:vercel
npm run build:vercel
npm run start:vercel
```

## Stack and project layout

React 19 and TypeScript use Next.js App Router conventions through Vinext/Vite. Deployment targets either a Cloudflare Worker through Sites or native Next.js on Vercel. Cloudflare D1 or a remote Turso/libSQL database stores catalog settings, inventory reservations, orders and payment records; Drizzle defines the schema and SQL migrations.

| Location | Purpose |
| --- | --- |
| `app/page.tsx`, `app/globals.css` | Storefront, product dialogs, bag and checkout UI |
| `app/admin/` | Owner configuration, orders and fulfillment |
| `app/order-status/` | Private customer payment/delivery status |
| `app/api/`, `lib/server/` | Authoritative checkout, payment verification, access checks and order operations |
| `lib/catalog.ts` | Four product descriptions, categories, public business contacts and original Facebook photograph links |
| `public/images/` | Local product and brand photographs |
| `db/schema.ts`, `drizzle/` | D1 schema and committed migrations |
| `.openai/hosting.json` | Sites project and `DB` binding declaration |
| `.env.example` | Runtime configuration names, without secrets |
| `tests/backend.test.mjs` | Production service/route tests using SQLite and simulated gateway responses |

The client handover records the source for each photograph and distinguishes visible product details from specifications that still need owner approval. Product content and images are currently edited in source; the dashboard manages prices, available stock, enabled products, policies and delivery rates.

## Cloudflare / Sites local development

Use Node.js 24 for the documented test workflow; the package pins Node.js `24.x`. Run commands from the project root.

```sh
npm run install:ci
npm run build
```

`install:ci` performs a lockfile-based install, including development and optional dependencies. Do not run concurrent installers. The build generates `dist/server/wrangler.json`; this repository intentionally has no root `wrangler.jsonc`.

For a new local database, apply the committed initial migration once:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_unusual_monster_badoon.sql
```

Then start the development server:

```sh
npm run dev
```

The portable profile starts at [http://localhost:5173](http://localhost:5173); use the actual URL printed by the server if that port is unavailable. Keep local previews on loopback. A fresh checkout defaults to the portable profile. The Sites plugin manages its own preview/build lifecycle in managed environments.

Local Worker configuration can be placed in an ignored `.dev.vars` file using the names from `.env.example`. Keep `COMMERCE_ENABLED=false` for ordinary UI development. Restart the server after configuration changes. Real merchant secrets belong in the hosting platform's runtime-secret configuration, not the repository or browser-visible variables.

### Owner access locally

Portable `npm run dev` provides a loopback-only development identity. To inspect the dashboard, set `STORE_ADMIN_EMAIL=seedy@sites.test` in local configuration, then visit `/signin-with-chatgpt?return_to=/admin`. This identity is a development fixture, not the business owner's account. Sign out at `/signout-with-chatgpt?return_to=/`.

Sites-hosted `/admin` requires real ChatGPT sign-in and the explicitly allowlisted owner email. The built Worker preview does not simulate sign-in. Do not add application routes for the platform-owned sign-in, sign-out or OAuth callback endpoints.

### Schema changes

After editing `db/schema.ts`, generate and review the next migration:

```sh
npm run db:generate
```

Apply each new SQL file locally in order using the command above with its filename. Do not replay an already-applied migration. Local D1 state lives in `.wrangler/state`; these commands do not modify the hosted database. Sites publishing applies production migrations separately. Rebuild if bindings change.

## Checks and built preview

```sh
npm test
npm run typecheck
npm run lint
npm run build
npm start
```

`npm test` exercises the actual production validation, configuration, order, payment and route code against SQLite with the committed SQL migrations. Cloudflare bindings, hosted identity and bKash HTTP responses are simulated. The tests cover inventory and payment invariants; they do not prove real merchant compatibility or live callback access.

`npm start` serves the built Worker locally through Wrangler, shares `.wrangler/state` with development and local migrations, and does not deploy. Use its printed URL; a custom port can be supplied with `npm start -- --port 8787`. `npm run dev -- --port 5174` changes the portable development port.

## Launch requirements

1. Confirm the catalog, photograph permissions, product specifications, BDT prices, stock, delivery charges, delivery/return policies and business contact details.
2. Configure `STORE_ADMIN_EMAIL`, verify the real owner's access and save the approved commercial settings in `/admin`.
3. Confirm the merchant's API compatibility with bKash. The current adapter supports Tokenized Checkout **`v1.2.0-beta`**, checkout-only mode `0011`, and requires the matching `BKASH_API_VERSION` setting. A v2-only merchant requires an updated, tested adapter.
4. Configure merchant credentials securely, establish a publicly accessible HTTPS origin, set `SITE_PUBLIC_URL` and complete bKash's callback/domain requirements. A private review site cannot receive normal anonymous payment callbacks.
5. Complete the merchant-approved sandbox and live acceptance procedures, then enable the runtime commerce gate and owner checkout setting. Keep live selling disabled while any requirement remains unresolved.

See [BKASH_INTEGRATION.md](docs/BKASH_INTEGRATION.md) for exact variable names, payment reconciliation, stock recovery, acceptance cases and operational limits. Automatic email/SMS, courier booking and automated refunds are not integrated. Existing business processes must handle those activities.

Use the Sites publishing workflow for Cloudflare deployment, or the Vercel guide for GitHub import. Do not distribute `.dev.vars`, `.env` files containing secrets, local database state, private order links or generated development state with the source handover.
