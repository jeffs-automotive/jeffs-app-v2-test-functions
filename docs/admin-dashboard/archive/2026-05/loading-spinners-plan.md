# Loading spinners — plan (revised after AI cross-verify)

> **Status:** Revised 2026-05-25 post-`/feature-cross-verify`. Pending Chris's approval.
> **Parent feature:** loading-spinners (`.claude/work/current-feature.json`)
> **Trigger:** Chris ran Reconcile dry-run; the 5–30 second wait with no visible activity made him think the page was frozen.
>
> **Cross-verify artifact:** `.claude/work/ai-review-2026-05-25T21-52-54Z.md`. Gemini + GPT converged on a stale-state bug; GPT separately caught that the planned "Running…" card would be hidden behind the confirmation dialog. Both findings folded into this revision.

---

## 1. Why

Every keytag action that touches the orchestrator goes through `useActionState`'s `isPending` boolean. Current UX is **text-only**:

```tsx
<Button disabled={isPending}>
  {isPending ? "Running…" : "Run reconcile"}
</Button>
```

That's fine for ~1s responses. For Reconcile specifically (60s timeout, 5–30s typical) it reads as "the button got grayed out and nothing else happened." No motion = no perceived progress.

---

## 2. Scope (intentionally narrow)

| In scope | Out of scope |
|---|---|
| Spinner icon on every button bound to an orchestrator call | Skeleton screens during initial RSC render |
| Prominent "Running…" card under ReconcileTab while it's working | Tab-switch loading.tsx |
| ConfirmationDialog "Applying…" spinner | Toast progress bars |
| AuditHistoryFilters "Filtering…" spinner | Tekmetric webhook-time loading states |

Chris's complaint = "the dry-run audit takes a moment, I thought it was frozen." Spinner pattern is exactly that scope. Defer broader loading-state polish.

---

## 3. The pattern — centralized in the Button component

**Revision per Gemini cross-verify:** repeating the icon-swap logic across 10 components is duplication-prone. Centralize in `components/ui/button.tsx` (shadcn) by adding optional `loading` + `loadingText` props.

### 3a. Button enhancement (one file, ~10 lines)

```tsx
// admin-app/src/components/ui/button.tsx — add to ButtonProps + render logic
export interface ButtonProps extends ... {
  loading?: boolean;          // when true, icon swaps to spinner + button disables
  loadingText?: string;       // optional pending label; falls back to children
}

// In render:
<Comp
  data-slot="button"
  aria-busy={loading || undefined}            // a11y: announce busy state
  disabled={disabled || loading}              // disable while loading
  {...props}
>
  {loading ? (
    <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
  ) : (
    leadingIcon
  )}
  {loading && loadingText ? loadingText : children}
</Comp>
```

Notes:
- `Loader2` from `lucide-react` (matches `ui/sonner.tsx` precedent)
- `motion-safe:animate-spin` (respects `prefers-reduced-motion`)
- `aria-busy` for assistive tech
- `disabled || loading` so callers can still pass disabled independently

### 3b. Per-form usage (10 sites become simple)

```tsx
// Before
<Button disabled={isPending}>
  {isPending ? <Loader2 ... /> : <KeyRound ... />}
  {isPending ? "Assigning…" : "Assign"}
</Button>

// After
<Button loading={isPending} loadingText="Assigning…">
  <KeyRound className="h-4 w-4" aria-hidden="true" />
  Assign
</Button>
```

One source of truth; can't drift across sites.

---

## 4. ReconcileTab — special treatment (3 fixes post-cross-verify)

ReconcileTab is the long-running case. Three issues GPT + Gemini surfaced:

### 4a. Running indicator must appear INSIDE the confirmation dialog

GPT caught: the dialog stays open during the 5–30s wait. Any card "below the buttons" is hidden behind the dialog backdrop. So the running indicator MUST live in the dialog body.

