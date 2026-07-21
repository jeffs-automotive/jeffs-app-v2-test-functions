// scan-agent watcher (plan D12): chokidar events PLUS a periodic directory
// re-scan — filesystem notifications over SMB can be lost while the service
// runs (cross-verify), so polling reconciliation is the guarantee and events
// are the latency optimization (the same belt-and-suspenders shape as the
// email channel's webhook+sweep).

import fsp from "node:fs/promises";
import path from "node:path";
import chokidar from "chokidar";

const log = (msg, ctx = {}) =>
  console.log(JSON.stringify({ level: "info", surface: "scan-agent", msg, ...ctx }));

/**
 * Guard: only plain regular files, never symlinks/reparse points (a reparse
 * point in the drop share could otherwise turn the agent into a local-file
 * exfiltration path — cross-verify security finding).
 */
export async function isPlainFile(filePath) {
  try {
    const st = await fsp.lstat(filePath);
    return st.isFile() && !st.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Start watching each profile folder. `onCandidate(filePath, profileKey)` is
 * invoked for every potential new file (from either the event stream or the
 * re-scan); the pipeline's claim step makes duplicate invocations harmless.
 * Returns { close } — close() stops the watcher + the re-scan timer.
 */
export function startWatching({ scansRoot, profileKeys, rescanMinutes = 5, onCandidate }) {
  const dirs = profileKeys.map((k) => path.join(scansRoot, k));

  const watcher = chokidar.watch(dirs, {
    ignoreInitial: false, // initial scan doubles as the startup sweep
    depth: 0,
    awaitWriteFinish: false, // our own stability gate is stricter
    followSymlinks: false,
  });

  const emit = async (filePath) => {
    const profileKey = profileKeys.find(
      (k) => path.dirname(filePath).toLowerCase() === path.join(scansRoot, k).toLowerCase(),
    );
    if (!profileKey) return;
    if (!(await isPlainFile(filePath))) return;
    onCandidate(filePath, profileKey);
  };

  watcher.on("add", (p) => void emit(p));

  const rescan = async () => {
    for (const key of profileKeys) {
      const dir = path.join(scansRoot, key);
      let entries;
      try {
        entries = await fsp.readdir(dir);
      } catch {
        continue;
      }
      for (const name of entries) {
        await emit(path.join(dir, name));
      }
    }
  };
  const timer = setInterval(() => void rescan(), rescanMinutes * 60_000);
  timer.unref?.();

  log("watching", { dirs, rescanMinutes });
  return {
    close: async () => {
      clearInterval(timer);
      await watcher.close();
    },
    rescan, // exposed for tests + manual kicks
  };
}
