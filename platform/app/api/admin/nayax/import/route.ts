import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner, ForbiddenError } from "@/lib/auth/rbac";
import { db } from "@/db/client";
import { recordAudit } from "@/lib/audit";
import { findMachineByNayaxId, ingestSales } from "@/lib/nayax/ingest";
import type { LynxLastSale } from "@/lib/nayax/client";

/**
 * Owner-only CSV import fallback (design §3.1: "George can upload a CSV to
 * bootstrap history on day one"). The import flows through the same
 * normalize → resolve → idempotent-upsert pipeline as the API poll
 * (source='csv'), so API and CSV rows dedupe on the same nayax_txn_id key.
 *
 * Expected columns (header row, any order, extra columns ignored):
 *   nayax_machine_id, transaction_id, slot_position, product_name,
 *   quantity, amount_cents, sold_at (ISO-8601)
 *
 * Returns counts plus the quarantine list for planogram gaps.
 */

const EXPECTED = [
  "nayax_machine_id",
  "transaction_id",
  "slot_position",
  "product_name",
  "quantity",
  "amount_cents",
  "sold_at",
] as const;

/** Minimal CSV parser: handles quoted fields and embedded commas/newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c === "\r") {
      // skip; \n handles the break
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

export async function POST(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Nayax CSV import");
  } catch (err) {
    if (err instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    throw err;
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Expected a multipart form with a 'file' field." }, { status: 400 });
  }
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "CSV exceeds the 5 MB import limit." }, { status: 400 });
  }
  const text = await file.text();
  const rows = parseCsv(text);
  if (rows.length < 2) {
    return NextResponse.json({ error: "CSV is empty (no data rows)." }, { status: 400 });
  }

  const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  if (EXPECTED.some((c) => idx(c) === -1)) {
    return NextResponse.json(
      { error: `Missing required column(s). Expected: ${EXPECTED.join(", ")}` },
      { status: 400 },
    );
  }

  // Group rows by machine so each batch ingests against the right planogram.
  const byMachine = new Map<number, LynxLastSale[]>();
  const badRows: { row: number; reason: string }[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r] ?? [];
    const machineId = Number(cells[idx("nayax_machine_id")]);
    const slot = Number(cells[idx("slot_position")]);
    if (!Number.isFinite(machineId)) {
      badRows.push({ row: r + 1, reason: "invalid nayax_machine_id" });
      continue;
    }
    const cell = (name: string) => cells[idx(name)] ?? "";
    const sale: LynxLastSale = {
      TransactionID: cell("transaction_id"),
      MachineID: machineId,
      ProductName: cell("product_name"),
      Quantity: Number(cell("quantity")) || 1,
      AuthorizationValue: cell("amount_cents") ? Number(cell("amount_cents")) : undefined,
      AuthorizationDateTimeGMT: cell("sold_at"),
      SlotPosition: Number.isFinite(slot) ? Math.floor(slot) : undefined,
    };
    if (!byMachine.has(machineId)) byMachine.set(machineId, []);
    byMachine.get(machineId)!.push(sale);
  }

  const machineResults: Record<string, { inserted: number; skipped: number; quarantined: number }> = {};
  const quarantined: unknown[] = [];
  let inserted = 0;
  let skipped = 0;
  for (const [nayaxMachineId, sales] of byMachine) {
    const machine = await findMachineByNayaxId(db, nayaxMachineId);
    if (!machine) {
      badRows.push({
        row: 0,
        reason: `Nayax machine ${nayaxMachineId} is not registered in the platform — add it under /admin/nayax first.`,
      });
      continue;
    }
    const result = await ingestSales(db, machine.id, sales, "csv", (row) => {
      const n = Number((row as Record<string, unknown>).SlotPosition);
      return Number.isFinite(n) ? Math.floor(n) : null;
    });
    machineResults[machine.name] = {
      inserted: result.inserted,
      skipped: result.skipped,
      quarantined: result.quarantined.length,
    };
    inserted += result.inserted;
    skipped += result.skipped;
    quarantined.push(...result.quarantined.map((q) => ({ machine: machine.name, ...q })));
  }

  await recordAudit(
    {
      actorType: actor.kind,
      // assertOwner above narrows actor to the owner branch.
      actorUserId: actor.user.id,
      action: "nayax.csv_import",
      entityType: "nayax_sale",
      after: { inserted, skipped, quarantined: quarantined.length, badRows: badRows.length, machines: machineResults },
    },
    db,
  );

  return NextResponse.json({ inserted, skipped, quarantined, quarantinedCount: quarantined.length, badRows, machineResults });
}
