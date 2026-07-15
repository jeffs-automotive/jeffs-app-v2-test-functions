"use client";

/**
 * Card Text tab — edit the "main copy" (eyebrow/title/description/footnote +
 * in-body prose) on each wizard card. Feature: card-text-editor.
 *
 * Two zones (spec .claude/work/design/card-text-editor-spec.md §2): a
 * Workshop-Brass PICKER rail (admin's own shadcn chrome) framing a faithful
 * "card on a workbench" — a byte-faithful Heritage CANVAS (HeritageCardPreview
 * + the scoped .heritage-preview stylesheet) with a sticky save bar.
 *
 * FUNCTIONAL contract (unchanged, only re-dressed): imperative save with a
 * plain `saving` flag (NOT useActionState — that re-suspends sibling
 * /schedulerconfig tabs on the force-dynamic route), setCardTextAction /
 * resetCardTextAction, the Zod-validated { card_key, slot_key, body,
 * expected_updated_at } args, validateCardTextBody / renderCardTextSample,
 * per-row `expected_updated_at` staleness, sonner toasts, router.refresh().
 *
 * A card with no CARD_PREVIEW_MANIFEST entry yet falls back to the plain
 * per-slot field list, so nothing breaks as follow-on cards seed their rows
 * before their manifest lands.
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Info, RotateCcw, Save } from "lucide-react";

import "./card-preview.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { CardTextRow } from "@/lib/scheduler/read-dal";
import { validateCardTextBody } from "@/lib/scheduler/card-merge-fields";
import { setCardTextAction } from "@/actions/scheduler/direct-config-actions";
import { getCardPreviewManifest } from "./card-preview-manifest";
import { HeritageCardPreview } from "./HeritageCardPreview";
import { CardTextFallbackEditor } from "./CardTextFallbackEditor";

/** Friendly picker labels for cards without a manifest yet. */
const CARD_DISPLAY_NAMES: Record<string, string> = {
  greeting: "Greeting",
};

function cardLabel(key: string): string {
  return CARD_DISPLAY_NAMES[key] ?? key.replace(/_/g, " ");
}

/** Picker groupings = wizard phases (scannability only, NOT a data contract). */
const GROUP_ORDER: Array<{ key: string; label: string }> = [
  { key: "identity", label: "Welcome & Identity" },
  { key: "vehicle", label: "Vehicle" },
  { key: "concerns", label: "Concerns" },
  { key: "scheduling", label: "Scheduling" },
  { key: "confirmation", label: "Confirmation" },
  { key: "other", label: "Other" },
];

