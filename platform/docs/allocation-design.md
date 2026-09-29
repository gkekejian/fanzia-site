# Allocation model + invite codes (design, 2026-09-29)

Owner decisions captured in chat on 2026-09-29. This is the spec the code
implements; if the code and this file disagree, one of them is a bug.

## 1. What changes for buyers

Before: buyers picked products from the catalog, submitted an order request,
an owner approved it, the buyer paid, then Fanzia bought from the supplier.

After (the "Rolex model"):

1. The catalog is an **interest list**. Buyers mark what they want and how
   many, in that product's own selling unit (booster pack, box, bundle,
   case). They cannot place orders themselves.
2. Fanzia creates a **drop** (one upcoming supplier release or buy) and the
   system proposes who gets how much. The owner edits and approves.
3. Each chosen buyer receives an **offer**: a fixed quantity at a fixed price.
   All or nothing, valid for 48 hours.
4. The buyer taps **Accept & pay**: the card on file is charged on the spot.
   Accepting *is* paying. There is no accepted-but-unpaid state.
5. Declined, expired or failed offers are **re-offered automatically** to the
   next buyer in line (24-hour window).
6. When the drop closes, paid offers become the supplier order through the
   existing supplier-round flow (fill entry, shortfall refunds, PO pack).

Fanzia still never buys before being paid ("pre-sell, then buy").

## 2. Owner decisions (verbatim intent)

| Topic | Decision |
|---|---|
| Inventory | Pre-sell: offer, buyer pays, then Fanzia buys |
| Catalog | Becomes an interest list (buyers can't order) |
| Units | Quantities in each product's own unit: pack, box, bundle, case, etc. |
| Who gets offers | System scores buyers and proposes a split; owner edits and approves |
| Internal vending account | Filled first, before any offers |
| Offer shape | All or nothing |
| Order rules | $500 minimum / $25 fee / $5,000 first-order cap do **not** apply to offers. Unit increments still do |
| Accepting | One tap "Accept & pay" charges the saved card; falls back to Stripe Checkout (which saves the card) |
| Card fees | Absorbed, priced into markup. No surcharge |
| Offer window | 48 hours (Settings); re-offers 24 hours (Settings) |
| Leftovers | Auto-offered to the next buyer in line |
| Declines | Every decline or no-response lowers the buyer's score |
| Eligibility | Tax-exempt external accounts (verified resale cert) + the internal account. Nothing is ever taxed at offer time |
| Invites | Personal, single use, tied to the invitee's email, 14-day expiry (Settings), created from a waitlist entry or typed in. Application still goes through normal review |
| Hosting | Vercel Hobby: no hourly cron. Deadlines are processed lazily + daily + optional external pinger |

## 3. Data model (migration 0030)

- `product.sell_unit` (text, nullable): the unit a quantity counts, e.g.
  "Booster Pack", "Box", "Bundle", "Case". NULL falls back to the name
  heuristic (`unitNoun`). The **increment** is `units_per_case` when
  "Sell full cases only" is on and a case size is set, else 1.
- `application_invite`: hashed code (raw code is shown once and emailed,
  never stored), invitee email + name, expiry, used/revoked timestamps,
  the application it produced, optional source waitlist message.
- `application.invite_id`: which invite an application came in on.
- `buyer_interest`: (account, product) → desired quantity. Unique per pair.
- `allocation_drop`: name, optional supplier, status
  `draft → live → closed` (or `cancelled`), offer/re-offer windows
  snapshotted at send time, link to the supplier round created at close.
- `allocation_drop_item`: product, unit price (snapshotted from the catalog,
  editable while draft), quantity available, increment snapshot.
- `allocation_offer`: one buyer's offer for one item: qty, unit price,
  total, status, wave (1 = first offers, 2+ = re-offers), deadline,
  invoice link, Stripe Checkout session, score snapshot.
- `account`: Stripe customer id + saved card (payment method id, brand,
  last 4, expiry). Card numbers never touch Fanzia; Stripe holds them.
- `invoice.allocation_offer_id` (unique): the offer an invoice pays for.

## 4. Offer state machine

```
proposed ──send──▶ offered ──Accept & pay──▶ paying ──payment recorded──▶ accepted
    │                 │  │                      │  │
    │ (drop cancel)   │  │ decline              │  └─ charge failed, still in window ─▶ paying (retry)
    ▼                 │  ▼                      │
 cancelled ◀──────────┘ declined                ├─ decline ─▶ declined (invoice voided)
                      │                         └─ deadline + checkout closed, unpaid ─▶ expired (invoice voided)
                      └─ deadline ─▶ expired
internal account: proposed ──send──▶ reserved (no invoice, no payment)
```

- Every transition is a conditional UPDATE (`WHERE status = <expected>`),
  so a double click, a retried webhook or two browser tabs can't apply a
  transition twice.
- One live offer (proposed/offered/paying) per buyer per item (partial
  unique index).
- The invoice is created at the **first** Accept & pay and reused for any
  retry, so one offer never has more than one invoice. If the offer dies
  unpaid, the invoice is voided (numbers stay sequential; voids are normal).
- Checkout sessions for offers expire no later than the offer deadline,
  but at least 30 minutes after creation (Stripe's minimum). A `paying`
  offer is only expired after both its deadline and its checkout session
  have passed.
- **Late payment safety net**: if money arrives for an offer that is no
  longer live (expired/declined/cancelled, units already re-offered),
  the payment is recorded, a full refund is issued to the card when
  Stripe is configured, a `refund_due` row is created either way, and
  both owners get an urgent alert. Stock is never double-sold.

## 5. Proposed split (the "suggested split")

Per drop item:

1. **Internal first**: the internal account's interest quantity (rounded
   down to the increment) is reserved, capped at what's available.
2. **Candidates**: eligible external accounts with interest in the product
   (active contact, tax-exempt, no ordering hold). Need = desired qty.
3. **Turn-based fill**: candidates sorted by score (highest first; ties →
   older account, then id). Each pass gives every candidate whose
   remaining need is at least one increment one increment, until stock
   runs out. Higher scores get served first on every pass, and nobody
   gets everything while others get nothing.
4. The owner can change any quantity (whole increments only), remove a
   buyer, or add an eligible buyer who didn't mark interest. The total can
   never exceed what's available.

Accounts that can't receive offers are listed with the reason (needs tax
review, on hold, no active contact) so nobody silently disappears.

