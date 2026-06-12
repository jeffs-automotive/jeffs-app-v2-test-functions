"use client";

/**
 * CatalogEditorTab — UNIVERSAL editor surface for all 9 catalog tabs.
 *
 * Renders:
 *   - Current state summary (row count + Export button)
 *   - Upload-new-MD form (paste textarea OR file picker)
 *   - <DiffPreviewDialog> on `needs_confirmation`
 *   - <RecentUploadsList> with per-row Revert buttons
 *
 * Per plan v0.5 §4 step 4 — textarea LOCKED while preview dialog is open.
 * `previewedMd` holds the exact content sent to the apply call.
 *
 * Per plan v0.5 §5 refresh contract — after apply success, router.refresh()
 * picks up the server-side revalidatePath in the action.
 *
 * Generic over the upload action — the parent passes:
 *   - uploadAction: a Pattern S Server Action
 *   - exportAction: a read-only Server Action returning ExportMdResult
 *   - recentUploads: an AuditLogEntry[] (fetched at the page level)
 *   - surface: SchedulerAdminSurface canonical filter value
 *   - surfaceLabel: human-readable label for headers + toast copy
 *   - currentStateSummary: optional ReactNode for the top-of-tab summary
 */
import {
  useActionState,
  useEffect,
  useRef,
  useState,
  useTransition,
  startTransition,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, Eye, FileText, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DiffPreviewDialog } from "./DiffPreviewDialog";
import { RecentUploadsList } from "./RecentUploadsList";
import {
  downloadMdAsFile,
  parseUploadedMdFile,
} from "@/lib/scheduler/md-file-utils";
import type {
  AuditLogEntry,
  SchedulerUploadState,
  SchedulerExportState,
  SchedulerAdminSurface,
} from "@/lib/scheduler/types";
import type { ReactNode } from "react";

const initialUpload: SchedulerUploadState = { kind: "idle" };
const initialExport: SchedulerExportState = { kind: "idle" };

type ServerAction<S> = (prev: S, fd: FormData) => Promise<S>;

export interface CatalogEditorTabProps {
  surface: SchedulerAdminSurface;
  surfaceLabel: string;
  uploadAction: ServerAction<SchedulerUploadState>;
  exportAction: ServerAction<SchedulerExportState>;
  recentUploads: AuditLogEntry[];
  /** Optional summary shown above the upload form (e.g., "1,017 active questions"). */
  currentStateSummary?: ReactNode;
  /** Suggested filename when the user clicks Export (e.g., "subcategory-descriptions"). */
  exportFilenameBase: string;
  /**
   * Extra form fields the action needs beyond the universal Pattern S shape.
   * Used by `<ConcernsPerCategoryTab>` to inject `category_slug` into every
   * dispatched FormData (preview, apply, export). For the 8 universal
   * surfaces leave this undefined.
   */
  extraFormFields?: Record<string, string>;
}

