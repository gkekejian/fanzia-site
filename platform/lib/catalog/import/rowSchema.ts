import { z } from "zod";
import { parseMoneyToMinor } from "@/lib/format";

const emptyToUndefined = (v: unknown) => (v === "" || v === undefined || v === null ? undefined : v);
const optionalInt = () => z.preprocess(emptyToUndefined, z.coerce.number().int().nonnegative().optional());

/**
 * One row = one product/route/price/availability observation, per build
 * prompt §11's "Match by internal SKU and supplier SKU" step. Every
 * optional column may be blank in a real export (a supplier update might
 * only touch price, not availability, for instance) — see
 * lib/catalog/import/diff.ts for how blanks are treated as "no change
 * proposed for that dimension" rather than "clear this value."
 */
export const catalogImportRowSchema = z.object({
  sku: z.string().trim().min(1, "sku is required"),
  name: z.string().trim().min(1, "name is required"),
  edition_language: z.string().trim().min(1, "edition_language is required"),
  origin: z.string().trim().min(1, "origin is required"),
  condition: z.enum(["sealed", "no_shrink"], { errorMap: () => ({ message: "condition must be sealed or no_shrink" }) }),
  packs_per_unit: z.coerce.number().int().positive("packs_per_unit must be a positive integer"),
  cards_per_pack: optionalInt(),
  release_status: z.string().trim().min(1, "release_status is required"),
  description: z.string().trim().min(1, "description is required"),
  supplier_name: z.string().trim().min(1, "supplier_name is required"),
  route_type: z.enum(["import", "domestic"], { errorMap: () => ({ message: "route_type must be import or domestic" }) }),
  currency_code: z.string().trim().length(3, "currency_code must be a 3-letter ISO code").transform((s) => s.toUpperCase()),
  cost_minor: z.coerce.number().int().nonnegative("cost_minor must be a non-negative integer"),
  markup_bps_override: optionalInt(),
  /**
   * Optional MSRP per wholesale unit as a dollar amount (e.g. 24.99),
   * parsed to minor units at stage time. Blank means "no change proposed"
   * (diff.ts), never "clear the MSRP". Stored on product.msrp_minor at
   * publish; NULL there means unknown and margins are never invented.
   */
  msrp: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .transform((s, ctx) => {
        const minor = parseMoneyToMinor(s);
        if (minor === null) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "msrp must be a dollar amount like 24.99" });
          return z.NEVER;
        }
        return minor;
      })
      .optional(),
  ),
  stock_observed: optionalInt(),
  check_method: z.preprocess(
    emptyToUndefined,
    z.enum(["member_page", "email_quote", "phone", "supplier_confirmation"]).optional(),
  ),
  check_confidence: z.preprocess(emptyToUndefined, z.enum(["observed", "quoted", "confirmed"]).optional()),
  evidence_reference: z.preprocess(emptyToUndefined, z.string().trim().optional()),
});

export type CatalogImportRowInput = z.infer<typeof catalogImportRowSchema>;
