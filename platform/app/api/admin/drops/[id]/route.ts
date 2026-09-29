import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireActor } from "@/lib/auth/actor";
import {
  cancelDrop,
  cancelOffer,
  closeDrop,
  createSupplierRound,
  getDropDetail,
  offerLeftovers,
  removeDropItem,
  sendDrop,
  setDropDeadline,
  setDropItem,
  setProposal,
  suggestDrop,
} from "@/lib/offers/drops";
import { OfferError } from "@/lib/offers/context";

/**
 * Owner-only drop detail and actions.
 *
 * GET  -> DropDetail (runs due deadlines first)
 * POST -> { action, ... } where action is one of:
 *   setItem { productId, availableQty, unitPriceMinor?, increment? }
 *   removeItem { itemId } · suggest · setProposal { itemId, plan: [{accountId, qty}] }
 *   setDeadline { offersCloseAt: "YYYY-MM-DDTHH:mm" (Pacific) }
 *   send · close · cancel · cancelOffer { offerId } · offerLeftovers { itemId } · supplierRound
 */
async function owner(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return { error: actor };
  if (actor.kind !== "owner") return { error: NextResponse.json({ error: "Owner access required." }, { status: 403 }) };
  return { ownerId: actor.user.id };
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await owner(req);
  if (gate.error) return gate.error;
  try {
    return NextResponse.json(await getDropDetail(db, params.id));
  } catch (err) {
    if (err instanceof OfferError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await owner(req);
  if (gate.error) return gate.error;
  const ownerId = gate.ownerId;
  const json = (await req.json().catch(() => null)) ?? {};
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  try {
    switch (json.action) {
      case "setItem":
        await setDropItem(db, ownerId, params.id, json);
        break;
      case "removeItem":
        await removeDropItem(db, ownerId, params.id, str(json.itemId));
        break;
      case "setDeadline":
        await setDropDeadline(db, ownerId, params.id, json.offersCloseAt);
        break;
      case "suggest":
        await suggestDrop(db, ownerId, params.id);
        break;
      case "setProposal":
        await setProposal(db, ownerId, params.id, str(json.itemId), json.plan);
        break;
      case "send":
        await sendDrop(db, ownerId, params.id);
        break;
      case "close":
        await closeDrop(db, ownerId, params.id);
        break;
      case "cancel":
        await cancelDrop(db, ownerId, params.id);
        break;
      case "cancelOffer":
        await cancelOffer(db, ownerId, params.id, str(json.offerId));
        break;
      case "offerLeftovers":
        await offerLeftovers(db, ownerId, params.id, str(json.itemId));
        break;
      case "supplierRound": {
        const result = await createSupplierRound(db, ownerId, params.id);
        return NextResponse.json({ ok: true, ...result });
      }
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
    return NextResponse.json({ ok: true, detail: await getDropDetail(db, params.id) });
  } catch (err) {
    if (err instanceof OfferError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