export function CatalogEditorTab({
  surface,
  surfaceLabel,
  uploadAction,
  exportAction,
  recentUploads,
  currentStateSummary,
  exportFilenameBase,
  extraFormFields,
}: CatalogEditorTabProps) {
  // Helper to inject extra fields into a FormData before dispatch.
  function withExtras(fd: FormData): FormData {
    if (extraFormFields) {
      for (const [k, v] of Object.entries(extraFormFields)) {
        fd.set(k, v);
      }
    }
    return fd;
  }
  const router = useRouter();
  const [uploadState, dispatchUpload, isUploadPending] = useActionState(
    uploadAction,
    initialUpload,
  );
  const [exportState, dispatchExport, isExportPending] = useActionState(
    exportAction,
    initialExport,
  );
  const [, startRefreshTransition] = useTransition();

  // Plan §4 step 4 — locked MD that was previewed; Apply must send this
  // exact content (NOT any newer textarea value).
  const [previewedMd, setPreviewedMd] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ─── Effects ────────────────────────────────────────────────────────────

  // Open dialog on needs_confirmation.
  useEffect(() => {
    if (uploadState.kind === "needs_confirmation") {
      setPreviewedMd(uploadState.args.md_content);
      setDialogOpen(true);
    }
  }, [uploadState]);

  // Terminal state effects.
  useEffect(() => {
    if (uploadState.kind === "success") {
      toast.success(`${surfaceLabel} uploaded`, {
        description: `+${uploadState.data.rows_added} added · ${uploadState.data.rows_modified} modified · ${uploadState.data.rows_deactivated} deactivated · audit #${uploadState.data.audit_log_id}${uploadState.data.duplicate_upload ? " (no-op duplicate)" : ""}`,
      });
      setDialogOpen(false);
      setPreviewedMd(null);
      // Reset textarea so next paste starts fresh.
      if (textareaRef.current) textareaRef.current.value = "";
      // Plan §5 refresh contract — bring in the new audit-log row + summary.
      startRefreshTransition(() => router.refresh());
    }
    if (uploadState.kind === "tool_error") {
      toast.error(`Upload failed${uploadState.data.reason_code ? ` — ${uploadState.data.reason_code}` : ""}`, {
        description: uploadState.data.message,
      });
      // Keep dialog OPEN for current_state_drift so user can re-preview.
      if (uploadState.data.reason_code !== "current_state_drift") {
        setDialogOpen(false);
      }
    }
    if (uploadState.kind === "transport_error") {
      toast.error("Transport error", { description: uploadState.message });
      setDialogOpen(false);
    }
    if (uploadState.kind === "validation_error") {
      toast.error("Validation error", { description: uploadState.message });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- state.timestamp keys re-runs
  }, [uploadState]);

  // Export success → trigger browser download.
  useEffect(() => {
    if (exportState.kind === "success") {
      const stamp = new Date().toISOString().split("T")[0];
      downloadMdAsFile(exportState.data.md_content, `${exportFilenameBase}-${stamp}.md`);
      toast.success(`Exported ${exportState.data.row_count} row${exportState.data.row_count === 1 ? "" : "s"}`);
    }
    if (exportState.kind === "tool_error") {
      toast.error("Export failed", { description: exportState.data.message });
    }
    if (exportState.kind === "transport_error") {
      toast.error("Transport error", { description: exportState.message });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportState]);

  // ─── Handlers ──────────────────────────────────────────────────────────

  function handleExport() {
    startTransition(() => dispatchExport(withExtras(new FormData())));
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const result = await parseUploadedMdFile(file);
    if (!result.ok) {
      toast.error("File rejected", { description: result.message });
      e.target.value = "";
      return;
    }
    if (textareaRef.current) {
      textareaRef.current.value = result.content;
    }
    e.target.value = "";
  }

  function handlePreviewDiff() {
    const md = textareaRef.current?.value ?? "";
    if (md.trim().length === 0) {
      toast.error("Paste or upload markdown first.");
      return;
    }
    const fd = new FormData();
    fd.set("md_content", md);
    fd.set("dry_run", "true");
    startTransition(() => dispatchUpload(withExtras(fd)));
  }

  function handleConfirmApply() {
    if (uploadState.kind !== "needs_confirmation") return;
    if (previewedMd === null) return;
    const fd = new FormData();
    fd.set("md_content", previewedMd);
    fd.set("dry_run", "false");
    fd.set("expected_confirm_token", uploadState.confirmation.confirm_token);
    startTransition(() => dispatchUpload(withExtras(fd)));
  }

  function handleDialogOpenChange(next: boolean) {
    if (isUploadPending && !next) return; // close-guard
    setDialogOpen(next);
    if (!next) {
      // Cancel — re-enable the textarea per plan §4 step 4 ("Cancel
      // clears previewedMd, re-enables inputs").
      setPreviewedMd(null);
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────

  const textareaLocked = previewedMd !== null;

  return (
    <div className="space-y-6">
      {/* Current state */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Current state</CardTitle>
          {currentStateSummary && (
            <CardDescription>{currentStateSummary}</CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={handleExport} loading={isExportPending} loadingText="Exporting…" className="gap-1.5">
            <Download className="h-4 w-4" aria-hidden="true" />
            Export current as .md
          </Button>
        </CardContent>
      </Card>

      {/* Upload new MD */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload new MD</CardTitle>
          <CardDescription>
            Paste or upload a markdown file. Click <strong>Preview diff</strong> to see what would change before applying.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="paste" className="w-full">
            <TabsList>
              <TabsTrigger value="paste" disabled={textareaLocked} className="gap-1.5">
                <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                Paste MD
              </TabsTrigger>
              <TabsTrigger value="upload" disabled={textareaLocked} className="gap-1.5">
                <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                Upload .md
              </TabsTrigger>
            </TabsList>

            <TabsContent value="paste" className="mt-3 space-y-2">
              <Label htmlFor={`${surface}-md-textarea`} className="sr-only">
                MD content
              </Label>
              <textarea
                id={`${surface}-md-textarea`}
                ref={textareaRef}
                rows={12}
                placeholder={`Paste ${surfaceLabel} MD here…`}
                disabled={textareaLocked}
                className="w-full rounded-md border border-input bg-background p-3 font-mono text-xs leading-relaxed outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-muted/50 disabled:opacity-70"
              />
              {textareaLocked && (
                <p className="text-xs text-muted-foreground">
                  Textarea locked — preview dialog is open. Cancel the dialog to edit again.
                </p>
              )}
            </TabsContent>

            <TabsContent value="upload" className="mt-3 space-y-2">
              <Label htmlFor={`${surface}-md-file`} className="sr-only">
                Upload .md file
              </Label>
              <input
                id={`${surface}-md-file`}
                type="file"
                accept=".md,.markdown,.txt,text/markdown,text/plain"
                onChange={handleFileSelected}
                disabled={textareaLocked}
                className="block w-full text-xs file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-primary-foreground hover:file:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              />
              <p className="text-xs text-muted-foreground">
                Reads the file into the paste textarea above. ≤2 MB, UTF-8, .md/.markdown/.txt extension.
              </p>
            </TabsContent>
          </Tabs>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              onClick={handlePreviewDiff}
              loading={isUploadPending && !textareaLocked}
              loadingText="Previewing…"
              disabled={textareaLocked}
              className="gap-1.5"
            >
              <Eye className="h-4 w-4" aria-hidden="true" />
              Preview diff (dry-run)
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Recent uploads */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent uploads (last 10)</CardTitle>
          <CardDescription>
            Per-row revert. Eligibility is checked server-side; the Revert button is a UX hint only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RecentUploadsList rows={recentUploads} surface={surface} surfaceLabel={surfaceLabel} />
        </CardContent>
      </Card>

      {/* Diff preview modal */}
      {uploadState.kind === "needs_confirmation" && (
        <DiffPreviewDialog
          open={dialogOpen}
          onOpenChange={handleDialogOpenChange}
          surfaceLabel={surfaceLabel}
          confirmation={uploadState.confirmation}
          isPending={isUploadPending}
          onConfirm={handleConfirmApply}
        />
      )}
    </div>
  );
}
