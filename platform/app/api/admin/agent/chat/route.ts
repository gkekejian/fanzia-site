import { NextRequest, NextResponse } from "next/server";
import { convertToModelMessages, stepCountIs, streamText, validateUIMessages } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { agentAuditLog } from "@/db/schema";
import { requireActor } from "@/lib/auth/actor";
import { assertOwner } from "@/lib/auth/rbac";
import { clientIp, rateLimited } from "@/lib/rateLimit";
import { createAgentTools } from "@/lib/agent/tools";
import { AGENT_SYSTEM_PROMPT } from "@/lib/agent/systemPrompt";
import { logAgentAudit } from "@/lib/agent/audit";

export const maxDuration = 60;

const CHAT_RATE_LIMIT = { limit: 60, windowMs: 60 * 60 * 1000 };

/**
 * Dashboard AI operator chat. Owner-only (cookie session + TOTP, same as
 * every other /api/admin route); never public. The Anthropic key is read
 * from env at request time — when it's missing the route answers 503 and
 * the panel shows a "not configured" notice instead of erroring.
 */
export async function POST(req: NextRequest) {
  const actor = await requireActor(req);
  if (actor instanceof NextResponse) return actor;
  try {
    assertOwner(actor, "Dashboard AI operator chat");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const owner = actor.user;

  const limited = rateLimited(`agent-chat:${owner.id}`, CHAT_RATE_LIMIT);
  if (limited) return limited;

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "agent_not_configured", message: "Add ANTHROPIC_API_KEY to the project's environment variables to enable the AI operator." },
      { status: 503 },
    );
  }

  let messages;
  try {
    const body = await req.json();
    messages = await validateUIMessages({ messages: body.messages });
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Log owner approval denials. Denied tool calls never reach `execute`,
  // so this inbound scan is the only server-side record of a denial.
  // Dedupe: the same messages are resent on every later request, so a
  // denial is logged once per approval id.
  try {
    for (const message of messages) {
      for (const part of message.parts ?? []) {
        if (
          typeof part.type === "string" &&
          part.type.startsWith("tool-") &&
          (part as { state?: string }).state === "approval-responded" &&
          (part as { approval?: { approved?: boolean; id?: string } }).approval?.approved === false
        ) {
          const approvalId = (part as { approval: { id: string } }).approval.id;
          const toolName = part.type.slice("tool-".length);
          const input = (part as { input?: unknown }).input ?? {};
          const [existing] = await db
            .select({ id: agentAuditLog.id })
            .from(agentAuditLog)
            .where(
              and(
                eq(agentAuditLog.tool, toolName),
                eq(agentAuditLog.approvalDecision, "denied"),
                gte(agentAuditLog.createdAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
                sql`${agentAuditLog.arguments}->>'approvalId' = ${approvalId}`,
              ),
            )
            .limit(1);
          if (!existing) {
            await logAgentAudit({
              actorUserId: owner.id,
              actorRole: owner.role,
              tool: toolName,
              args: { approvalId, ...(typeof input === "object" && input !== null ? input : {}) },
              approvalDecision: "denied",
              resultSummary: "owner declined the approval card",
            });
          }
        }
      }
    }
  } catch {
    // Denial logging is best-effort; never block the chat on it.
  }

  const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const modelId = process.env.FANZIA_AGENT_MODEL?.trim() || "claude-sonnet-5";

  const result = streamText({
    model: anthropic(modelId),
    system: AGENT_SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools: createAgentTools({ owner }),
    stopWhen: stepCountIs(8),
    maxOutputTokens: 4000,
    onError: ({ error }) => {
      console.error("[agent-chat] stream error", { ip: clientIp(req.headers), error: String(error).slice(0, 500) });
    },
  });

  return result.toUIMessageStreamResponse();
}
