"use client";

import { useId, useState } from "react";
import {
  TextField,
  TextAreaField,
  SelectField,
  Honeypot,
  SubmitButton,
  StatusBanner,
} from "@/components/forms/fields";

const CATEGORIES = [
  "Pokémon US",
  "Pokémon Japanese",
  "Pokémon Chinese",
  "Magic: The Gathering",
  "Basketball",
  "Soccer",
  "One Piece",
  "Other",
];

const FORMATS = ["Pack", "Box", "Bundle", "Case"];

const FULFILLMENT_OPTIONS = ["Pickup — Glendale", "Freight / LTL", "Parcel"];

type LineItem = {
  id: string;
  category: string;
  product: string;
  format: string;
  quantity: string;
  notes: string;
};

function emptyLine(id: string): LineItem {
  return { id, category: "", product: "", format: "", quantity: "", notes: "" };
}

type Status = "idle" | "sending" | "ok" | "error";

export default function OrderForm() {
  const baseId = useId();
  const [rows, setRows] = useState<LineItem[]>([emptyLine(`${baseId}-0`)]);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [startedAt] = useState(() => Date.now());

  function updateRow(id: string, patch: Partial<LineItem>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, emptyLine(`${baseId}-${prev.length}-${Date.now()}`)]);
  }

  function removeRow(id: string) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("sending");
    setError(null);

    const form = e.currentTarget;
    const data = new FormData(form);
    data.set("kind", "order");
    data.set("_start", String(startedAt));
    data.set(
      "lineItems",
      JSON.stringify(
        rows.map(({ id, ...rest }) => rest),
      ),
    );

    try {
      const res = await fetch("/api/forms", { method: "POST", body: data });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Something went wrong. Please try again.");
      }
      setStatus("ok");
      form.reset();
      setRows([emptyLine(`${baseId}-reset`)]);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="relative">
      <div className="absolute -left-3 -top-3 h-full w-full border-2 border-brand-red" aria-hidden />
      <div className="relative border-2 border-white bg-black p-6 md:p-10">
        <Honeypot />

        <div className="grid gap-5">
          <TextField label="Account email" name="accountEmail" type="email" required autoComplete="email" />
          <TextField label="PO / reference number" name="poNumber" />
        </div>

        <fieldset className="mt-8 border-t border-white/10 pt-6">
          <legend className="mb-4 font-display text-xs uppercase tracking-[0.3em] text-brand-red">
            Line items
          </legend>

          <div className="space-y-6">
            {rows.map((row, i) => (
              <div key={row.id} className="border border-white/15 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="font-display text-[10px] uppercase tracking-[0.22em] text-white/50">
                    Item {i + 1}
                  </span>
                  {rows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeRow(row.id)}
                      className="font-display text-[10px] uppercase tracking-[0.22em] text-brand-red hover:text-white"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="font-display text-xs uppercase tracking-[0.22em] text-white/70">
                      Category
                    </span>
                    <select
                      value={row.category}
                      onChange={(e) => updateRow(row.id, { category: e.target.value })}
                      className="mt-2 w-full rounded-none border border-white/20 bg-black px-4 py-3 text-base text-white focus:border-brand-red focus:outline-none"
                    >
                      <option value="" disabled>
                        Select one
                      </option>
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="font-display text-xs uppercase tracking-[0.22em] text-white/70">
                      Product / set name
                    </span>
                    <input
                      type="text"
                      value={row.product}
                      onChange={(e) => updateRow(row.id, { product: e.target.value })}
                      className="mt-2 w-full rounded-none border border-white/20 bg-black px-4 py-3 text-base text-white placeholder:text-white/30 focus:border-brand-red focus:outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="font-display text-xs uppercase tracking-[0.22em] text-white/70">
                      Format
                    </span>
                    <select
                      value={row.format}
                      onChange={(e) => updateRow(row.id, { format: e.target.value })}
                      className="mt-2 w-full rounded-none border border-white/20 bg-black px-4 py-3 text-base text-white focus:border-brand-red focus:outline-none"
                    >
                      <option value="" disabled>
                        Select one
                      </option>
                      {FORMATS.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="font-display text-xs uppercase tracking-[0.22em] text-white/70">
                      Quantity
                    </span>
                    <input
                      type="number"
                      min={1}
                      value={row.quantity}
                      onChange={(e) => updateRow(row.id, { quantity: e.target.value })}
                      className="mt-2 w-full rounded-none border border-white/20 bg-black px-4 py-3 text-base text-white placeholder:text-white/30 focus:border-brand-red focus:outline-none"
                    />
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="font-display text-xs uppercase tracking-[0.22em] text-white/70">
                      Notes
                    </span>
                    <input
                      type="text"
                      value={row.notes}
                      onChange={(e) => updateRow(row.id, { notes: e.target.value })}
                      className="mt-2 w-full rounded-none border border-white/20 bg-black px-4 py-3 text-base text-white placeholder:text-white/30 focus:border-brand-red focus:outline-none"
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>

          <button type="button" onClick={addRow} className="btn-ghost mt-4 !py-3 !px-5 text-sm">
            + Add Line Item
          </button>
        </fieldset>

        <div className="mt-8 grid gap-5 border-t border-white/10 pt-6">
          <SelectField label="Fulfillment" name="fulfillment" required options={FULFILLMENT_OPTIONS} />
          <TextField label="Requested date" name="requestedDate" type="date" />
          <TextAreaField label="Notes" name="notes" />
        </div>

        <SubmitButton pending={status === "sending"}>Submit Order Request</SubmitButton>
        <StatusBanner
          status={status}
          successMessage="Order request received. A Fanzia rep will confirm availability and pricing before any charge."
          errorMessage={error}
        />
      </div>
    </form>
  );
}
