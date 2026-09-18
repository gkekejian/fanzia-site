"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type DraftLine = { productId: string; qtyRequested: number };

/**
 * Shared account-backed draft state for buyer components. Drafts live on
 * the account (server), not in the browser — they survive logout and
 * device switch. `setQty` writes through immediately; the hook guards
 * against out-of-order saves with a monotonically increasing revision.
 */
export function useDraft() {
  const [lines, setLinesState] = useState<DraftLine[] | null>(null);
  const [notes, setNotes] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const linesRef = useRef<DraftLine[]>([]);
  const notesRef = useRef("");
  const revisionRef = useRef(0);

  useEffect(() => {
    fetch("/api/member/draft-request")
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const body = await res.json();
        const next: DraftLine[] = (body.draft?.lines ?? []).filter(
          (l: DraftLine) => l.qtyRequested > 0,
        );
        linesRef.current = next;
        setLinesState(next);
        notesRef.current = body.draft?.notes ?? "";
        setNotes(notesRef.current);
      })
      .catch(() => {
        linesRef.current = [];
        setLinesState([]);
      });
  }, []);

  const persist = useCallback(async (next: DraftLine[], revision: number) => {
    const res = await fetch("/api/member/draft-request", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lines: next, notes: notesRef.current }),
    }).catch(() => null);
    if (revision !== revisionRef.current) return; // superseded by a newer save
    if (!res || !res.ok) {
      const body = res ? await res.json().catch(() => ({})) : {};
      setSaveError(body.error ?? "Could not save your draft. Try again.");
      return;
    }
    setSaveError(null);
  }, []);

  /** Replace the quantity for one product (0 removes the line). Saves through immediately. */
  const setQty = useCallback(
    (productId: string, qty: number) => {
      const clean = Math.max(0, Math.floor(qty));
      const next = linesRef.current.filter((l) => l.productId !== productId);
      if (clean > 0) next.push({ productId, qtyRequested: clean });
      linesRef.current = next;
      setLinesState(next);
      revisionRef.current += 1;
      persist(next, revisionRef.current);
    },
    [persist],
  );

  /** Replace the whole draft (reorder, CSV import). */
  const replaceAll = useCallback(
    (next: DraftLine[]) => {
      const clean = next.filter((l) => l.qtyRequested > 0);
      linesRef.current = clean;
      setLinesState(clean);
      revisionRef.current += 1;
      persist(clean, revisionRef.current);
    },
    [persist],
  );

  /** Persist the current lines + notes on demand (used for debounced notes autosave). */
  const saveNow = useCallback(() => {
    revisionRef.current += 1;
    persist(linesRef.current, revisionRef.current);
  }, [persist]);

  const qtyById = new Map((lines ?? []).map((l) => [l.productId, l.qtyRequested]));

  /** Update notes without touching lines (the draft page debounces the actual save). */
  const updateNotes = useCallback((value: string) => {
    notesRef.current = value;
    setNotes(value);
  }, []);

  return { lines, notes, setNotes: updateNotes, saveNow, qtyById, setQty, replaceAll, saveError };
}
