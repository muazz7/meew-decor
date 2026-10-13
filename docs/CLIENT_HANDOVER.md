# Meew Decor — client handover

Prepared 13 October 2026.

The website and commerce workflow are built for review. **Live bKash selling is disabled.** Merchant activation, confirmed commercial details and public launch checks are still required before accepting real online orders.

Planned private review address: [meew-decor.bouncygrape.chatgpt.site](https://meew-decor.bouncygrape.chatgpt.site). Availability and access at this address were **not yet verified** when this document was prepared. A private review link is not a public store or a working bKash callback destination.

## Business and design direction

The source business is [Meew Decor on Facebook](https://www.facebook.com/people/Meew-Decor/61590528366514/), page ID `61590528366514`. Its public contact information is:

| Detail | Information used on the website |
| --- | --- |
| Phone | [01793-097608](tel:+8801793097608) |
| Email | [meewcraftdecor@gmail.com](mailto:meewcraftdecor@gmail.com) |
| Location | Bosila, Mohammadpur, Dhaka, Bangladesh |
| Messenger | [Message Meew Decor](https://m.me/61590528366514) |
| Bengali tagline | প্রতিটি ঘরের জন্য মনোরম সাজসজ্জা |

The visible collection centers on floor lamps, a wooden bangle organiser and a woven basket with a stand. The page's home imagery combines warm lighting, wood, greenery and soft textures. This supports a home décor identity with a calm, personal presentation.

The website interprets that identity through warm ivory, forest green, muted coral, generous product photography and editorial typography. A small curated collection suits the currently evidenced range: customers can see the pieces clearly, understand their intended setting and contact the shop without navigating a large department-store structure. This is a design judgment based on the page and products, not a claim about measured audience demographics or conversion results.

The shopping path is collection → product details → bag → delivery details → bKash → private order status. Search, category filters, saved pieces and mobile navigation help visitors return to a particular product. The existing Messenger, phone and email channels remain available while online ordering is prepared.

## Collection and photograph sources

The four website titles below are descriptive catalog labels based on the page's photographs. Exact specifications, official product names, inclusions and current availability require owner confirmation. No price, discount, stock figure, warranty or delivery promise has been invented.

| Website product | Description supported by the photograph | Asset and source |
| --- | --- | --- |
| Sculptural Floor Lamp | A tall, dark-toned, open-frame lamp with a light cylindrical shade. Confirm dimensions, finish and bulb details. | `public/images/sculptural-lamp.jpg` — [Facebook photograph](https://www.facebook.com/photo.php?fbid=122163157833350945) |
| Wooden Bangle Organiser | A wooden display with three rails, a lower tray and a handle-shaped top detail. Confirm size and whether accessories are included. | `public/images/bangle-organiser.jpg` — [Facebook photograph](https://www.facebook.com/photo.php?fbid=122162498397350945) |
| Woven Basket & Stand | A basket-shaped piece with a woven appearance on a wooden stand. Confirm actual materials, dimensions, liner and intended use. | `public/images/woven-planter.jpg` — [Facebook photograph](https://www.facebook.com/photo.php?fbid=122162038281350945) |
| Tripod Floor Lamp | A wooden tripod-style stand with a light drum shade. Confirm height, finish and electrical specifications. | `public/images/tripod-lamp.jpg` — [Facebook photograph](https://www.facebook.com/photo.php?fbid=122162133747350945) |

The brand-story image, `public/images/brand-home.jpg`, comes from the [business page's cover photograph](https://www.facebook.com/profile.php?id=61590528366514). The sculptural-lamp photograph is also used in the homepage hero. Product source links are retained in `lib/catalog.ts` and on product-detail views. The owner should approve these photographs for website use before public launch.

## What is built

- A responsive storefront with product details, search, category filtering, sorting, saved pieces, shopping bag and quantity controls.
- A manual enquiry path that prepares a product list for the customer to copy into Messenger. The website does not send it automatically.
- Checkout forms for Bangladesh delivery details and two delivery zones, with prices and totals checked on the server.
- A bKash payment adapter and persisted orders with inventory reservation, duplicate-request protection and provider verification before an order can be marked paid.
- Private order-status links showing payment and delivery progress without exposing the customer's address or phone number.
- A protected owner dashboard for commercial settings, orders, payment reconciliation and fulfillment updates.

No real payment has been taken. Merchant sandbox and live acceptance have not been completed. Automated email/SMS notifications, courier booking and automated refunds are not integrated; these remain part of the business's existing operations.

## Using the owner studio

1. Open `/admin` on the configured website. Sign in with ChatGPT using the email approved as `STORE_ADMIN_EMAIL`. This is an owner-only area; Facebook credentials are not used.
2. In **Collection**, enter confirmed BDT prices and available quantities. Enable only products that are ready to sell, then choose **Save changes**. An enabled product needs both a price and stock quantity.
3. In **Store settings**, enter the inside-Dhaka and outside-Dhaka delivery charges, the actual delivery policy and the approved return/refund policy. Review **Payment readiness** and save your changes.
4. Enable checkout only as part of the launch process below. The server keeps checkout unavailable while required configuration is missing. Sandbox orders are identified as tests and cannot be fulfilled.
5. In **Orders**, review payment status and the delivery details. Use **Check payment** for pending or uncertain payments. Do not ask the customer to pay again while the payment outcome is unresolved.
6. For a verified live paid order, set **Processing**, **Shipped** or **Delivered**, add the courier/tracking details and choose **Update order**. There is no manual “mark paid” control.
7. Refresh orders to see recent activity; use **Load earlier orders** when available. Counts and filters apply to the orders currently loaded.

Stock shown in the dashboard is available stock: pending checkouts can already reserve quantities. If a save reports that stock or settings changed, reload the saved settings and review the latest quantities before editing again. Do not overwrite a newer inventory value from an old copy of the dashboard.

Product names, descriptions, photographs and the addition of new products currently require a developer to update the catalog and assets. They are not editable through this dashboard.

## Before public selling

The owner and developer must complete these items together:

- Confirm the four products' prices, stock, specifications and included accessories; approve the images and public contact information.
- Confirm delivery coverage, both rates, delivery expectations, returns/refunds and the business's order-data retention process.
- Configure the approved owner email and the hosted owner sign-in, then check access to `/admin`.
- Supply the existing bKash merchant credentials securely in hosting configuration. Never place credentials in chat, product descriptions or source code.
- Ask bKash to confirm the merchant's supported API version. The current adapter targets Tokenized Checkout `v1.2.0-beta`, checkout-only mode `0011`; compatibility must be confirmed before activation. A v2-only merchant needs the adapter updated and tested.
- Make the approved store address publicly accessible, configure its canonical HTTPS URL and meet the merchant's callback/domain requirements. Confirm the intended public audience and hosting access settings.
- Complete merchant-approved sandbox tests, including success, cancellation, delayed/uncertain payments and stock changes. Then complete the merchant-approved live activation procedure with matching live credentials.

Keep live selling disabled until these checks pass. The detailed environment variables, payment behavior, operational limits and acceptance steps are in [BKASH_INTEGRATION.md](./BKASH_INTEGRATION.md).
