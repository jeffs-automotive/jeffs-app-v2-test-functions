"use client";

/**
 * TypesDirectTab — appointment types (sub-feature A, direct webform).
 *
 * The customer wizard reads `scheduler_appointment_types` LIVE, so every
 * edit here changes the public booking surface immediately (info banner).
 *
 * Mutations go through the two thin server actions:
 *   - setAppointmentTypeAction         (create + edit; keyed on slug)
 *   - deactivateAppointmentTypeAction  (soft-delete; blocked for system rows)
 *
 * IMPERATIVE-SUBMIT IDIOM (copied from AssignKeytagForm, 2026-06-26): we run
 * the action with a plain `pending` flag + `await`, NOT `useActionState`. On a
 * force-dynamic /schedulerconfig route, useActionState ties isPending to the
 * post-action RSC re-render, which re-suspends sibling tab boundaries and pins
 * the spinner. The imperative await resolves on the action's RETURN, so the
 * spinner clears immediately; we then router.refresh() to pull the new rows.
 *
 * Staleness: every edit submits the row's render-time `updated_at` as
 * `expected_updated_at`; a `stale` result toasts + refreshes.
 */
import { Fragment, useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, Check, ChevronDown, Pencil, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  setAppointmentTypeAction,
  deactivateAppointmentTypeAction,
} from "@/actions/scheduler/direct-config-actions";
import type { DirectFormState } from "@/lib/scheduler/direct-form-state";
import type { AppointmentTypeAdminRow } from "@/lib/scheduler/read-dal";

// ─── color palette ───────────────────────────────────────────────────────────
// tekmetric_color is a fixed enum in the action schema: red | navy | orange |
// yellow. Yellow is rendered but disabled pending the Tekmetric write probe
// (see the swatch title). The swatch hex values are display-only cues.

type ColorKey = "red" | "navy" | "orange" | "yellow";

const COLOR_SWATCHES: {
  key: ColorKey;
  name: string;
  hex: string;
  disabled: boolean;
  disabledReason?: string;
}[] = [
  { key: "red", name: "Red", hex: "#c0392b", disabled: false },
  { key: "navy", name: "Navy", hex: "#1f3a5f", disabled: false },
  { key: "orange", name: "Orange", hex: "#d35400", disabled: false },
  {
    key: "yellow",
    name: "Yellow",
    hex: "#e6b800",
    disabled: true,
    disabledReason: "pending Tekmetric write probe",
  },
];

function colorMeta(key: string): { name: string; hex: string } {
  const found = COLOR_SWATCHES.find((c) => c.key === key);
  return found ?? { name: key, hex: "#9ca3af" };
}

const SLUG_RE = /^[a-z0-9_]{2,40}$/;

// ─── shared imperative-run helper ─────────────────────────────────────────────

type ActionResult = DirectFormState;

/**
 * Run one of the config actions imperatively, translate the DirectFormState
 * discriminated union into toasts, and refresh the route on any write that
 * mutated (or invalidated) the current render.
 */
function useConfigAction() {
  const router = useRouter();

  const run = useCallback(
    async (
      fn: (args: unknown) => Promise<ActionResult>,
      args: unknown,
      opts: { successMsg: string },
    ): Promise<ActionResult["status"]> => {
      try {
        const result = await fn(args);
        switch (result.status) {
          case "success":
            toast.success(opts.successMsg);
            router.refresh();
            break;
          case "stale":
            toast.warning("Row changed since load", {
              description: result.error,
            });
            router.refresh();
            break;
          case "validation_error":
            toast.error("Couldn't save", { description: result.error });
            break;
          case "error":
            toast.error("Save failed", { description: result.error });
            break;
          default:
            break;
        }
        return result.status;
      } catch (e) {
        toast.error("Save failed", {
          description: e instanceof Error ? e.message : String(e),
        });
        return "error";
      }
    },
    [router],
  );

  return run;
}

// ─── top-level tab ─────────────────────────────────────────────────────────────

