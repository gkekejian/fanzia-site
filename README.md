# Fanzia.io

A clean, modern Next.js 14 (App Router) marketing site for Fanzia, Inc., an
AI and digital growth agency based in Glendale, CA.

Single-page scrolling layout with anchor navigation, Tailwind CSS, Framer
Motion, and a contact form backed by Resend.

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
| `CONTACT_TO_EMAIL`   | Recipient of contact form submissions.               |
| `CONTACT_FROM_EMAIL` | Verified sender address in your Resend account.      |

## Deploying to Vercel

1. Push this repo to GitHub.
2. Import it into Vercel (framework autodetects as Next.js).
3. Add the three env vars above in the Vercel project settings.
4. Point the `fanzia.io` domain at the Vercel project.

## Content edits

Section copy lives in the components under `components/`. Each section is a
single file so copy changes are trivial. No CMS layer.
