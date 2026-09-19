import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { db as defaultDb } from "@/db/client";
import {
  agentSuggestion,
  application,
  catalogImport,
  orderRequest,
  product,
  productPricingFlag,
  type OrderRequestLine,
} from "@/db/schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

const DAY_MS = 24 * 60 * 60 * 1000;

function weekKey(d: Date): string {
  const oneJan = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - oneJan.getTime()) / DAY_MS + oneJan.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

async function alreadySuggested(db: AnyDb, dedupeKey: string, withinMs: number, now: Date): Promise<boolean> {
  const [row] = await db
    .select({ id: agentSuggestion.id })
    .from(agentSuggestion)
    .where(and(eq(agentSuggestion.dedupeKey, dedupeKey), gte(agentSuggestion.createdAt, new Date(now.getTime() - withinMs))))
    .limit(1);
  return !!row;
}

async function insertSuggestion(
  db: AnyDb,
  kind: "margin_alert" | "restock_idea" | "market_brief" | "ops_nudge",
  title: string,
  body: string,
  dedupeKey: string,
  payload: unknown = null,
) {
  await db.insert(agentSuggestion).values({ kind, title, body, dedupeKey, payload });
}

/**
 * Rule-based daily suggestion generator (no LLM). Each rule is isolated in
 * try/catch so one bad query can't kill the whole run. Dedupe: a suggestion
 * is skipped when the same dedupeKey was already written inside its window.
 */
