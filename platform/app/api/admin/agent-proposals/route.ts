import { NextRequest, NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/db/client";
import { agentProposal } from "@/db/schema";
import { requireActor } from "@/lib/auth/actor";

export async function GET(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;

  const rows = await db.select().from(agentProposal).orderBy(desc(agentProposal.createdAt));
  return NextResponse.json({ proposals: rows });
}
