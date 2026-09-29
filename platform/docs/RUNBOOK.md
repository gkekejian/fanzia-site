# Fanzia platform runbook

For the two owners. Plain language, no code needed. Everything here was
added or verified in the second review pass (2026-09-23).

## The routine

| When | What | Where |
|---|---|---|
| When you get an email | Only "action needed" and urgent items email you (Settings → Notifications). Open the link, decide, done. | Email |
| Any time you have 2 minutes | Open **Today**. If it says "Nothing needs you", close it. | app.fanzia.io/admin |
| Monday morning | Read the weekly digest email: numbers, what's waiting, system problems. | Email |
| Each supplier drop (allocation mode) | Drops → New drop → add products and quantities → Suggest split → adjust → Send offers. Buyers have 48h to Accept & pay; declines and no-responses re-offer automatically (24h). When done: Create supplier round → PO pack → place order → Mark ordered. | Orders → Drops & offers |
| Each supplier drop (self-serve mode) | Supplier round: Pull paid orders → enter what the supplier can fill → Run allocation → Approve. Then PO pack → place order → Mark ordered. | Orders → Supplier rounds |
| Applications closed, someone good asks | Send them a personal invite (link + code, one use, their email only, 14 days). They still go through review. | Buyers → Applications → Invites, or Inbox → waitlist message → Send invite |

The analytics page (Analytics) answers three questions: is it making money,
is demand repeating, and is it running itself (automation rate, owner
touches per order; target is 90% automated).

## One-time setup checklist

1. **Vercel environment variables** (platform project): `DATABASE_URL`
   (Neon pooled URL), `SESSION_SECRET`, `ENCRYPTION_KEY`, `APP_BASE_URL`,
   `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `CRON_SECRET`, `R2_ACCOUNT_ID`,
   `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`,
   `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `BOOTSTRAP_OWNER_EMAILS`.
   System status tells you which are missing.
2. **Stripe webhook** → `https://app.fanzia.io/api/webhooks/stripe` with
   events: `checkout.session.completed`, `payment_intent.succeeded`,
   `payment_intent.payment_failed`, `charge.dispute.created`. (Saving
   cards for Accept & pay uses the same events; nothing extra to add.)
3. **Run the daily job once** after the first deploy: Vercel → Settings →
   Cron Jobs → `/api/cron/ops-sweep` → Run. Until it has run once, the
   uptime endpoint reports red on purpose.
4. **Free uptime monitor** (UptimeRobot, Better Stack): check
   `https://app.fanzia.io/api/public/health` every 5 minutes, alert by SMS.
   It turns red if the database is down or the daily job stopped.
