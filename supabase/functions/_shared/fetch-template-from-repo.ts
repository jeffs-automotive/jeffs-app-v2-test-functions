// Server-side template fetcher for the orchestrator's upload_*_md tools.
//
// Why this exists: passing a 213KB markdown file through MCP as a tool
// argument forces the chat model (Haiku 4.5) to materialize the entire
// file as a JSON-encoded string in its context, which it consistently
// corrupts on files >100KB. Instead, Haiku passes a tiny ~50-byte tool
// call with no content; the orchestrator fetches the canonical version
// directly from the public GitHub repo's main branch.
//
// Source-of-truth shift: a template's "official" state is now what's
// on the main branch, not what's on any particular machine. Advisors
// edit the file, commit + push, then call the upload tool. Git history
// captures every catalog edit before it lands in the database.

const REPO_OWNER = "jeffs-automotive";
const REPO_NAME = "jeffs-app-v2-test-functions";

export interface FetchTemplateOptions {
  /** Repo path, e.g. "docs/chat-instructions/scheduler/templates/testing-services.md". */
  path: string;
  /** Branch / tag / commit-sha. Defaults to "main". */
  branch?: string;
}

export interface FetchTemplateResult {
  /** Raw file content (markdown). */
  content: string;
  /** Fully-qualified raw URL used. */
  url: string;
  /** Branch fetched from. */
  branch: string;
  /** Byte length of the fetched content. */
  size_bytes: number;
}

/**
 * Fetch a template file from the project's GitHub repo (public; no auth).
 *
 * Throws an Error with a descriptive message for:
 *   - 404 (file not found at that path/branch)
 *   - other non-2xx HTTP statuses
 *   - network / timeout errors
 *
 * The error message is intentionally verbose so the chat-agent can relay
 * it verbatim to the advisor for self-service diagnosis.
 */
export async function fetchTemplateFromRepo(
  options: FetchTemplateOptions,
): Promise<FetchTemplateResult> {
  const branch = options.branch ?? "main";
  // raw.githubusercontent.com serves the raw file bytes without API rate
  // limiting (the unauthenticated GitHub API is rate-limited at 60 req/hr per IP).
  const url = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${branch}/${options.path}`;

  let resp: Response;
  try {
    resp = await fetch(url, {
      // No auth header: repo is public. Adding Authorization breaks anonymous fetches.
      headers: { "User-Agent": "jeffs-app-v2-orchestrator" },
      // 15s deadline — large markdown files are still under a few hundred KB.
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `template_fetch_failed: network error fetching ${url}: ${msg}. ` +
        `Check internet connectivity from the Supabase edge runtime; the repo is public so no auth is needed.`,
    );
  }

  if (resp.status === 404) {
    throw new Error(
      `template_not_found: ${options.path} not found on branch '${branch}'. ` +
        `Confirm the file exists at https://github.com/${REPO_OWNER}/${REPO_NAME}/blob/${branch}/${options.path} ` +
        `— most common cause is the advisor edited the file locally but didn't push to ${branch} yet.`,
    );
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(
      `template_fetch_failed: HTTP ${resp.status} ${resp.statusText} fetching ${url}. ` +
        `Body: ${body.slice(0, 200)}`,
    );
  }

  const content = await resp.text();
  return {
    content,
    url,
    branch,
    size_bytes: new TextEncoder().encode(content).byteLength,
  };
}

/**
 * Resolve the markdown content for an upload tool, given the tool's input.
 * Used by every upload_*_md tool registration to support all three input
 * paths (default-source, source-path-override, inline-md_content).
 *
 * @param defaultPath  Per-tool hardcoded default repo path (e.g.
 *                     "docs/chat-instructions/scheduler/templates/testing-services.md")
 * @param input        Tool input — at least one of md_content, source_path,
 *                     or null (use defaultPath).
 *
 * Resolution order:
 *   1. `input.md_content` — use it verbatim (legacy inline path)
 *   2. `input.source_path` — fetch from repo (with optional source_branch)
 *   3. `defaultPath` — fetch from repo at "main"
 */
export async function resolveMdContent(
  defaultPath: string,
  input: {
    md_content?: string | null;
    source_path?: string | null;
    source_branch?: string | null;
  },
): Promise<{ md_content: string; source: "inline" | "repo"; source_url?: string }> {
  if (input.md_content && input.md_content.length > 0) {
    return { md_content: input.md_content, source: "inline" };
  }
  const path = input.source_path && input.source_path.length > 0
    ? input.source_path
    : defaultPath;
  const result = await fetchTemplateFromRepo({
    path,
    branch: input.source_branch ?? "main",
  });
  return {
    md_content: result.content,
    source: "repo",
    source_url: result.url,
  };
}
