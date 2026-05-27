/**
 * md-file-utils — client-side helpers for the schedulerconfig MD-upload UX.
 *
 * Per plan v0.5 §11 (upload size/encoding limits):
 *   - ≤ 2 MB file size
 *   - UTF-8 encoding required (rejects BOM + invalid bytes)
 *   - `.md` extension OR `text/markdown` MIME (advisory, not strict — some
 *     browsers report `text/plain` for `.md` files)
 *   - Empty file rejected with explicit "empty file" error
 *   - Diff display truncates at 500 changed rows with an "X more rows
 *     hidden" affordance
 *
 * All functions are pure client-side — they DO NOT call the network. The
 * upload network call happens in the Server Action layer. These helpers are
 * input-validation + browser-download utilities only.
 */

/** ~2 MB. Catches accidental paste of a 50-MB log file or similar.
 * The orchestrator-mcp tools cap MD payloads at this size too. */
export const MAX_MD_BYTES = 2 * 1024 * 1024;

/** Browser-side diff truncation cap. UI shows the first N changed rows in
 * the diff preview + an "X more rows hidden" affordance below. */
export const MAX_DIFF_DISPLAY_ROWS = 500;

/** Accepted file extensions for the file-picker. */
export const ACCEPTED_FILE_EXTENSIONS = [".md", ".markdown", ".txt"] as const;

/** Accepted MIME types (advisory — browsers vary on what they report for
 * `.md`). The validator falls back to extension if MIME is ambiguous. */
export const ACCEPTED_MIME_TYPES = [
  "text/markdown",
  "text/plain",
  "text/x-markdown",
  "application/octet-stream",
  "", // Some browsers leave .type empty
] as const;

// ─── Result types ────────────────────────────────────────────────────────

export type MdValidationOk = { ok: true; content: string; bytes: number };
export type MdValidationErr = {
  ok: false;
  error_code:
    | "file_too_large"
    | "empty_file"
    | "invalid_utf8"
    | "unsupported_extension"
    | "unsupported_mime"
    | "read_failed";
  message: string;
};
export type MdValidationResult = MdValidationOk | MdValidationErr;

// ─── Pure validators ────────────────────────────────────────────────────

/**
 * Validate raw MD content already in memory (e.g., from a paste-textarea).
 * Used by Server Actions for last-line defense too, even though the form
 * input is paste-textarea-shaped.
 */
export function validateMdContent(content: string): MdValidationResult {
  // Empty check first — fastest reject.
  if (!content || content.trim().length === 0) {
    return {
      ok: false,
      error_code: "empty_file",
      message: "MD content is empty. Paste or upload a non-empty markdown file.",
    };
  }

  // Size check — encode as UTF-8 to get the byte count (NOT the character
  // count). 2 MB cap.
  const encoder = new TextEncoder();
  const bytes = encoder.encode(content).length;
  if (bytes > MAX_MD_BYTES) {
    return {
      ok: false,
      error_code: "file_too_large",
      message: `MD content is ${formatBytes(bytes)} (max ${formatBytes(MAX_MD_BYTES)}). Trim the file or split into multiple uploads.`,
    };
  }

  // UTF-8 sanity: TextEncoder always emits valid UTF-8, but a stray
  // replacement character ("�") in the input usually means the source
  // wasn't UTF-8 (e.g., Windows-1252 file misread). Surface as a warning.
  if (content.includes("�")) {
    return {
      ok: false,
      error_code: "invalid_utf8",
      message:
        "MD content contains replacement characters (�). The source file is probably not UTF-8 encoded. Re-save as UTF-8 and retry.",
    };
  }

  return { ok: true, content, bytes };
}

// ─── File-picker handler ────────────────────────────────────────────────

/**
 * Parse a `File` from an `<input type="file">` and return the validated
 * MD content. Strips an optional UTF-8 BOM at the start of the file. Async
 * because `File.text()` returns a Promise.
 */
export async function parseUploadedMdFile(file: File): Promise<MdValidationResult> {
  // Extension check (filename heuristic — case-insensitive)
  const lowerName = file.name.toLowerCase();
  const matchedExt = ACCEPTED_FILE_EXTENSIONS.find((ext) => lowerName.endsWith(ext));
  if (!matchedExt) {
    return {
      ok: false,
      error_code: "unsupported_extension",
      message: `File '${file.name}' has an unsupported extension. Use .md / .markdown / .txt.`,
    };
  }

  // MIME check (advisory) — only reject if the browser confidently reports a
  // completely-unrelated MIME (e.g., 'image/png'). The empty-string and
  // application/octet-stream cases pass through (some browsers don't know
  // what to call .md).
  if (file.type && !ACCEPTED_MIME_TYPES.includes(file.type as (typeof ACCEPTED_MIME_TYPES)[number])) {
    return {
      ok: false,
      error_code: "unsupported_mime",
      message: `File MIME type '${file.type}' isn't a markdown variant. Expected text/markdown or text/plain.`,
    };
  }

  // Pre-empt the 2 MB cap based on byte length (faster than reading then
  // checking — but we still re-check after read to catch the rare
  // browser-reported-bytes-mismatch-actual-bytes case).
  if (file.size > MAX_MD_BYTES) {
    return {
      ok: false,
      error_code: "file_too_large",
      message: `File '${file.name}' is ${formatBytes(file.size)} (max ${formatBytes(MAX_MD_BYTES)}).`,
    };
  }

  let raw: string;
  try {
    raw = await file.text();
  } catch (e) {
    return {
      ok: false,
      error_code: "read_failed",
      message: `Couldn't read '${file.name}': ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // Strip UTF-8 BOM if present. (.text() handles UTF-16/32 but not BOM.)
  const stripped = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;

  return validateMdContent(stripped);
}

// ─── Browser download (export → save as .md) ────────────────────────────

/**
 * Trigger a browser download of MD content as a `.md` file. Pure
 * client-side — uses Blob + URL.createObjectURL + a temporary anchor click.
 *
 * Caller is responsible for the filename — typical pattern:
 *   downloadMdAsFile(result.md_content, `subcategory-descriptions-${new Date().toISOString().split('T')[0]}.md`)
 */
export function downloadMdAsFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  // Append → click → remove for cross-browser compat (Firefox needs the
  // anchor in the DOM tree for download attr to fire).
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke after a tick — the click handler may still be reading the URL
  // synchronously, so a 0-ms timeout is safer than immediate revoke.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// ─── Diff display helper ────────────────────────────────────────────────

/**
 * Truncate a list of diff rows for display per §11 plan rule. Returns the
 * first N rows + a `hidden_count` so the UI can render an "X more rows
 * hidden" affordance.
 */
export function truncateDiffForDisplay<T>(
  rows: readonly T[],
  max: number = MAX_DIFF_DISPLAY_ROWS,
): { shown: T[]; hidden_count: number } {
  if (rows.length <= max) {
    return { shown: rows.slice(), hidden_count: 0 };
  }
  return { shown: rows.slice(0, max), hidden_count: rows.length - max };
}

// ─── Internal helpers ────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