5. **Marketing site**: `NEXT_PUBLIC_PORTAL_URL` (defaults to
   https://app.fanzia.io), `CONTACT_INGEST_URL`, `CONTACT_INGEST_SECRET`.
   Turn on Vercel Web Analytics for the project (Analytics tab → Enable).
6. **Settings** (Admin → Settings): set case sizes on Products, then set
   "Auto-approve repeat orders up to" (e.g. $2,500) once you trust your
   first few buyers.
7. **Allocation selling** (when your first drop is ready): Products → set
   "Sold as" (Booster Box, Booster Pack, Bundle…) and case sizes; then
   Settings → Allocations → "How buyers get product" → Allocation offers.
   Buyers then see "I want this" instead of a cart, and pay offers with a
   saved card. Only tax-exempt (resale certificate verified) accounts get
   offers. Your internal vending account is filled first and keeps
   ordering directly.
8. **Offer deadlines between daily crons** (optional, recommended): in
   GitHub → repo → Settings → Secrets → Actions, add `FANZIA_APP_URL`
   (https://app.fanzia.io) and `FANZIA_CRON_SECRET` (same as
   `CRON_SECRET`). The "Offer deadlines" workflow then moves expired offers
   along every 30 minutes. Without it, deadlines are still processed
   whenever you open Today or a buyer opens Offers, and by the daily job.
9. **2FA**: both owners are sent to set it up on first login. Save the
   recovery codes somewhere that isn't your phone.

## Contingencies

| What goes wrong | How you find out | What happens automatically | What you do |
|---|---|---|---|
| Supplier ships less than was paid for | Round approval screen; "refund owed" email; Today | Each buyer's shortfall becomes a refund owed; card payments are refunded through Stripe if "Auto-refund supplier shortfalls" is on; buyers are emailed | ACH/wire refunds: pay back, then "Mark paid back" on Today. Failed card refund: "Refund to card" retries safely |
| Buyer disputes a card charge (chargeback) | Urgent email + Today | Their account goes on an ordering hold (no new orders, no auto-approval) | Don't ship anything unshipped to them. Answer the dispute in the Stripe dashboard before the deadline. Lift the hold on Today only when resolved |
| Buyer doesn't pay an invoice | Digest (aging), Today, Analytics → Unpaid by age | Dunning reminders at day 3 / 7; day 14 creates a proposal | Decide: void, chase, or place a hold (Accounts → hold) |
| Card payment fails | In-app bell | Nothing is recorded; invoice stays open | Usually nothing; the buyer retries. Repeated failures: contact them |
| Orders pile up while you're busy | "Waiting on you" reminder (one per day), Today shows expiry countdown | Offers auto-extend once; routine repeat orders skip the queue if auto-approve is on | Approve/decline, or raise the auto-approve ceiling |
| You're both away (vacation, busy week) | You know in advance | With **Pause all ordering** on, buyers can browse and build drafts but not submit; your message is shown everywhere | Settings → Ordering → Pause all ordering. Unpause when back |
| Email provider (Resend) down or misconfigured | System status "Email delivery"; in-app warning when an email finally fails | Failed notification emails are queued and retried daily (up to 5 times) | Check Resend domain verification and limits. After 5 failures, contact the recipient directly |
| Stripe webhook missed | Invoice stays unpaid although the buyer paid | Stripe retries webhooks for up to 3 days; duplicates are ignored safely | Stripe → Developers → Webhooks → resend the event |
| Database down (Neon) | Uptime monitor alert; pages error | Settings fall back to safe defaults; marketing site shows the waitlist | Check Neon status/billing. Nothing to repair in the app |
| Daily job stops running | Uptime monitor alert; System status "Daily ops run: Problem" | Nothing (that's the problem) | Check `CRON_SECRET` and Vercel → Cron Jobs; run it manually |
| A deploy's migration fails | The Vercel build fails (migrations run during the build) | Nothing changes: the old version keeps serving | Read the build log; fix forward. Never edit the database by hand |
| Resale certificates not stored | System status "Document storage: Problem" | Nothing | Set the R2 variables. Until then, keep applications closed |
| Spam or bot applications | Inbox / Applications | Applications closed by default; rate limits and Turnstile on public forms | Keep applications closed; invite from the waitlist |
| A session or laptop is compromised | You notice | Sessions expire after 12 hours | Users → Revoke all sessions; reset 2FA for that owner |
| Buyer pays after their offer closed | Urgent email + Today (only if the automatic refund failed) | The payment is recorded and refunded in full; the buyer is emailed. The units were never double-sold | Nothing, unless Today shows a refund to retry |
| Buyer's saved card is declined on Accept & pay | Nothing (it's not an owner task) | They're sent to the secure Stripe page to pay another way; the offer page shows the reason | Nothing. If they let it lapse, it re-offers automatically |
| Nobody takes some units | "Unclaimed" item on Today | Every interested buyer was offered them in turn | Offer by hand on the drop page, lower the quantity to what's taken before ordering, or keep them for vending |
| Supplier confirms a different quantity after offers went out | You hear from the supplier | More: extra units are offered to the next buyers right away. Less: the drop refuses to go below what's already offered or sold | For less: withdraw open offers first (doesn't hurt the buyer's score). Paid shortfalls are refunded through the supplier round as usual |
| Supplier prices change | Price list import shows the diff | Imports refuse prices below the minimum markup | Import the new list, review, publish |

## What each module does (Settings → Modules)

- **Vending**: your own Nayax machines. Daily sales poll, weekly restock draft.
- **Price intelligence**: supplier price comparison, FX, market prices. Off by default.
- **AI operator chat**: dashboard assistant. Off by default.
- **Cashbook**: simple ledger. Off by default; use your accounting software.

Off means: hidden from the menu, its API returns 404, its scheduled job skips.
