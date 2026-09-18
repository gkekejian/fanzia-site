"use client";

import { useCallback, useEffect, useState } from "react";

type Slot = {
  id: string;
  machineId: string;
  slotPosition: number;
  productId: string;
  capacityUnits: number;
  active: boolean;
  sku: string;
  productName: string;
};

type Machine = {
  id: string;
  nayaxMachineId: number;
  name: string;
  location: string;
  active: boolean;
  slots: Slot[];
};

type RestockParam = {
  productId: string;
  leadTimeDays: number;
  safetyStockDays: number;
  reviewPeriodDays: number;
  minOrderUnits: number;
  preferredCaseSku: string | null;
  caseUnits: number;
  trialQty: number | null;
  active: boolean;
  sku: string;
  productName: string;
};

type DraftLine = {
  productId: string;
  sku: string;
  name: string;
  units: number;
  cases: number;
  caseUnits: number;
  flags: string[];
  perMachine: {
    machineName: string;
    velocity: number;
    onHand: number | null;
    daysOfCover: number | null;
    suggestedUnits: number;
    flags: string[];
  }[];
};

type Draft = {
  id: string;
  weekKey: string;
  source: string;
  status: string;
  lines: DraftLine[];
};

type Product = { id: string; sku: string; name: string };

type Dashboard = {
  configured: boolean;
  suggestionDay: string;
  weekKey: string;
  machines: Machine[];
  restockParams: RestockParam[];
  latestRun: { weekKey: string; runAt: string; lines: unknown[] } | null;
  draft: Draft | null;
  products: Product[];
};

const FLAG_CLASS: Record<string, string> = {
  urgent: "badge-bad",
  watch: "badge-warn",
  NEW: "badge-ok",
  "low-data": "badge-warn",
  "baseline-unknown": "badge-warn",
};

