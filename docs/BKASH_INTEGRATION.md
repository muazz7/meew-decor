# bKash integration and launch handover

## Current status

The storefront and commerce workflow are implemented. **Live online selling is intentionally disabled.** No merchant credentials, confirmed price list, stock quantities, delivery rates, or approved return/delivery policies were supplied. No money has been charged, and no sandbox or live gateway transaction has been performed.

The adapter in `lib/server/bkash.ts` implements **Tokenized Checkout v1.2.0-beta, checkout-only mode `0011`**. It does not save wallet agreements and never collects wallet PINs or OTPs. bKash hosts those steps.

The [official bKash demo merchant portal](https://merchantdemo.sandbox.bka.sh/) lists tokenized **v2** as the stable version. Its [v1.2.0-beta demo](https://merchantdemo.sandbox.bka.sh/tokenized-checkout/version/v1.2.0-beta) is still accessible. The official developer documentation at `developer.bka.sh` was unavailable during this build (web access failed and the hostname did not resolve from the development environment). Consequently the existing merchant's enabled API version and detailed onboarding requirements must be checked with bKash before activation. Do not point v2-only credentials at this adapter or remove its version gate to force activation.

## Required owner and merchant configuration

Use the hosting platform's runtime-secret configuration, not source code or browser-visible variables. `.env.example` lists the names without secrets.

| Variable | Required value |
| --- | --- |
| `STORE_ADMIN_EMAIL` | Exact email of the owner who signs in with ChatGPT to `/admin`. |
| `COMMERCE_ENABLED` | `false` until configuration and acceptance checks are complete; `true` enables the final runtime gate. |
| `SITE_PUBLIC_URL` | Canonical public HTTPS origin, without path/query/hash. A private review Site cannot receive normal anonymous bKash callbacks. |
| `BKASH_ENV` | `sandbox` for acceptance testing; `live` only after merchant approval. |
| `BKASH_API_VERSION` | `v1.2.0-beta` only after bKash confirms this merchant is enabled for that API. Any other value disables checkout. |
| `BKASH_USERNAME`, `BKASH_PASSWORD` | Merchant environment credentials, supplied securely. |
| `BKASH_APP_KEY`, `BKASH_APP_SECRET` | Matching merchant app credentials, supplied securely. |

In `/admin`, save confirmed BDT prices, available stock and enabled products; both delivery charges; and the owner's actual delivery/return policies. Stock is available stock: pending checkouts already deduct their reserved quantities. The dashboard uses a revision to reject stale saves after another checkout changes stock.

Verify the bKash callback allowlisting/domain requirements with the merchant's onboarding contact. The callback path is `/api/payment/callback`; each payment carries its own opaque order/state parameters. The store must be publicly reachable before live payments are enabled. Publishing a private preview is not payment activation.

## Acceptance checks before taking real orders

Use the merchant's approved sandbox environment and process. Test a successful payment, customer cancellation, declined payment, callback replay, delayed callback, network timeout after Execute, and provider-query recovery. Confirm the merchant invoice, charged BDT amount and transaction ID match the persisted order. Exercise both delivery zones, quantity limits, out-of-stock behavior and simultaneous attempts to buy the last item.

The server requires the shopper's `expectedTotalMinor` and compares it with the latest authoritative price and delivery charge. A changed total returns HTTP 409 before reserving stock or contacting bKash. The customer must review the updated amount before retrying. An in-progress duplicate request returns HTTP 425 and retains its idempotency key.

Sandbox orders are clearly marked and cannot be moved into fulfillment. After sandbox acceptance and merchant authorization, set the matching live credentials and environment and perform the merchant-approved production acceptance procedure. Confirm the owner can see orders and update delivery progress. Keep commerce disabled if any prerequisite remains unresolved.

## Payment integrity and operations

- D1 holds orders, immutable purchased-item price snapshots, payment events, and atomic inventory reservations. The client does not decide charged amounts.
- A checkout idempotency key is bound to its items, delivery details and reviewed total. Replays cannot create a second payment. A changed request using the same key is rejected.
- The success URL alone cannot mark an order paid. The server validates callback state and payment ID, executes once, then verifies provider status, transaction ID, currency and amount. Invoice is checked when present in the provider response.
- A timed-out Execute triggers Query. Uncertain outcomes remain `review`; they are never treated as paid or blindly charged again.
- Owner **Check payment** queries bKash to reconcile unresolved orders. Checking a still-initiated payment preserves `pending`, allowing its later success callback to execute.
- Provider-confirmed Failed, Cancelled or Expired payments return reserved stock exactly once. Paid orders never return stock through this path. Abandoned payment creation with no provider payment ID can be recovered by the owner after 30 minutes. Existing pending provider payments require authoritative reconciliation before stock is released.
- Owner fulfillment changes require both a verified `paid` status and `live` payment mode. There is no admin “mark paid” shortcut.
- Successful payments with a previously released reservation remain `review` and require manual merchant investigation before fulfillment.
- Merchant access tokens are cached privately in D1 until shortly before expiry, with a short lease preventing concurrent token grants. Credential changes invalidate the cache. Tokens and credentials are never returned by store/admin APIs.

The dashboard is the order operations channel; automatic email/SMS, carrier booking, and automated refunds are not integrated. Handle customer communication, refunds and courier arrangements through the business's existing processes. Review unresolved payments and reservations regularly. Match any refund against the merchant transaction record before adjusting inventory.

## Data access

Store administration requires the hosted ChatGPT identity and the explicit owner email allowlist. Mutations require a same-origin request. Public order status requires its random private token and does not expose the delivery address, phone number or internal callback state. Order links should be treated as private.

Names, phone numbers, optional email addresses and delivery addresses are stored for orders in D1. Define the business's actual retention, backup, customer-support and deletion process before public launch. Do not publish raw order exports or runtime secrets.

## Validation performed

`node --test tests/backend.test.mjs` runs the production validation, config, order, bKash and HTTP-route code against SQLite using the actual generated deployment migration. Only the Cloudflare binding, hosted identity and bKash HTTP responses are mocked. The suite covers stale price rejection, atomic reservations, concurrent buyers, idempotency, duplicate in-progress requests, stale admin saves, payment mismatch rejection, callback replay, query fallback, uncertain outcomes, stock recovery, token reuse, owner access, private order access, rate limits and sandbox fulfillment restrictions.

Passing these tests proves the simulated workflow and database invariants. It does not replace merchant sandbox or live acceptance, callback availability checks, or confirmation of the merchant's supported API version.