export function CardTextDirectTab({ rows }: { rows: CardTextRow[] }) {
  const router = useRouter();

  const cardKeys = useMemo(
    () => Array.from(new Set(rows.map((r) => r.card_key))),
    [rows],
  );
  const [selected, setSelected] = useState<string>(cardKeys[0] ?? "");
  const [search, setSearch] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [pendingCard, setPendingCard] = useState<string | null>(null);

  const selectedRows = useMemo(
    () =>
      rows
        .filter((r) => r.card_key === selected)
        .sort((a, b) => a.sort - b.sort),
    [rows, selected],
  );
  const rowsBySlot = useMemo(
    () => Object.fromEntries(selectedRows.map((r) => [r.slot_key, r])),
    [selectedRows],
  );
  const manifest = getCardPreviewManifest(selected);
  const cardName = manifest?.display_name ?? cardLabel(selected);

  // Seed/reseed the editable values when the selected card or the underlying
  // rows change (router.refresh() after a save re-seeds → dirty clears).
  useEffect(() => {
    setValues(Object.fromEntries(selectedRows.map((r) => [r.slot_key, r.body])));
  }, [selectedRows]);

  const valueOf = (row: CardTextRow) => values[row.slot_key] ?? row.body;

  const dirtySlots = useMemo(
    () => selectedRows.filter((r) => valueOf(r) !== r.body),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedRows, values],
  );
  const dirtyCount = dirtySlots.length;
  const anyInvalid = useMemo(
    () =>
      selectedRows.some(
        (r) => !validateCardTextBody(valueOf(r), r.allowed_merge_fields).ok,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedRows, values],
  );
  const anyResettable = selectedRows.some((r) => valueOf(r) !== r.default_body);

  const cards = useMemo(
    () =>
      cardKeys.map((key) => {
        const m = getCardPreviewManifest(key);
        const cardRows = rows.filter((r) => r.card_key === key);
        return {
          key,
          name: m?.display_name ?? cardLabel(key),
          group: m?.group ?? "other",
          customized: cardRows.some((r) => r.body !== r.default_body),
        };
      }),
    [cardKeys, rows],
  );

  const filteredCards = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? cards.filter((c) => c.name.toLowerCase().includes(q)) : cards;
  }, [cards, search]);

  function selectCard(key: string) {
    if (key === selected) return;
    if (dirtyCount > 0) {
      setPendingCard(key);
      return;
    }
    setSelected(key);
  }

  function onChange(slotKey: string, next: string) {
    setValues((v) => ({ ...v, [slotKey]: next }));
  }

  function onResetSlot(slotKey: string) {
    const row = rowsBySlot[slotKey];
    if (row) setValues((v) => ({ ...v, [slotKey]: row.default_body }));
  }

  function resetAll() {
    setValues(
      Object.fromEntries(selectedRows.map((r) => [r.slot_key, r.default_body])),
    );
  }

  async function saveAll() {
    if (saving || anyInvalid || dirtyCount === 0) return;
    setSaving(true);
    const toSave = dirtySlots;
    try {
      const results = await Promise.all(
        toSave.map(async (row) => ({
          row,
          res: await setCardTextAction({
            card_key: row.card_key,
            slot_key: row.slot_key,
            body: valueOf(row),
            expected_updated_at: row.updated_at,
          }),
        })),
      );
      let okCount = 0;
      let staleCount = 0;
      let failCount = 0;
      for (const { row, res } of results) {
        if (res.status === "success") {
          okCount++;
        } else if (res.status === "stale") {
          staleCount++;
          toast.warning(`“${row.label}” changed since you loaded it`, {
            description: res.error,
          });
        } else if (
          res.status === "validation_error" ||
          res.status === "error"
        ) {
          failCount++;
          toast.error(`Couldn't save ${row.label}`, { description: res.error });
        }
      }
      if (okCount > 0 && failCount === 0 && staleCount === 0) {
        toast.success(
          `Saved ${okCount} field${okCount > 1 ? "s" : ""} on ${cardName}`,
          { description: "Live on the booking wizard within ~5 minutes." },
        );
      } else if (okCount > 0) {
        toast.success(
          `Saved ${okCount} of ${toSave.length} field${toSave.length > 1 ? "s" : ""} on ${cardName}`,
        );
      }
      // Re-seed from fresh rows only when nothing failed, so a failed field's
      // unsaved edit is never lost.
      if (failCount === 0 && (okCount > 0 || staleCount > 0)) router.refresh();
    } catch (e) {
      toast.error("Couldn't save changes", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No editable card wording yet. It seeds with the built-in copy on first
        deploy.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div
        role="note"
        className="flex items-start gap-2 rounded-md border border-primary/20 bg-primary/5 p-3 text-sm text-foreground"
      >
        <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        <p>
          Edits publish to the live booking wizard within ~5 minutes. Buttons
          and layout are fixed here — only the wording changes. Per-tile option
          copy lives on the <strong>Appointment Types</strong> tab.
        </p>
      </div>

      {/* Mobile picker */}
      <div className="flex items-center gap-3 lg:hidden">
        <label htmlFor="card-text-picker" className="text-sm font-medium">
          Card
        </label>
        <select
          id="card-text-picker"
          value={selected}
          onChange={(e) => selectCard(e.target.value)}
          className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
        >
          {GROUP_ORDER.map((g) => {
            const inGroup = cards.filter((c) => c.group === g.key);
            if (inGroup.length === 0) return null;
            return (
              <optgroup key={g.key} label={g.label}>
                {inGroup.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
        {dirtyCount > 0 ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-foreground">
            <span className="size-1.5 rounded-full bg-amber-500" aria-hidden="true" />
            {dirtyCount} unsaved
          </span>
        ) : null}
      </div>

      <div className="lg:grid lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-6">
        {/* Picker rail (admin chrome) */}
        <aside className="hidden lg:block">
          <div className="rounded-xl bg-card p-3 shadow-xs ring-1 ring-foreground/10">
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search cards…"
              aria-label="Search cards"
              className="mb-3"
            />
            <nav aria-label="Wizard cards" className="space-y-3">
              {GROUP_ORDER.map((g) => {
                const inGroup = filteredCards.filter((c) => c.group === g.key);
                if (inGroup.length === 0) return null;
                return (
                  <div key={g.key}>
                    <p className="mb-1 px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      {g.label}
                    </p>
                    <ul className="space-y-0.5">
                      {inGroup.map((c) => {
                        const active = c.key === selected;
                        return (
                          <li key={c.key}>
                            <button
                              type="button"
                              onClick={() => selectCard(c.key)}
                              aria-current={active ? "true" : undefined}
                              className={cn(
                                "flex min-h-9 w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
                                active
                                  ? "bg-primary/10 text-primary"
                                  : "text-foreground hover:bg-muted",
                              )}
                            >
                              <span className="truncate">{c.name}</span>
                              <span className="flex shrink-0 items-center gap-1.5">
                                {active && dirtyCount > 0 ? (
                                  <span className="inline-flex items-center gap-1 text-xs font-medium">
                                    <span
                                      className="size-1.5 rounded-full bg-amber-500"
                                      aria-hidden="true"
                                    />
                                    {dirtyCount}
                                    <span className="sr-only"> unsaved changes</span>
                                  </span>
                                ) : null}
                                {c.customized ? (
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] uppercase tracking-wider"
                                  >
                                    Customized
                                  </Badge>
                                ) : null}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
              {filteredCards.length === 0 ? (
                <p className="px-1 text-sm text-muted-foreground">
                  No cards match “{search}”.
                </p>
              ) : null}
            </nav>
          </div>
        </aside>

        {/* Preview canvas + save bar (or fallback field list) */}
        <div>
          {manifest ? (
            <>
              <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
                <div className="heritage-preview flex justify-center p-6 sm:p-10">
                  <HeritageCardPreview
                    manifest={manifest}
                    rowsBySlot={rowsBySlot}
                    values={values}
                    onChange={onChange}
                    onResetSlot={onResetSlot}
                    saving={saving}
                    fadeKey={selected}
                  />
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Tap any line on the card to edit its wording. Buttons and badges
                are shown for layout only.
              </p>

              <div className="sticky bottom-0 z-10 mt-4 flex flex-col-reverse gap-2 rounded-lg border border-border bg-background/95 p-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
                <p aria-live="polite" className="text-sm text-muted-foreground">
                  {dirtyCount === 0
                    ? `No unsaved changes on ${cardName}`
                    : `${dirtyCount} unsaved change${dirtyCount > 1 ? "s" : ""} on ${cardName}`}
                  {anyInvalid ? (
                    <span className="ml-2 text-destructive">
                      Fix invalid merge fields to save.
                    </span>
                  ) : null}
                </p>
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  <Button
                    variant="ghost"
                    onClick={resetAll}
                    disabled={saving || !anyResettable}
                  >
                    <RotateCcw aria-hidden="true" />
                    Reset all
                  </Button>
                  <Button
                    onClick={() => void saveAll()}
                    loading={saving}
                    loadingText="Saving…"
                    disabled={saving || dirtyCount === 0 || anyInvalid}
                  >
                    <Save aria-hidden="true" />
                    Save changes
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Editing the wording customers read on the “{cardName}” card.
                Buttons &amp; layout don’t change.
              </p>
              {selectedRows.map((row) => (
                <CardTextFallbackEditor
                  key={row.id}
                  row={row}
                  onDone={() => router.refresh()}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Unsaved-changes guard (presentational; no new action) */}
      <Dialog
        open={pendingCard !== null}
        onOpenChange={(open) => {
          if (!open) setPendingCard(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>
              You have {dirtyCount} unsaved change{dirtyCount > 1 ? "s" : ""} on{" "}
              {cardName}. Switching cards will discard{" "}
              {dirtyCount > 1 ? "them" : "it"}.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Keep editing
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingCard) setSelected(pendingCard);
                setPendingCard(null);
              }}
            >
              Discard changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