function Flag({ flag }: { flag: string }) {
  return <span className={`badge ${FLAG_CLASS[flag] ?? ""}`}>{flag}</span>;
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

export function NayaxConsole() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"planogram" | "params" | "suggestions">("suggestions");
  const [verify, setVerify] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      setData(await api("/api/admin/nayax"));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  async function mutate(action: string, payload: Record<string, unknown>) {
    setBusy(true);
    try {
      await api("/api/admin/nayax/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verifyConnection() {
    setVerify("Checking…");
    try {
      const v = await api("/api/admin/nayax/verify");
      setVerify(
        v.ok
          ? `Connected — ${v.machineCount} machine(s): ${v.machineNames.map((m: { name: string }) => m.name).join(", ")}`
          : `Not connected: ${v.error}`,
      );
    } catch (err) {
      setVerify(`Check failed: ${(err as Error).message}`);
    }
  }

  async function recordRestock(machineId: string) {
    if (!window.confirm("Record a full restock of every active slot on this machine?")) return;
    try {
      const r = await api("/api/admin/nayax/restock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ machineId }),
      });
      setError(null);
      alert(`Restock recorded for ${r.machine} (${r.slots.length} slots).`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function importCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    setBusy(true);
    try {
      const r = await api("/api/admin/nayax/import", { method: "POST", body: form });
      setError(null);
      alert(
        `Imported: ${r.inserted} new, ${r.skipped} already known, ${r.quarantinedCount} quarantined for review.`,
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  if (!data && !error) return <main className="container"><p aria-live="polite">Loading…</p></main>;
  if (error && !data)
    return (
      <main className="container">
        <p className="field-error" role="alert">{error}</p>
      </main>
    );

  const d = data!;
  const draftLines = d.draft?.lines ?? [];

  function editLine(lineIdx: number, field: "units" | "cases", value: number) {
    const lines = draftLines.map((l, i) => (i === lineIdx ? { ...l, [field]: value } : l));
    mutate("update-draft-lines", { draftId: d.draft!.id, lines });
  }

  return (
    <main className="container" style={{ maxWidth: "1200px" }}>
      <h1>Vending (Nayax)</h1>
      <p>
        Sales-driven restock suggestions for the Glendale and Lakewood machines. The engine proposes —
        suggested lines appear in the open allocation round as INTERNAL requests, and nothing is allocated
        until the owner runs the round.
      </p>
      {error && <p className="field-error" role="alert">{error}</p>}

      <section style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center", marginBottom: "1.5rem" }}>
        <button type="button" className="btn btn-secondary" onClick={verifyConnection} disabled={busy}>
          Verify connection
        </button>
        {verify && <span aria-live="polite">{verify}</span>}
        {!d.configured && (
          <span className="badge badge-warn">
            NAYAX_API_TOKEN not set — CSV import works; API polling is off.
          </span>
        )}
        <label className="btn btn-secondary" style={{ cursor: "pointer" }}>
          Import CSV
          <input type="file" accept=".csv,text/csv" onChange={importCsv} style={{ display: "none" }} />
        </label>
        <label>
          Suggestion day:&nbsp;
          <select
            value={d.suggestionDay}
            disabled={busy}
            onChange={(e) => mutate("set-suggestion-day", { day: e.target.value })}
          >
            {["monday","tuesday","wednesday","thursday","friday","saturday","sunday"].map((day) => (
              <option key={day} value={day}>{day.charAt(0).toUpperCase() + day.slice(1)}</option>
            ))}
          </select>
        </label>
      </section>

      <nav aria-label="Nayax sections" style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem" }}>
        {(["suggestions", "planogram", "params"] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={tab === t ? "btn" : "btn btn-secondary"}
            onClick={() => setTab(t)}
          >
            {t === "suggestions" ? "Suggestions" : t === "planogram" ? "Planogram" : "Restock params"}
          </button>
        ))}
      </nav>

      {tab === "suggestions" && (
        <section>
          <h2>This week&rsquo;s suggestion — week {d.weekKey}</h2>
          {!d.draft && <p>No draft this week yet. The engine runs on {d.suggestionDay} inside the daily ops sweep.</p>}
          {d.draft && (
            <>
              <p>
                Status: <span className="badge">{d.draft.status}</span>{" "}
                {d.draft.status === "draft" && (
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm("Approve this restock draft? The INTERNAL lines already in the open round keep their requested quantities; approval records your review.")) {
                        mutate("approve-draft", { draftId: d.draft!.id });
                      }
                    }}
                  >
                    Approve draft
                  </button>
                )}
              </p>
              {draftLines.length === 0 && <p>No SKUs suggested this week — machines are above their reorder points.</p>}
              {draftLines.length > 0 && (
                <table>
                  <caption className="visually-hidden">Weekly vending restock suggestion</caption>
                  <thead>
                    <tr>
                      <th scope="col">SKU</th>
                      <th scope="col">Velocity / on-hand</th>
                      <th scope="col">Cover</th>
                      <th scope="col">Suggested units</th>
                      <th scope="col">Cases</th>
                      <th scope="col">Flags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draftLines.map((line, i) => (
                      <tr key={line.productId}>
                        <td>
                          <strong>{line.sku}</strong>
                          <br />
                          <small>{line.name}</small>
                        </td>
                        <td>
                          {line.perMachine.map((m) => (
                            <div key={m.machineName}>
                              <small>
                                {m.machineName}: {m.velocity}/day, on-hand {m.onHand ?? "?"}
                              </small>
                            </div>
                          ))}
                        </td>
                        <td>
                          {line.perMachine.map((m) => (
                            <div key={m.machineName}>
                              <small>
                                {m.daysOfCover == null ? "—" : `${m.daysOfCover}d`}
                              </small>
                            </div>
                          ))}
                        </td>
                        <td>
                          {d.draft!.status === "draft" ? (
                            <input
                              type="number"
                              min={0}
                              value={line.units}
                              style={{ width: "5rem" }}
                              onChange={(e) => editLine(i, "units", Number(e.target.value) || 0)}
                              aria-label={`Suggested units for ${line.sku}`}
                            />
                          ) : (
                            line.units
                          )}
                        </td>
                        <td>
                          {d.draft!.status === "draft" ? (
                            <input
                              type="number"
                              min={0}
                              value={line.cases}
                              style={{ width: "4rem" }}
                              onChange={(e) => editLine(i, "cases", Number(e.target.value) || 0)}
                              aria-label={`Cases for ${line.sku}`}
                            />
                          ) : (
                            line.cases
                          )}{" "}
                          <small>× {line.caseUnits}</small>
                        </td>
                        <td>
                          {line.flags.map((f) => (
                            <Flag key={f} flag={f} />
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p>
                <small>
                  Latest engine run: {d.latestRun ? `${d.latestRun.weekKey} at ${new Date(d.latestRun.runAt).toLocaleString()}` : "never"}.
                  Quantities are editable until approval. Urgent = below the safety-stock cover line.
                </small>
              </p>
            </>
          )}
        </section>
      )}

      {tab === "planogram" && (
        <section>
          <h2>Planogram — machine → slots → SKU</h2>
          <p>Without this map, sales are anonymous slot numbers and the engine is blind. Audit both machines before launch.</p>
          {d.machines.map((m) => (
            <div key={m.id} style={{ marginBottom: "1.5rem" }}>
              <h3>
                {m.name} ({m.location}) — Nayax ID {m.nayaxMachineId}{" "}
                {!m.active && <span className="badge badge-bad">inactive</span>}
              </h3>
              <button type="button" className="btn btn-secondary" onClick={() => recordRestock(m.id)}>
                I restocked this machine
              </button>
              {m.slots.length === 0 && <p>No slots mapped yet.</p>}
              {m.slots.length > 0 && (
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Slot</th>
                      <th scope="col">SKU</th>
                      <th scope="col">Product</th>
                      <th scope="col">Capacity</th>
                      <th scope="col">Active</th>
                      <th scope="col"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.slots.map((s) => (
                      <tr key={s.id}>
                        <td>{s.slotPosition}</td>
                        <td>{s.sku}</td>
                        <td>{s.productName}</td>
                        <td>{s.capacityUnits}</td>
                        <td>{s.active ? "yes" : "no"}</td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ padding: "0.2rem 0.6rem" }}
                            onClick={() => {
                              if (window.confirm(`Remove slot ${s.slotPosition} from the planogram?`)) {
                                mutate("delete-slot", { machineId: m.id, slotPosition: s.slotPosition });
                              }
                            }}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <SlotForm machineId={m.id} products={d.products} onSubmit={(payload) => mutate("upsert-slot", payload)} busy={busy} />
            </div>
          ))}
          <MachineForm onSubmit={(payload) => mutate("upsert-machine", payload)} busy={busy} />
        </section>
      )}

      {tab === "params" && (
        <section>
          <h2>Restock parameters</h2>
          <p>Lead time, safety stock, review period, case size, and trial quantity per product. Untuned products use engine defaults (14d lead / 7d safety / 7d review).</p>
          {d.restockParams.length === 0 && <p>No per-product params set yet.</p>}
          {d.restockParams.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th scope="col">SKU</th>
                  <th scope="col">Lead (d)</th>
                  <th scope="col">Safety (d)</th>
                  <th scope="col">Review (d)</th>
                  <th scope="col">MOQ</th>
                  <th scope="col">Case units</th>
                  <th scope="col">Trial qty</th>
                  <th scope="col">Case label</th>
                </tr>
              </thead>
              <tbody>
                {d.restockParams.map((p) => (
                  <tr key={p.productId}>
                    <td><strong>{p.sku}</strong><br /><small>{p.productName}</small></td>
                    <td>{p.leadTimeDays}</td>
                    <td>{p.safetyStockDays}</td>
                    <td>{p.reviewPeriodDays}</td>
                    <td>{p.minOrderUnits}</td>
                    <td>{p.caseUnits}</td>
                    <td>{p.trialQty ?? "—"}</td>
                    <td>{p.preferredCaseSku ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <ParamForm products={d.products} onSubmit={(payload) => mutate("upsert-params", payload)} busy={busy} />
        </section>
      )}
    </main>
  );
}

function SlotForm({ machineId, products, onSubmit, busy }: {
  machineId: string;
  products: Product[];
  onSubmit: (p: Record<string, unknown>) => void;
  busy: boolean;
}) {
  const [slotPosition, setSlotPosition] = useState("");
  const [sku, setSku] = useState("");
  const [capacityUnits, setCapacityUnits] = useState("40");
  return (
    <form
      style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem", flexWrap: "wrap", alignItems: "end" }}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ machineId, slotPosition: Number(slotPosition), sku, capacityUnits: Number(capacityUnits) });
      }}
    >
      <label>Slot <input type="number" value={slotPosition} onChange={(e) => setSlotPosition(e.target.value)} style={{ width: "4rem" }} required /></label>
      <label>Product{" "}
        <select value={sku} onChange={(e) => setSku(e.target.value)} required>
          <option value="">— pick —</option>
          {products.map((p) => <option key={p.id} value={p.sku}>{p.sku} — {p.name}</option>)}
        </select>
      </label>
      <label>Capacity <input type="number" min={1} value={capacityUnits} onChange={(e) => setCapacityUnits(e.target.value)} style={{ width: "4rem" }} required /></label>
      <button type="submit" className="btn btn-secondary" disabled={busy}>Save slot</button>
    </form>
  );
}

function MachineForm({ onSubmit, busy }: { onSubmit: (p: Record<string, unknown>) => void; busy: boolean }) {
  const [nayaxMachineId, setNayaxMachineId] = useState("");
  const [name, setName] = useState("");
  const [location, setLocation] = useState("glendale");
  return (
    <form
      style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", flexWrap: "wrap", alignItems: "end" }}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ nayaxMachineId: Number(nayaxMachineId), name, location });
        setNayaxMachineId(""); setName("");
      }}
    >
      <h3 style={{ width: "100%" }}>Register a machine</h3>
      <label>Nayax MachineID <input type="number" value={nayaxMachineId} onChange={(e) => setNayaxMachineId(e.target.value)} style={{ width: "8rem" }} required /></label>
      <label>Name <input value={name} onChange={(e) => setName(e.target.value)} required /></label>
      <label>Location{" "}
        <select value={location} onChange={(e) => setLocation(e.target.value)}>
          <option value="glendale">Glendale</option>
          <option value="lakewood">Lakewood</option>
        </select>
      </label>
      <button type="submit" className="btn btn-secondary" disabled={busy}>Register</button>
    </form>
  );
}

function ParamForm({ products, onSubmit, busy }: {
  products: Product[];
  onSubmit: (p: Record<string, unknown>) => void;
  busy: boolean;
}) {
  const [productId, setProductId] = useState("");
  const [lead, setLead] = useState("14");
  const [safety, setSafety] = useState("7");
  const [review, setReview] = useState("7");
  const [moq, setMoq] = useState("1");
  const [caseUnits, setCaseUnits] = useState("36");
  const [trialQty, setTrialQty] = useState("");
  const [caseLabel, setCaseLabel] = useState("");
  return (
    <form
      style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", flexWrap: "wrap", alignItems: "end" }}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          productId, leadTimeDays: Number(lead), safetyStockDays: Number(safety),
          reviewPeriodDays: Number(review), minOrderUnits: Number(moq),
          caseUnits: Number(caseUnits), trialQty: trialQty ? Number(trialQty) : null,
          preferredCaseSku: caseLabel || null,
        });
      }}
    >
      <h3 style={{ width: "100%" }}>Set parameters</h3>
      <label>Product{" "}
        <select value={productId} onChange={(e) => setProductId(e.target.value)} required>
          <option value="">— pick —</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
        </select>
      </label>
      <label>Lead (d) <input type="number" min={0} value={lead} onChange={(e) => setLead(e.target.value)} style={{ width: "4rem" }} /></label>
      <label>Safety (d) <input type="number" min={0} value={safety} onChange={(e) => setSafety(e.target.value)} style={{ width: "4rem" }} /></label>
      <label>Review (d) <input type="number" min={0} value={review} onChange={(e) => setReview(e.target.value)} style={{ width: "4rem" }} /></label>
      <label>MOQ <input type="number" min={1} value={moq} onChange={(e) => setMoq(e.target.value)} style={{ width: "4rem" }} /></label>
      <label>Case units <input type="number" min={1} value={caseUnits} onChange={(e) => setCaseUnits(e.target.value)} style={{ width: "4rem" }} /></label>
      <label>Trial qty <input type="number" min={1} value={trialQty} onChange={(e) => setTrialQty(e.target.value)} style={{ width: "4rem" }} placeholder="—" /></label>
      <label>Case label <input value={caseLabel} onChange={(e) => setCaseLabel(e.target.value)} placeholder="booster box of 36" /></label>
      <button type="submit" className="btn btn-secondary" disabled={busy}>Save params</button>
    </form>
  );
}