```tsx
<Dialog ...>
  <DialogContent>
    <DialogHeader>...</DialogHeader>

    {/* Confirm prompt — hidden while pending */}
    {!isPending && (
      <p>{dryRun ? "Dry-run: previews actions…" : "This will assign, post…"}</p>
    )}

    {/* Running status — visible while pending */}
    {isPending && (
      <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-md border border-primary/30 bg-primary/5 p-3">
        <Loader2 className="h-5 w-5 motion-safe:animate-spin text-primary" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium">
            Running {runningMode === "dry-run" ? "dry-run" : "reconcile"}…
          </p>
          <p className="text-xs text-muted-foreground">
            Typically takes 5–30 seconds.
          </p>
        </div>
      </div>
    )}

    <DialogFooter>
      <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={isPending}>Cancel</Button>
      <Button loading={isPending} loadingText="Running…" variant={runningMode === "real" ? "destructive" : "default"} onClick={handleRun}>
        Run {dryRun ? "dry-run" : "for real"}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

### 4b. Use `isPending` alone — don't condition on `state.kind`

**BLOCKER both models flagged:** `useActionState` preserves the previous state during the next dispatch. On a second run, `state.kind === "success"` from prior run STILL holds while `isPending` becomes true — so a condition like `isPending && state.kind !== "success"` fails to show the running indicator on the 2nd+ runs.

Right pattern:
- Running indicator: `isPending`
- Stale result: hide it while pending (`!isPending && state.kind === "success"`)

```tsx
{!isPending && state.kind === "success" && <ReconcileResultCard data={state.data} />}
```

### 4c. Snapshot `dryRun` at dispatch + guard dialog close while pending

GPT caught both:
- The checkbox could be toggled mid-run, making the "Running dry-run…" copy lie. Snapshot the mode at dispatch.
- Dialog can close via Escape / outside-click even when Cancel is disabled. Guard `onOpenChange`.

```tsx
const [runningMode, setRunningMode] = useState<"dry-run" | "real" | null>(null);

function handleRun() {
  setRunningMode(dryRun ? "dry-run" : "real");
  const fd = new FormData();
  if (dryRun) fd.set("dry_run", "true");
  dispatch(fd);
}

<Dialog
  open={confirmOpen}
  onOpenChange={(next) => {
    if (isPending && !next) return; // refuse close while pending
    setConfirmOpen(next);
  }}
>
```

---

## 5. File-by-file change list (1 enhancement + 10 callers + ReconcileTab specials)

### 5a. Button enhancement (1 file)

| File | Change |
|---|---|
| `admin-app/src/components/ui/button.tsx` | Add `loading?: boolean` + `loadingText?: string` props. When `loading=true`: render Loader2 spinner (with `motion-safe:animate-spin`), disable button, set `aria-busy`. Falls back to `children` if no `loadingText`. |

### 5b. Per-form callers (10 sites, simple swap)

Each becomes `<Button loading={isPending} loadingText="Verb-ing…">`:

| File | Verb |
|---|---|
| `admin-app/src/components/keytag/AssignKeytagForm.tsx` | "Assigning…" |
| `admin-app/src/components/keytag/ReleaseKeytagForm.tsx` | "Releasing…" |
| `admin-app/src/components/keytag/RevertKeytagForm.tsx` | "Reverting…" |
| `admin-app/src/components/keytag/MarkKeytagPostedForm.tsx` | "Posting…" |
| `admin-app/src/components/keytag/WhoIsOnTagForm.tsx` | "Looking up…" |
| `admin-app/src/components/keytag/LookupManualReviewForm.tsx` | "Looking up…" |
| `admin-app/src/components/keytag/ResolveManualReviewForm.tsx` | "Resolving…" |
| `admin-app/src/components/keytag/ConfirmationDialog.tsx` | "Applying…" |
| `admin-app/src/components/keytag/AuditHistoryFilters.tsx` | "Filtering…" |
| `admin-app/src/components/keytag/ReconcileTab.tsx` (outer button) | "Running…" |

### 5c. ReconcileTab dialog body changes

Beyond the button swap, dialog body needs (per §4a-c):
- Dialog body conditional rendering: confirm prompt OR running status (based on `isPending`)
- `runningMode` state snapshot
- `onOpenChange` guard against close-while-pending
- Result card hidden while pending: `!isPending && state.kind === "success"`

No state changes elsewhere. No new dependencies. No API changes.

---

## 6. Verify

| # | Test |
|---|---|
| 1 | `npm run typecheck` — clean (no type errors from Button prop additions) |
| 2 | `npm run build` — clean (no missing imports) |
| 3 | Manual: click each form's button → confirm spinner appears + text changes |
| 4 | Manual: Reconcile dry-run → confirm "Running…" status appears INSIDE the dialog within ~200ms of confirm-click + persists for the duration + dialog can't be Escape/click-outside-closed during run |
| 5 | **Manual: REPEAT-RUN test** (catches the stale-state bug). Run dry-run → success → close dialog → run again → confirm spinner + running status BOTH appear on the second run. |
| 6 | Manual: ConfirmationDialog "Confirm" click → confirm spinner during the 1–3s Pattern A round-trip |
| 7 | Manual: try to toggle dry-run checkbox MID-run → running text should reflect the snapshot-at-dispatch mode, not the live checkbox |
| 8 | `/feature-cross-verify` — Gemini + GPT review the patch

---

## 7. Estimate + risk

- **Effort:** ~30 min (10 files, mechanical edits, well-established pattern in same codebase)
- **Risk:** very low. No behavior changes, no API changes, no new deps. Pure visual feedback layer.
- **Blast radius:** admin-app only. Doesn't touch orchestrator, edge functions, DB, scheduler-app.
