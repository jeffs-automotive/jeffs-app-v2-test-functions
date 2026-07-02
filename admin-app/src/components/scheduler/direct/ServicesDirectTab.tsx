"use client";

/**
 * ServicesDirectTab — routine + testing service catalog management.
 *
 * Two sections (Routine / Testing). Each renders a live table of rows with a
 * per-row inline Edit that expands into a form, plus a collapsed "Add service"
 * form. All mutations go through upsertRoutineServiceAction /
 * upsertTestingServiceAction — called IMPERATIVELY (await + toast +
 * router.refresh()), copying the AssignKeytagForm idiom so the force-dynamic
 * /schedulerconfig re-render never re-suspends and pins a spinner.
 *
 * Staleness: every edit submits the row's updated_at as expected_updated_at;
 * a `stale` result toasts + refreshes. Deactivation is `active:false` via the
 * same upsert, gated behind a small inline two-click confirm.
 *
 * Prices are edited in DOLLARS here and converted to cents at the boundary
 * (services-helpers) — the DB stores BIGINT `_cents` per the money convention.
 * `service_key` is immutable on edit (rendered read-only).
 */
import { useCallback, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ClipboardList,
  FlaskConical,
  Pencil,
  Plus,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  upsertRoutineServiceAction,
  upsertTestingServiceAction,
} from "@/actions/scheduler/direct-catalog-actions";
import type {
  RoutineServiceRow,
  TestingServiceRow,
} from "@/lib/scheduler/read-dal";
import {
  centsToDollarsInput,
  dollarsInputToCents,
  toastFromState,
} from "./services-helpers";

interface ServicesDirectTabProps {
  routine: RoutineServiceRow[];
  testing: TestingServiceRow[];
}

export default function ServicesDirectTab({
  routine,
  testing,
}: ServicesDirectTabProps) {
  return (
    <div className="space-y-6">
      <RoutineSection rows={routine} />
      <TestingSection rows={testing} />
    </div>
  );
}

// ─── Routine section ───────────────────────────────────────────────────────