export function TypesDirectTab({ types }: { types: AppointmentTypeAdminRow[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const run = useConfigAction();

  // Stable sort by `sort` then label so ordering matches the wizard render.
  const sorted = useMemo(
    () =>
      [...types].sort(
        (a, b) => a.sort - b.sort || a.label.localeCompare(b.label),
      ),
    [types],
  );

  return (
    <div className="space-y-6">
      <div
        role="note"
        className="rounded-md border border-primary/20 bg-primary/5 p-3 text-sm text-foreground"
      >
        <strong>Active types appear in the customer wizard immediately.</strong>{" "}
        Edits to labels, descriptions, colors, and ordering are live the moment
        you save.
      </div>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base">Appointment types</CardTitle>
            <CardDescription>
              The tiles the customer picks from at the top of the booking
              wizard. System types are managed by the platform — their color and
              active state are locked, but their copy is editable.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setCreating((c) => !c);
              setEditingId(null);
            }}
            className="gap-1.5"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            New type
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {creating && (
            <CreateTypeForm
              run={run}
              existingSlugs={sorted.map((t) => t.slug)}
              onDone={() => setCreating(false)}
            />
          )}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Sort</TableHead>
                <TableHead className="w-12">Emoji</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Card title</TableHead>
                <TableHead>Color</TableHead>
                <TableHead>Lanes</TableHead>
                <TableHead>Flags</TableHead>
                <TableHead className="w-24 text-right">Edit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="py-6 text-center text-sm text-muted-foreground"
                  >
                    No appointment types yet. Create one with “New type”.
                  </TableCell>
                </TableRow>
              )}
              {sorted.map((t) => {
                const isEditing = editingId === t.id;
                const color = colorMeta(t.tekmetric_color);
                return (
                  <Fragment key={t.id}>
                    <TableRow data-state={isEditing ? "selected" : undefined}>
                      <TableCell className="font-mono text-xs">{t.sort}</TableCell>
                      <TableCell className="text-lg leading-none">
                        {t.emoji ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm font-medium">{t.label}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {t.card_title}
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          <span
                            aria-hidden="true"
                            className="inline-block h-3 w-3 rounded-full border border-border"
                            style={{ backgroundColor: color.hex }}
                          />
                          {color.name}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {t.requires_time_slot ? "8/9 AM slots" : "Daily cap"}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {t.is_system && (
                            <Badge variant="secondary" className="text-[10px]">
                              System
                            </Badge>
                          )}
                          <Badge
                            variant={t.active ? "default" : "outline"}
                            className="text-[10px]"
                          >
                            {t.active ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={
                            isEditing
                              ? `Close editor for ${t.label}`
                              : `Edit ${t.label}`
                          }
                          onClick={() =>
                            setEditingId((cur) => (cur === t.id ? null : t.id))
                          }
                        >
                          {isEditing ? (
                            <ChevronDown className="h-4 w-4" aria-hidden="true" />
                          ) : (
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                    {isEditing && (
                      <TableRow>
                        <TableCell colSpan={8} className="bg-muted/30 p-4">
                          <EditTypeForm
                            row={t}
                            run={run}
                            onDone={() => setEditingId(null)}
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── color picker (shared by create + edit) ────────────────────────────────────

function ColorPicker({
  value,
  onChange,
  disabled,
  idPrefix,
}: {
  value: ColorKey;
  onChange: (c: ColorKey) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Tekmetric color"
      className="flex flex-wrap gap-2"
    >
      {COLOR_SWATCHES.map((sw) => {
        const selected = value === sw.key;
        const isDisabled = disabled || sw.disabled;
        return (
          <button
            key={sw.key}
            type="button"
            id={`${idPrefix}-color-${sw.key}`}
            role="radio"
            aria-checked={selected}
            aria-label={
              sw.disabled ? `${sw.name} (${sw.disabledReason})` : sw.name
            }
            title={sw.disabled ? sw.disabledReason : sw.name}
            disabled={isDisabled}
            onClick={() => !isDisabled && onChange(sw.key)}
            className={[
              "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
              selected
                ? "border-ring ring-3 ring-ring/40"
                : "border-border hover:bg-muted",
              isDisabled ? "cursor-not-allowed opacity-50" : "",
            ].join(" ")}
          >
            <span
              aria-hidden="true"
              className="inline-block h-3 w-3 rounded-full border border-border"
              style={{ backgroundColor: sw.hex }}
            />
            {sw.name}
            {selected && <Check className="h-3 w-3" aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}

// ─── edit form (expands inline under a row) ─────────────────────────────────────

function EditTypeForm({
  row,
  run,
  onDone,
}: {
  row: AppointmentTypeAdminRow;
  run: ReturnType<typeof useConfigAction>;
  onDone: () => void;
}) {
  const [label, setLabel] = useState(row.label);
  const [cardTitle, setCardTitle] = useState(row.card_title);
  const [cardDescription, setCardDescription] = useState(
    row.card_description ?? "",
  );
  const [emoji, setEmoji] = useState(row.emoji ?? "");
  const [sort, setSort] = useState(String(row.sort));
  const [color, setColor] = useState<ColorKey>(
    (row.tekmetric_color as ColorKey) ?? "navy",
  );
  const [active, setActive] = useState(row.active);
  const [pending, setPending] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  const systemLocked = row.is_system;

  async function handleSave() {
    const trimmedLabel = label.trim();
    const trimmedTitle = cardTitle.trim();
    if (!trimmedLabel) {
      toast.error("Label is required.");
      return;
    }
    if (!trimmedTitle) {
      toast.error("Card title is required.");
      return;
    }
    setPending(true);
    const status = await run(
      setAppointmentTypeAction,
      {
        slug: row.slug,
        label: trimmedLabel,
        card_title: trimmedTitle,
        card_description: cardDescription.trim() === "" ? null : cardDescription.trim(),
        emoji: emoji.trim() === "" ? null : emoji.trim(),
        sort: Number(sort),
        // System rows lock color + active: send the ORIGINAL values so we
        // never accidentally mutate them even if local state drifted.
        tekmetric_color: systemLocked ? row.tekmetric_color : color,
        active: systemLocked ? row.active : active,
        expected_updated_at: row.updated_at,
      },
      { successMsg: `Saved “${trimmedLabel}”.` },
    );
    setPending(false);
    if (status === "success") onDone();
  }

  async function handleDeactivate() {
    setPending(true);
    const status = await run(
      deactivateAppointmentTypeAction,
      { id: row.id },
      { successMsg: `Deactivated “${row.label}”.` },
    );
    setPending(false);
    setConfirmDeactivate(false);
    if (status === "success") onDone();
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`edit-label-${row.id}`}>Label</Label>
          <Input
            id={`edit-label-${row.id}`}
            value={label}
            maxLength={30}
            onChange={(e) => setLabel(e.target.value)}
            disabled={pending}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`edit-title-${row.id}`}>Card title</Label>
          <Input
            id={`edit-title-${row.id}`}
            value={cardTitle}
            maxLength={60}
            onChange={(e) => setCardTitle(e.target.value)}
            disabled={pending}
          />
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label htmlFor={`edit-desc-${row.id}`}>Card description</Label>
          <span className="text-xs text-muted-foreground">
            {cardDescription.length}/300
          </span>
        </div>
        <textarea
          id={`edit-desc-${row.id}`}
          value={cardDescription}
          maxLength={300}
          rows={3}
          onChange={(e) => setCardDescription(e.target.value)}
          disabled={pending}
          className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`edit-emoji-${row.id}`}>Emoji</Label>
          <Input
            id={`edit-emoji-${row.id}`}
            value={emoji}
            maxLength={16}
            onChange={(e) => setEmoji(e.target.value)}
            disabled={pending}
            className="w-28"
            placeholder="🔧"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`edit-sort-${row.id}`}>Sort order</Label>
          <Input
            id={`edit-sort-${row.id}`}
            type="number"
            min="0"
            max="9999"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            disabled={pending}
            className="w-28"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Tekmetric color</Label>
        <ColorPicker
          value={systemLocked ? (row.tekmetric_color as ColorKey) : color}
          onChange={setColor}
          disabled={pending || systemLocked}
          idPrefix={`edit-${row.id}`}
        />
        {systemLocked && (
          <p className="text-xs text-muted-foreground">
            System types have a platform-managed color — this control is locked.
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`edit-active-${row.id}`}>Active</Label>
        <label className="flex items-center gap-2 text-sm">
          <input
            id={`edit-active-${row.id}`}
            type="checkbox"
            checked={systemLocked ? row.active : active}
            onChange={(e) => setActive(e.target.checked)}
            disabled={pending || systemLocked}
            className="h-4 w-4 rounded border-border disabled:opacity-50"
          />
          <span>
            {(systemLocked ? row.active : active)
              ? "Shown in the customer wizard"
              : "Hidden from the customer wizard"}
          </span>
        </label>
        {systemLocked && (
          <p className="text-xs text-muted-foreground">
            System types can’t be toggled off here — this control is locked.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={handleSave}
            loading={pending}
            loadingText="Saving…"
            className="gap-1.5"
          >
            <Check className="h-4 w-4" aria-hidden="true" />
            Save changes
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={onDone}
            disabled={pending}
          >
            Cancel
          </Button>
        </div>

        {/* Deactivate: inline two-click confirm; blocked for system rows. */}
        {!systemLocked && row.active && (
          <div className="flex items-center gap-2">
            {confirmDeactivate ? (
              <>
                <span className="text-xs text-muted-foreground">
                  Hide this type from the wizard?
                </span>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={handleDeactivate}
                  loading={pending}
                  loadingText="Deactivating…"
                  className="gap-1.5"
                >
                  <Ban className="h-4 w-4" aria-hidden="true" />
                  Confirm
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmDeactivate(false)}
                  disabled={pending}
                  aria-label="Cancel deactivation"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => setConfirmDeactivate(true)}
                disabled={pending}
                className="gap-1.5"
              >
                <Ban className="h-4 w-4" aria-hidden="true" />
                Deactivate
              </Button>
            )}
          </div>
        )}
        {systemLocked && (
          <span className="text-xs text-muted-foreground">
            System types can’t be deactivated.
          </span>
        )}
      </div>
    </div>
  );
}

// ─── create form ────────────────────────────────────────────────────────────────

function CreateTypeForm({
  run,
  existingSlugs,
  onDone,
}: {
  run: ReturnType<typeof useConfigAction>;
  existingSlugs: string[];
  onDone: () => void;
}) {
  const [slug, setSlug] = useState("");
  const [label, setLabel] = useState("");
  const [cardTitle, setCardTitle] = useState("");
  const [cardDescription, setCardDescription] = useState("");
  const [emoji, setEmoji] = useState("");
  const [sort, setSort] = useState("0");
  const [color, setColor] = useState<ColorKey>("navy");
  const [active, setActive] = useState(true);
  const [pending, setPending] = useState(false);

  const slugValid = SLUG_RE.test(slug);
  const slugTaken = existingSlugs.includes(slug);
  const slugError =
    slug.length === 0
      ? null
      : slugTaken
        ? "That slug already exists."
        : !slugValid
          ? "Lowercase letters, numbers, underscores only (2–40 chars)."
          : null;

  async function handleCreate() {
    const trimmedLabel = label.trim();
    const trimmedTitle = cardTitle.trim();
    if (!slugValid || slugTaken) {
      toast.error("Fix the slug before creating.");
      return;
    }
    if (!trimmedLabel || !trimmedTitle) {
      toast.error("Label and card title are required.");
      return;
    }
    setPending(true);
    // New row → no expected_updated_at (nothing to guard against yet).
    const status = await run(
      setAppointmentTypeAction,
      {
        slug,
        label: trimmedLabel,
        card_title: trimmedTitle,
        card_description:
          cardDescription.trim() === "" ? null : cardDescription.trim(),
        emoji: emoji.trim() === "" ? null : emoji.trim(),
        sort: Number(sort),
        tekmetric_color: color,
        active,
      },
      { successMsg: `Created “${trimmedLabel}”.` },
    );
    setPending(false);
    if (status === "success") onDone();
  }

  return (
    <div className="space-y-4 rounded-lg border border-dashed border-border bg-muted/20 p-4">
      <p className="text-sm font-medium">New appointment type</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="create-slug">
            Slug <span className="text-muted-foreground">(permanent)</span>
          </Label>
          <Input
            id="create-slug"
            value={slug}
            maxLength={40}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            disabled={pending}
            placeholder="oil_change"
            aria-invalid={slugError ? true : undefined}
            aria-describedby="create-slug-hint"
          />
          <p
            id="create-slug-hint"
            className={
              slugError
                ? "text-xs text-destructive"
                : "text-xs text-muted-foreground"
            }
          >
            {slugError ??
              "Lowercase snake_case. Can’t be changed after creation."}
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="create-label">Label</Label>
          <Input
            id="create-label"
            value={label}
            maxLength={30}
            onChange={(e) => setLabel(e.target.value)}
            disabled={pending}
            placeholder="Oil Change"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="create-title">Card title</Label>
          <Input
            id="create-title"
            value={cardTitle}
            maxLength={60}
            onChange={(e) => setCardTitle(e.target.value)}
            disabled={pending}
            placeholder="Quick Oil Change"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="create-emoji">Emoji</Label>
          <Input
            id="create-emoji"
            value={emoji}
            maxLength={16}
            onChange={(e) => setEmoji(e.target.value)}
            disabled={pending}
            className="w-28"
            placeholder="🛢️"
          />
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label htmlFor="create-desc">Card description</Label>
          <span className="text-xs text-muted-foreground">
            {cardDescription.length}/300
          </span>
        </div>
        <textarea
          id="create-desc"
          value={cardDescription}
          maxLength={300}
          rows={3}
          onChange={(e) => setCardDescription(e.target.value)}
          disabled={pending}
          className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          placeholder="Shown under the tile in the wizard."
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Tekmetric color</Label>
          <ColorPicker
            value={color}
            onChange={setColor}
            disabled={pending}
            idPrefix="create"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="create-sort">Sort order</Label>
          <Input
            id="create-sort"
            type="number"
            min="0"
            max="9999"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            disabled={pending}
            className="w-28"
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
          disabled={pending}
          className="h-4 w-4 rounded border-border"
        />
        <span>Active (shown in the wizard immediately)</span>
      </label>

      <div className="flex items-center gap-2 border-t border-border pt-3">
        <Button
          type="button"
          onClick={handleCreate}
          loading={pending}
          loadingText="Creating…"
          disabled={pending || !slugValid || slugTaken}
          className="gap-1.5"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Create type
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onDone}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