export async function generateAgentSuggestions(
  db: AnyDb = defaultDb,
  now: Date = new Date(),
): Promise<{ inserted: number; byKind: Record<string, number> }> {
  const byKind: Record<string, number> = {};
  const count = (kind: string) => {
    byKind[kind] = (byKind[kind] ?? 0) + 1;
  };
  let inserted = 0;
  const put = async (
    kind: "margin_alert" | "restock_idea" | "market_brief" | "ops_nudge",
    title: string,
    body: string,
    dedupeKey: string,
    dedupeWindowMs: number,
    payload: unknown = null,
  ) => {
    if (await alreadySuggested(db, dedupeKey, dedupeWindowMs, now)) return;
    await insertSuggestion(db, kind, title, body, dedupeKey, payload);
    inserted += 1;
    count(kind);
  };

  // 1. Review queue nudge: applications waiting > 48h.
  try {
    const cutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const waiting = await db
      .select({
        id: application.id,
        businessLegalName: application.businessLegalName,
        status: application.status,
        submittedAt: application.submittedAt,
      })
      .from(application)
      .where(
        and(
          inArray(application.status, ["submitted", "needs_review"]),
          lte(application.submittedAt, cutoff),
        ),
      )
      .orderBy(desc(application.submittedAt))
      .limit(20);
    if (waiting.length > 0) {
      const names = waiting.map((w) => w.businessLegalName).join(", ");
      await put(
        "ops_nudge",
        `${waiting.length} application${waiting.length === 1 ? "" : "s"} waiting over 48h`,
        `Oldest first: ${names}. Review them in /admin/applications.`,
        `ops:review_queue:${now.toISOString().slice(0, 10)}`,
        DAY_MS,
        { applicationIds: waiting.map((w) => w.id) },
      );
    }
  } catch {
    /* rule skipped */
  }

  // 2. Approved-but-unpublished catalog imports.
  try {
    const staged = await db
      .select({ id: catalogImport.id, originalFilename: catalogImport.originalFilename })
      .from(catalogImport)
      .where(eq(catalogImport.status, "approved"))
      .limit(10);
    for (const imp of staged) {
      await put(
        "ops_nudge",
        `Catalog import approved but not published: ${imp.originalFilename}`,
        `Publish it from /admin/catalog-imports (or ask the chat to publish it) to make the new prices live.`,
        `ops:unpublished_import:${imp.id}`,
        7 * DAY_MS,
        { importId: imp.id },
      );
    }
  } catch {
    /* rule skipped */
  }

  // 3. Order requests expiring within 48h.
  try {
    const soon = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const expiring = await db
      .select({ id: orderRequest.id, expiresAt: orderRequest.expiresAt, subtotalMinor: orderRequest.subtotalMinor })
      .from(orderRequest)
      .where(and(eq(orderRequest.status, "submitted"), lte(orderRequest.expiresAt, soon), gte(orderRequest.expiresAt, now)))
      .limit(10);
    for (const o of expiring) {
      await put(
        "ops_nudge",
        `Offer expiring within 48h: ${o.id.slice(0, 8)} ($${(o.subtotalMinor / 100).toFixed(2)})`,
        `The buyer offer expires ${o.expiresAt ? new Date(o.expiresAt).toISOString() : "soon"}. After one silent rollover it needs buyer reacceptance.`,
        `ops:expiring_offer:${o.id}`,
        3 * DAY_MS,
        { orderRequestId: o.id },
      );
    }
  } catch {
    /* rule skipped */
  }

  // 4 + 6. "What's hot" market brief + repeat-order restock ideas (last 30d).
  try {
    const since = new Date(now.getTime() - 30 * DAY_MS);
    const recent = await db
      .select({ lines: orderRequest.lines })
      .from(orderRequest)
      .where(gte(orderRequest.createdAt, since))
      .limit(500);
    const qtyByProduct = new Map<string, { sku: string; name: string; qty: number; orders: number }>();
    for (const r of recent) {
      const lines = (r.lines ?? []) as OrderRequestLine[];
      for (const l of lines) {
        if (!l || !l.productId) continue;
        const cur = qtyByProduct.get(l.productId) ?? { sku: l.sku ?? "", name: l.name ?? "", qty: 0, orders: 0 };
        cur.qty += l.qtyRequested ?? 0;
        cur.orders += 1;
        qtyByProduct.set(l.productId, cur);
      }
    }
    const ranked = [...qtyByProduct.entries()].sort((a, b) => b[1].qty - a[1].qty);
    if (ranked.length > 0) {
      const top = ranked.slice(0, 5);
      const [topId, topStats] = top[0] as [string, { sku: string; name: string; qty: number; orders: number }];
      const lines = top.map(([, s], i) => `${i + 1}. ${s.name || s.sku} — ${s.qty} units across ${s.orders} orders`).join("\n");
      await put(
        "market_brief",
        `What's hot (last 30 days): ${topStats.name || topStats.sku} leads`,
        `Top sellers by units requested:\n${lines}\n\nThis is the market knowledge buyers pay for — share it in the weekly buyer update.`,
        `brief:hot:${weekKey(now)}`,
        7 * DAY_MS,
        { top: top.map(([id, s]) => ({ productId: id, ...s })) },
      );
      for (const [id, s] of ranked.filter(([, s]) => s.orders >= 2).slice(0, 10)) {
        await put(
          "restock_idea",
          `Keep stocked: ${s.name || s.sku}`,
          `Ordered in ${s.orders} separate orders (${s.qty} units) in the last 30 days. Make sure the next sourcing batch covers it.`,
          `restock:repeat:${id}`,
          14 * DAY_MS,
          { productId: id, orders: s.orders, qty: s.qty },
        );
      }
    }
  } catch {
    /* rule skipped */
  }

  // 5. Margin alerts: active products whose pricing is still estimated.
  try {
    const flagged = await db
      .select({ id: product.id, sku: product.sku, name: product.name })
      .from(product)
      .innerJoin(productPricingFlag, eq(productPricingFlag.productId, product.id))
      .where(and(eq(product.status, "active"), eq(productPricingFlag.isReal, "estimated")))
      .limit(10);
    for (const p of flagged) {
      await put(
        "margin_alert",
        `Pricing still estimated: ${p.sku}`,
        `${p.name} is active in the catalog but its pricing is flagged as estimated, not real. Margin math on it is unreliable until pricing is confirmed.`,
        `margin:estimated:${p.id}`,
        14 * DAY_MS,
        { productId: p.id },
      );
    }
  } catch {
    /* rule skipped */
  }

  // 7. New arrivals brief: products activated in the last 14 days.
  try {
    const since = new Date(now.getTime() - 14 * DAY_MS);
    const fresh = await db
      .select({ id: product.id, sku: product.sku, name: product.name })
      .from(product)
      .where(and(eq(product.status, "active"), eq(product.publiclyVisible, true), gte(product.createdAt, since)))
      .limit(10);
    if (fresh.length > 0) {
      const lines = fresh.map((p) => `• ${p.name} (${p.sku})`).join("\n");
      await put(
        "market_brief",
        `New arrivals (${fresh.length} in the last 14 days)`,
        `Recently activated in the catalog:\n${lines}\n\nFlag these in the buyer update — new product is what keeps buyers checking back.`,
        `brief:new:${weekKey(now)}`,
        7 * DAY_MS,
        { products: fresh.map((p) => ({ id: p.id, sku: p.sku, name: p.name })) },
      );
    }
  } catch {
    /* rule skipped */
  }

  return { inserted, byKind };
}