## 6. Buyer score (0-100, shown to owners only)

Computed over the trailing 12 months:

| Part | Points | Rule |
|---|---|---|
| Spend | 40 | Paid invoice totals; full points at $25,000, square-root curve below |
| Payment speed | 20 | Median days from invoice sent to cleared: ≤2 days full, ≥14 days zero. No history: 10 |
| Offer acceptance | 30 | accepted ÷ (accepted + declined + expired). Every decline and no-response counts. No offer history: 15 |
| Tenure | 10 | Months as an account, full at 12 |

Neutral defaults for new accounts mean a newcomer is neither punished nor
favored. Accounts on hold are excluded, not scored down. The breakdown is
stored on each offer (`score_snapshot`) so "why did they get 4 cases?" can
always be answered later.

## 7. Re-offers

When an offer is declined, expires, or is withdrawn while the drop is live,
its units go back to the item's pool. The pool is re-offered immediately to
the next candidates using the same turn-based rule, excluding anyone who
already passed on that item in this drop, and counting what each buyer
already holds against their desired quantity. Re-offers get the re-offer
window (24h). If nobody is left, the units show as **Unclaimed** on the drop
and on Today; the owner either offers them by hand or orders less from the
supplier.

## 8. Deadlines on Vercel Hobby

Hobby allows one cron run per day, so deadlines are processed:

- every time a buyer opens Offers, accepts or declines;
- every time an owner opens Drops, a drop, or Today;
- in the daily ops sweep;
- optionally by `/api/cron/offers` every 15 minutes from a free GitHub
  Actions schedule (`.github/workflows/offer-deadlines.yml`, does nothing
  until the `CRON_SECRET` and `PORTAL_URL` repository secrets are set).

Processing is idempotent, so running it from several places at once is safe.

## 9. Invites

- Owner creates an invite from a waitlist message ("Send invite") or by
  typing name + email. The invitee gets an email with
  `/apply?invite=CODE`; the owner sees the link once.
- While applications are closed, `/apply` without a valid invite shows the
  waitlist notice. With one, it shows the form with the email locked.
- The API re-checks everything server-side: code valid, not used, not
  revoked, not expired, and the application email matches the invite email.
  The invite is consumed in the same database transaction that creates the
  application, so one code can never produce two applications.
- Invited applications are reviewed like any other; the review screen shows
  "Invited by <owner>".

## 10. Selling mode switch

Settings → Ordering → "How buyers get product": **Allocation offers**
(default, this design) or **Self-serve ordering** (the old catalog + order
requests). In allocation mode external buyers can't submit order requests
(the API refuses, not only the UI). The internal account keeps self-serve
ordering for vending restocks either way. Order requests already submitted
before the switch still work normally.

## 11. Accounting notes (for your bookkeeper)

- Offer payments arrive **before** Fanzia buys the product. Until the
  product ships, that cash is a customer deposit (a liability), not revenue.
  Recognize revenue at shipment.
- Supplier shortfalls are refunded through the existing round flow; the
  refund reverses part of the deposit.
- Stripe fees (≈2.9% + 30¢) are a cost of sales. They're absorbed, so keep
  them in mind when setting markups.
- Offers only go to tax-exempt buyers, so no sales tax is collected on
  them. Keep each buyer's resale certificate on file (the platform stores
  it with the application).

## 12. Legal/copy to review with your attorney

- The buyer-facing Offers page says allocation priority considers purchase
  history and how the buyer responds to offers.
- Terms of Sale still describe order requests; add a clause covering
  allocation offers (fixed quantity, accept-by-paying, all sales final,
  supplier shortfall refunds).
