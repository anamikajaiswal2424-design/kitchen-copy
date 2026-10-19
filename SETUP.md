# Kitchan payment flow setup

The old MongoDB receipt-ledger payment implementation has been removed. This
store now uses the same flow as `Kitchan`:

1. `/api/initiate-payment` creates a `TXN...` order reference and returns the
   PhonePe, Paytm and UPI QR links.
2. PhonePe opens its native collect screen and keeps the waiting loader open.
   It is intentionally not tracked, matching Kitchan.
3. Paytm and Scan QR start `/api/verify-payment` long polling.
4. The API checks Paytm Order Status using `PAYTM_MID` + the transaction ID.
5. A confirmed transaction opens `success.html`, which shows the Kitchan thank
   you message and transaction details. A terminal failure opens `failed.html`.

The target store's existing server-side product pricing remains enabled, so a
browser cannot choose its own payable amount.

## Environment variables

Copy `.env.example` into your deployment environment and set:

- `PAYTM_UPI_ID` (required): receiver UPI VPA.
- `PAYTM_MERCHANT_NAME`: name displayed by Paytm and in the UPI QR.
- `PHONEPE_MERCHANT_NAME`: name displayed by PhonePe.
- `PAYTM_MID` (required for tracking): Paytm merchant ID.
- `PAYTM_ENV=test` only when using Paytm staging; omit it for production.
- `NEXT_PUBLIC_META_PIXEL_ID` and `NEXT_PUBLIC_META_EXTRA_PIXELS` are optional.

If `PAYTM_MID` is not set, Paytm/QR verification remains pending, exactly as in
Kitchan. This project needs Vercel or another host that supports Node serverless
functions; static-only hosting cannot run the two payment APIs.

## Payment UI behavior

- PhonePe is selected by default.
- The three methods are PhonePe, Paytm and Scan QR.
- Paytm/PhonePe show the sticky verification modal. The cancel action appears
  after 60 seconds; Paytm keeps polling while the modal is active.
- Scan QR supports download/share, shows the five-minute countdown and starts
  Paytm status tracking immediately.
- The Android/browser back button is guarded while a payment modal is open.

## Verification

Run `npm test`. The tests cover authoritative pricing, intent contents, Paytm
success/failure/pending mapping, API validation, pixel events and existing
storefront invariants. No live payment is performed by the test suite.

## Purchase delivery at payment confirmation

Purchase is now sent by `/api/verify-payment` through Meta Conversions API as
soon as Paytm confirms success, before any success-page navigation. The browser
also queues the matching pixel event at that point. Opening success.html alone
no longer records a purchase. Both use `purchase:TXN...` as the event ID for
Meta deduplication across webhook retries, polling and browser events.

Set server-only `META_ACCESS_TOKEN`, `META_PIXEL_ID` (the dataset authorized by
the token), and `STORE_URL`. Do not commit the credential. Extra browser pixels
need their own authorized CAPI configuration if they also need server events.

Configure Paytm's payment-status webhook URL as
`https://YOUR-DOMAIN/api/payment-webhook`. This endpoint independently rechecks
Paytm instead of trusting callback status/amount. It returns 503 on pending
verification, missing Meta configuration or delivery failure so a retry-capable
gateway can redeliver. Confirm webhook retry behavior in your merchant account.
Without this webhook, tracking still requires an active browser poll. There is
no background job or durable event queue in this repository.

PhonePe's current P2P collect link has no server confirmation integration.
Reliable PhonePe Purchase events require a merchant gateway with an authenticated
status API/webhook; this patch does not treat launching an app as payment success.

Webhook events currently have an order-based hashed external ID only; browser
poll events additionally use shopper IP, user agent and existing Meta cookies.
For stronger webhook attribution, persist shopper matching data with the order
in a database and retrieve it here. No real payment or live Meta event is sent
by the automated tests.
