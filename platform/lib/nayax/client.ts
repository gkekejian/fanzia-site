/**
 * Lynx Operational API client (https://lynx.nayax.com/operational).
 *
 * Auth: long-lived user token from Nayax Core (Account Settings →
 * Security and Login → User Tokens), sent as `Authorization: Bearer`.
 * The token is read from process.env.NAYAX_API_TOKEN ONLY — it is never
 * logged, returned, or embedded in any response (see
 * app/api/admin/nayax/verify/route.ts, which deliberately returns counts
 * and names only).
 *
 * Lynx has no webhooks (brief §1/§7); v1 builds sales history by polling
 * lastSales. NOTE: Vercel Hobby cron runs at most once daily, so the
 * 15-minute polling the design doc (§3.1) wants is impossible on this
 * plan — the daily ops sweep polls, and the CSV import route covers gaps.
 */

export class NayaxNotConfigured extends Error {
  constructor() {
    super(
      "NAYAX_API_TOKEN is not set. Mint a user token in Nayax Core " +
        "(Account Settings → Security and Login → User Tokens) and set it " +
        "as the NAYAX_API_TOKEN env var.",
    );
    this.name = "NayaxNotConfigured";
  }
}

export class NayaxApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(`Nayax Lynx API error (HTTP ${status}): ${message}`);
    this.name = "NayaxApiError";
    this.status = status;
  }
}

const LYNX_BASE = "https://lynx.nayax.com/operational";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 4; // initial try + 3 retries
const BACKOFF_BASE_MS = 1_000;

/** Read the token from the environment only. Throws NayaxNotConfigured. */
export function getNayaxToken(): string {
  const token = process.env.NAYAX_API_TOKEN;
  if (!token) throw new NayaxNotConfigured();
  return token;
}

/** True when the connector can talk to Lynx (cheap, no network). */
export function isNayaxConfigured(): boolean {
  return Boolean(process.env.NAYAX_API_TOKEN);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(attempt: number, res: Response): number {
  const retryAfter = res.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60_000);
  }
  return BACKOFF_BASE_MS * 2 ** attempt;
}

function isRetryable(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function redactTokenFrom(text: string, token: string): string {
  return token ? text.split(token).join("[REDACTED]") : text;
}

/** Fetch with timeout + exponential backoff on 429/5xx, honoring Retry-After. */
async function lynxFetch(path: string, token: string): Promise<unknown> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${LYNX_BASE}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (res.ok) return (await res.json()) as unknown;
      if (isRetryable(res.status) && attempt < MAX_ATTEMPTS - 1) {
        await sleep(retryDelayMs(attempt, res));
        continue;
      }
      const body = redactTokenFrom(await res.text().catch(() => ""), token);
      throw new NayaxApiError(res.status, body.slice(0, 500));
    } catch (err) {
      if (err instanceof NayaxApiError) throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
      // Abort/timeout and network errors are retryable too.
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(BACKOFF_BASE_MS * 2 ** attempt);
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  const msg = redactTokenFrom(lastError?.message ?? "request failed", token);
  throw new NayaxApiError(0, `Lynx unreachable after ${MAX_ATTEMPTS} attempts: ${msg.slice(0, 300)}`);
}

export type LynxMachine = {
  MachineID: number;
  MachineName?: string;
  MachineNumber?: string;
  SiteName?: string;
  [key: string]: unknown;
};

export type LynxMachineSummary = {
  machineId: number;
  name: string;
  number: string | null;
  site: string | null;
};

/** GET /v1/machines — list the operator's machines (read-only). */
export async function listMachines(): Promise<LynxMachineSummary[]> {
  const token = getNayaxToken();
  const rows = (await lynxFetch("/v1/machines", token)) as LynxMachine[];
  return (Array.isArray(rows) ? rows : []).map((m) => ({
    machineId: m.MachineID,
    name: String(m.MachineName ?? `Machine ${m.MachineID}`),
    number: m.MachineNumber != null ? String(m.MachineNumber) : null,
    site: m.SiteName != null ? String(m.SiteName) : null,
  }));
}

/**
 * Raw Lynx lastSales row (brief §3). ProductName is a name string, not a
 * SKU — resolution to platform products happens in lib/nayax/ingest.ts via
 * the slot planogram.
 */
export type LynxLastSale = {
  TransactionID?: number | string;
  MachineID?: number;
  ProductName?: string;
  Quantity?: number;
  AuthorizationValue?: number;
  SettlementValue?: number;
  AuthorizationDateTimeGMT?: string;
  MachineAuthorizationTime?: string;
  [key: string]: unknown;
};

/**
 * GET /v1/machines/{id}/lastSales — recent transactions for one machine.
 * No date-range parameters exist; this is a "latest N" window, so the
 * caller must persist every row idempotently (see ingest.ts).
 */
export async function lastSales(machineId: number): Promise<LynxLastSale[]> {
  const token = getNayaxToken();
  const rows = (await lynxFetch(`/v1/machines/${machineId}/lastSales`, token)) as LynxLastSale[];
  return Array.isArray(rows) ? rows : [];
}