function RoutineSection({ rows }: { rows: RoutineServiceRow[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="h-4 w-4" aria-hidden="true" />
          Routine services
        </CardTitle>
        <CardDescription>
          Named maintenance / repair services the wizard offers. Prices are in
          dollars; leave blank for &ldquo;price on inspection&rdquo;. Toggle
          <span className="font-medium"> wait-eligible</span> to allow waiter
          appointments and <span className="font-medium"> requires
          explanation</span> to force a note when the price is waived.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Abbr.</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Flags</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground">
                    No routine services yet. Add one below.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((row) =>
                editingId === row.id ? (
                  <RoutineEditRow
                    key={row.id}
                    row={row}
                    onDone={() => setEditingId(null)}
                  />
                ) : (
                  <RoutineDisplayRow
                    key={row.id}
                    row={row}
                    onEdit={() => setEditingId(row.id)}
                  />
                ),
              )}
            </TableBody>
          </Table>

          {adding ? (
            <RoutineAddForm onDone={() => setAdding(false)} />
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAdding(true)}
              className="gap-1.5"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add routine service
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function RoutineDisplayRow({
  row,
  onEdit,
}: {
  row: RoutineServiceRow;
  onEdit: () => void;
}) {
  return (
    <TableRow className={row.active ? undefined : "opacity-60"}>
      <TableCell className="text-sm font-medium">{row.display_name}</TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">
        {row.service_key}
      </TableCell>
      <TableCell className="text-sm">{row.abbreviation}</TableCell>
      <TableCell className="font-mono text-xs">
        {row.starting_price_cents == null
          ? "—"
          : `$${centsToDollarsInput(row.starting_price_cents)}`}
      </TableCell>
      <TableCell className="font-mono text-xs">{row.display_order}</TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {row.wait_eligible && (
            <Badge variant="secondary" className="text-[10px]">
              wait
            </Badge>
          )}
          {row.requires_explanation && (
            <Badge variant="secondary" className="text-[10px]">
              explain
            </Badge>
          )}
          {!row.active && (
            <Badge variant="destructive" className="text-[10px]">
              inactive
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="text-right">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onEdit}
          className="gap-1"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          Edit
        </Button>
      </TableCell>
    </TableRow>
  );
}

function RoutineEditRow({
  row,
  onDone,
}: {
  row: RoutineServiceRow;
  onDone: () => void;
}) {
  return (
    <TableRow>
      <TableCell colSpan={7} className="whitespace-normal">
        <RoutineForm
          existing={row}
          onDone={onDone}
          onCancel={onDone}
        />
      </TableCell>
    </TableRow>
  );
}

function RoutineAddForm({ onDone }: { onDone: () => void }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium">New routine service</p>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onDone}
          aria-label="Cancel add"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      <RoutineForm existing={null} onDone={onDone} onCancel={onDone} />
    </div>
  );
}

// ─── Routine form (add + edit share this) ───────────────────────────────────

function RoutineForm({
  existing,
  onDone,
  onCancel,
}: {
  existing: RoutineServiceRow | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const isEdit = existing !== null;
  const [loading, setLoading] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  const [serviceKey, setServiceKey] = useState(existing?.service_key ?? "");
  const [displayName, setDisplayName] = useState(existing?.display_name ?? "");
  const [abbreviation, setAbbreviation] = useState(existing?.abbreviation ?? "");
  const [price, setPrice] = useState(
    centsToDollarsInput(existing?.starting_price_cents),
  );
  const [displayOrder, setDisplayOrder] = useState(
    String(existing?.display_order ?? 0),
  );
  const [description, setDescription] = useState(existing?.description ?? "");
  const [priceWaivedNote, setPriceWaivedNote] = useState(
    existing?.price_waived_note ?? "",
  );
  const [waitEligible, setWaitEligible] = useState(
    existing?.wait_eligible ?? false,
  );
  const [requiresExplanation, setRequiresExplanation] = useState(
    existing?.requires_explanation ?? false,
  );

  const submit = useCallback(
    async (opts: { active: boolean }) => {
      const priceResult = dollarsInputToCents(price);
      if ("error" in priceResult) {
        toastFromState(
          { status: "validation_error", error: priceResult.error, timestamp: Date.now() },
          "",
        );
        return;
      }
      setLoading(true);
      try {
        const state = await upsertRoutineServiceAction({
          service_key: serviceKey.trim(),
          display_name: displayName.trim(),
          abbreviation: abbreviation.trim(),
          display_order: displayOrder,
          starting_price_cents: priceResult.cents,
          description: description.trim() === "" ? null : description.trim(),
          price_waived_note:
            priceWaivedNote.trim() === "" ? null : priceWaivedNote.trim(),
          wait_eligible: waitEligible,
          requires_explanation: requiresExplanation,
          active: opts.active,
          expected_updated_at: existing?.updated_at,
        });
        const ok = toastFromState(
          state,
          isEdit
            ? opts.active
              ? `Updated ${displayName || serviceKey}.`
              : `Deactivated ${displayName || serviceKey}.`
            : `Added ${displayName || serviceKey}.`,
        );
        if (ok || state.status === "stale") {
          onDone();
          router.refresh();
        }
      } catch (e) {
        toastFromState(
          {
            status: "error",
            error: e instanceof Error ? e.message : String(e),
            timestamp: Date.now(),
          },
          "",
        );
      } finally {
        setLoading(false);
      }
    },
    [
      price,
      serviceKey,
      displayName,
      abbreviation,
      displayOrder,
      description,
      priceWaivedNote,
      waitEligible,
      requiresExplanation,
      existing,
      isEdit,
      onDone,
      router,
    ],
  );

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void submit({ active: true });
  }

  const keyId = `routine-key-${existing?.id ?? "new"}`;
  const nameId = `routine-name-${existing?.id ?? "new"}`;
  const abbrId = `routine-abbr-${existing?.id ?? "new"}`;
  const priceId = `routine-price-${existing?.id ?? "new"}`;
  const orderId = `routine-order-${existing?.id ?? "new"}`;
  const descId = `routine-desc-${existing?.id ?? "new"}`;
  const waivedId = `routine-waived-${existing?.id ?? "new"}`;

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <FormField label="Service key" htmlFor={keyId} hint={isEdit ? "Immutable" : undefined}>
          <Input
            id={keyId}
            name="service_key"
            value={serviceKey}
            onChange={(e) => setServiceKey(e.target.value)}
            readOnly={isEdit}
            required
            placeholder="oil_change"
            className={isEdit ? "bg-muted/50 font-mono text-xs" : "font-mono text-xs"}
          />
        </FormField>
        <FormField label="Display name" htmlFor={nameId}>
          <Input
            id={nameId}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            placeholder="Oil change"
          />
        </FormField>
        <FormField label="Abbreviation" htmlFor={abbrId}>
          <Input
            id={abbrId}
            value={abbreviation}
            onChange={(e) => setAbbreviation(e.target.value)}
            required
            placeholder="OIL"
          />
        </FormField>
        <FormField label="Price (USD)" htmlFor={priceId} hint="Blank = on inspection">
          <Input
            id={priceId}
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="49.99"
          />
        </FormField>
        <FormField label="Display order" htmlFor={orderId}>
          <Input
            id={orderId}
            type="number"
            min="0"
            max="9999"
            value={displayOrder}
            onChange={(e) => setDisplayOrder(e.target.value)}
          />
        </FormField>
        <FormField label="Price-waived note" htmlFor={waivedId}>
          <Input
            id={waivedId}
            value={priceWaivedNote}
            onChange={(e) => setPriceWaivedNote(e.target.value)}
            placeholder="Optional"
          />
        </FormField>
      </div>

      <FormField label="Description" htmlFor={descId}>
        <textarea
          id={descId}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          placeholder="Optional customer-facing description"
        />
      </FormField>

      <div className="flex flex-wrap gap-4">
        <CheckboxField
          checked={waitEligible}
          onChange={setWaitEligible}
          label="Wait-eligible"
        />
        <CheckboxField
          checked={requiresExplanation}
          onChange={setRequiresExplanation}
          label="Requires explanation"
        />
      </div>

      <FormActions
        loading={loading}
        isEdit={isEdit}
        active={existing?.active ?? true}
        confirmDeactivate={confirmDeactivate}
        setConfirmDeactivate={setConfirmDeactivate}
        onCancel={onCancel}
        onDeactivate={() => void submit({ active: false })}
      />
    </form>
  );
}

// ─── Testing section ─────────────────────────────────────────────────────────

function TestingSection({ rows }: { rows: TestingServiceRow[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FlaskConical className="h-4 w-4" aria-hidden="true" />
          Testing services
        </CardTitle>
        <CardDescription>
          Diagnostic / testing services. Price is required (dollars). Add
          internal notes to guide the concern classifier.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Abbr.</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground">
                    No testing services yet. Add one below.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((row) =>
                editingId === row.id ? (
                  <TestingEditRow
                    key={row.id}
                    row={row}
                    onDone={() => setEditingId(null)}
                  />
                ) : (
                  <TestingDisplayRow
                    key={row.id}
                    row={row}
                    onEdit={() => setEditingId(row.id)}
                  />
                ),
              )}
            </TableBody>
          </Table>

          {adding ? (
            <TestingAddForm onDone={() => setAdding(false)} />
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAdding(true)}
              className="gap-1.5"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add testing service
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function TestingDisplayRow({
  row,
  onEdit,
}: {
  row: TestingServiceRow;
  onEdit: () => void;
}) {
  return (
    <TableRow className={row.active ? undefined : "opacity-60"}>
      <TableCell className="text-sm font-medium">{row.display_name}</TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">
        {row.service_key}
      </TableCell>
      <TableCell className="text-sm">{row.abbreviation}</TableCell>
      <TableCell className="font-mono text-xs">
        ${centsToDollarsInput(row.starting_price_cents)}
      </TableCell>
      <TableCell className="max-w-[16rem] truncate whitespace-normal text-xs text-muted-foreground">
        {row.notes ?? "—"}
      </TableCell>
      <TableCell>
        {row.active ? (
          <Badge variant="secondary" className="text-[10px]">
            active
          </Badge>
        ) : (
          <Badge variant="destructive" className="text-[10px]">
            inactive
          </Badge>
        )}
      </TableCell>
      <TableCell className="text-right">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onEdit}
          className="gap-1"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          Edit
        </Button>
      </TableCell>
    </TableRow>
  );
}

function TestingEditRow({
  row,
  onDone,
}: {
  row: TestingServiceRow;
  onDone: () => void;
}) {
  return (
    <TableRow>
      <TableCell colSpan={7} className="whitespace-normal">
        <TestingForm existing={row} onDone={onDone} onCancel={onDone} />
      </TableCell>
    </TableRow>
  );
}

function TestingAddForm({ onDone }: { onDone: () => void }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium">New testing service</p>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onDone}
          aria-label="Cancel add"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      <TestingForm existing={null} onDone={onDone} onCancel={onDone} />
    </div>
  );
}

// ─── Testing form (add + edit share this) ─────────────────────────────────────

function TestingForm({
  existing,
  onDone,
  onCancel,
}: {
  existing: TestingServiceRow | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const isEdit = existing !== null;
  const [loading, setLoading] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  const [serviceKey, setServiceKey] = useState(existing?.service_key ?? "");
  const [displayName, setDisplayName] = useState(existing?.display_name ?? "");
  const [abbreviation, setAbbreviation] = useState(existing?.abbreviation ?? "");
  const [price, setPrice] = useState(
    centsToDollarsInput(existing?.starting_price_cents),
  );
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");

  const submit = useCallback(
    async (opts: { active: boolean }) => {
      const priceResult = dollarsInputToCents(price);
      if ("error" in priceResult) {
        toastFromState(
          { status: "validation_error", error: priceResult.error, timestamp: Date.now() },
          "",
        );
        return;
      }
      if (priceResult.cents == null) {
        toastFromState(
          {
            status: "validation_error",
            error: "Testing services require a price.",
            timestamp: Date.now(),
          },
          "",
        );
        return;
      }
      setLoading(true);
      try {
        const state = await upsertTestingServiceAction({
          service_key: serviceKey.trim(),
          display_name: displayName.trim(),
          abbreviation: abbreviation.trim(),
          starting_price_cents: priceResult.cents,
          notes: notes.trim() === "" ? null : notes.trim(),
          description: description.trim() === "" ? null : description.trim(),
          active: opts.active,
          expected_updated_at: existing?.updated_at,
        });
        const ok = toastFromState(
          state,
          isEdit
            ? opts.active
              ? `Updated ${displayName || serviceKey}.`
              : `Deactivated ${displayName || serviceKey}.`
            : `Added ${displayName || serviceKey}.`,
        );
        if (ok || state.status === "stale") {
          onDone();
          router.refresh();
        }
      } catch (e) {
        toastFromState(
          {
            status: "error",
            error: e instanceof Error ? e.message : String(e),
            timestamp: Date.now(),
          },
          "",
        );
      } finally {
        setLoading(false);
      }
    },
    [
      price,
      serviceKey,
      displayName,
      abbreviation,
      notes,
      description,
      existing,
      isEdit,
      onDone,
      router,
    ],
  );

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void submit({ active: true });
  }

  const keyId = `testing-key-${existing?.id ?? "new"}`;
  const nameId = `testing-name-${existing?.id ?? "new"}`;
  const abbrId = `testing-abbr-${existing?.id ?? "new"}`;
  const priceId = `testing-price-${existing?.id ?? "new"}`;
  const notesId = `testing-notes-${existing?.id ?? "new"}`;
  const descId = `testing-desc-${existing?.id ?? "new"}`;

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label="Service key" htmlFor={keyId} hint={isEdit ? "Immutable" : undefined}>
          <Input
            id={keyId}
            value={serviceKey}
            onChange={(e) => setServiceKey(e.target.value)}
            readOnly={isEdit}
            required
            placeholder="battery_test"
            className={isEdit ? "bg-muted/50 font-mono text-xs" : "font-mono text-xs"}
          />
        </FormField>
        <FormField label="Display name" htmlFor={nameId}>
          <Input
            id={nameId}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            placeholder="Battery test"
          />
        </FormField>
        <FormField label="Abbreviation" htmlFor={abbrId}>
          <Input
            id={abbrId}
            value={abbreviation}
            onChange={(e) => setAbbreviation(e.target.value)}
            required
            placeholder="BAT"
          />
        </FormField>
        <FormField label="Price (USD)" htmlFor={priceId} hint="Required">
          <Input
            id={priceId}
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
            placeholder="29.99"
          />
        </FormField>
      </div>

      <FormField label="Notes" htmlFor={notesId} hint="Internal — guides the classifier">
        <textarea
          id={notesId}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          placeholder="Optional internal notes"
        />
      </FormField>

      <FormField label="Description" htmlFor={descId}>
        <textarea
          id={descId}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          placeholder="Optional customer-facing description"
        />
      </FormField>

      <FormActions
        loading={loading}
        isEdit={isEdit}
        active={existing?.active ?? true}
        confirmDeactivate={confirmDeactivate}
        setConfirmDeactivate={setConfirmDeactivate}
        onCancel={onCancel}
        onDeactivate={() => void submit({ active: false })}
      />
    </form>
  );
}

// ─── Shared small pieces ─────────────────────────────────────────────────────

function FormField({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={htmlFor} className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
        {hint && <span className="ml-1 normal-case text-[10px] opacity-70">({hint})</span>}
      </Label>
      {children}
    </div>
  );
}

function CheckboxField({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-border"
      />
      <span>{label}</span>
    </label>
  );
}

/**
 * Save / Cancel + a two-click inline Deactivate confirm (edit + active rows
 * only). First click arms the confirm; a second click within the same expanded
 * row commits `active:false`. No window.confirm — matches house style.
 */
function FormActions({
  loading,
  isEdit,
  active,
  confirmDeactivate,
  setConfirmDeactivate,
  onCancel,
  onDeactivate,
}: {
  loading: boolean;
  isEdit: boolean;
  active: boolean;
  confirmDeactivate: boolean;
  setConfirmDeactivate: (v: boolean) => void;
  onCancel: () => void;
  onDeactivate: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <Button type="submit" size="sm" loading={loading} loadingText="Saving…">
        {isEdit ? "Save changes" : "Add service"}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onCancel}
        disabled={loading}
      >
        Cancel
      </Button>

      {isEdit && active && (
        <div className="ml-auto flex items-center gap-2">
          {confirmDeactivate ? (
            <>
              <span className="text-xs text-muted-foreground">
                Hide from the wizard?
              </span>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                loading={loading}
                loadingText="Deactivating…"
                onClick={onDeactivate}
              >
                Confirm deactivate
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDeactivate(false)}
                disabled={loading}
              >
                Keep
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => setConfirmDeactivate(true)}
              disabled={loading}
            >
              Deactivate
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
