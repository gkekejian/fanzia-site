# Fanzia.io

A clean, modern Next.js 14 (App Router) marketing site for Fanzia, a
Southern California trading card retailer and wholesale supplier based in
Glendale, CA.

Multi-route site (Home, Store, Products, Wholesale, Catalog, Supply, About,
Contact, Policies) built with Tailwind CSS and Framer Motion. Every form on
the site (contact, wholesale application, catalog access, wholesale orders,
supply parts quotes) posts to a serverless API route backed by Resend — no
database, no auth.

## Stack

- Next.js 14 (App Router) + TypeScript
- Tailwind CSS
- Framer Motion for scroll animations
- Resend for transactional email (optional, logs to stdout if unset)
- Deployed on Vercel

## Local development

```bash
npm install
cp .env.example .env.local   # fill in values if you want email delivery
npm run dev
```

The site runs on http://localhost:3000.

## Environment variables

| Variable             | Purpose                                              |
| -------------------- | ---------------------------------------------------- |
| `RESEND_API_KEY`     | Resend API key. If unset, submissions are logged.    |
| `CONTACT_TO_EMAIL`   | Recipient of all form submissions (contact, wholesale, catalog, supply). |
| `CONTACT_FROM_EMAIL` | Verified sender address in your Resend account.      |

These three variables cover every form on the site — `/api/contact` handles
the general contact form, and `/api/forms` handles the wholesale
application, catalog access request, wholesale order request, and supply
parts quote (routed by a `kind` field on each form).

## Deploying to Vercel

1. Push this repo to GitHub.
2. Import it into Vercel (framework autodetects as Next.js).
3. Add the three env vars above in the Vercel project settings.
4. Point the `fanzia.io` domain at the Vercel project.

## Content edits

Page and section copy lives in the components under `components/` and
`app/*/page.tsx`. Seed data (retail locations, organized play events, store
photos) lives under `content/` as plain TypeScript arrays. No CMS layer.

Copy still marked `{{TODO: ...}}` needs a real value before launch — search
the repo for that marker to find every instance.
