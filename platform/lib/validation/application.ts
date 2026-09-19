import { z } from "zod";

/**
 * Deliberately does not collect an EIN anywhere (build prompt §8). Fields
 * mirror exactly what §8 says is sufficient: business identity, address,
 * seller's permit number, and channel evidence. A honeypot field
 * ("website") is included and must be empty — same pattern as the
 * marketing site's existing contact-form protection.
 */
export const applicationSchema = z.object({
  businessLegalName: z.string().min(2).max(200),
  channelType: z.enum([
    "vending",
    "smoke_shop_convenience",
    "asian_specialty_retail",
    "live_seller",
    "event_seller",
    "other",
  ]),
  addressLine1: z.string().min(3).max(200),
  addressLine2: z.string().max(200).optional().default(""),
  city: z.string().min(1).max(100),
  state: z.string().min(2).max(50),
  postalCode: z.string().min(3).max(20),
  country: z.string().min(2).max(2).default("US"),
  contactName: z.string().min(2).max(200),
  contactEmail: z.string().email(),
  channelEvidenceUrl: z.string().url().optional().or(z.literal("")).default(""),
  sellersPermitNumber: z.string().max(60).optional().default(""),
  // Berman-compliant clickwrap: submission is blocked server-side, not
  // just client-side, unless this is explicitly true (build prompt §12).
  termsAccepted: z.literal(true, {
    errorMap: () => ({ message: "You must check the box to accept the Terms of Sale to submit an application." }),
  }),
  website: z.string().max(0).optional().default(""), // honeypot
  // Cloudflare Turnstile client token. Verified server-side against
  // Cloudflare's siteverify endpoint; fail-open when the secret key is
  // not configured (see lib/turnstile.ts). nullish because the client
  // sends null when the widget is absent or unsolved — rejecting null
  // here would block legitimate applicants while Turnstile is off.
  turnstileToken: z.string().max(2048).nullish().default(""),
});

export type ApplicationInput = z.infer<typeof applicationSchema>;
