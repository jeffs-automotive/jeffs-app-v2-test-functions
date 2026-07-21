// Install the scan agent as a Windows Service (plan D6): auto-start at boot,
// runs with nobody logged in, auto-restart on crash. node-windows wraps
// winsw under the hood. Run from an ELEVATED prompt: npm run service:install

import path from "node:path";
import { fileURLToPath } from "node:url";
import nodewindows from "node-windows";

const { Service } = nodewindows;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const svc = new Service({
  name: "JeffsDocumentIntakeAgent",
  description:
    "Jeff's Automotive document-intake scan agent — watches C:\\Scans and uploads to Supabase via the document-intake-agent gateway.",
  script: path.join(root, "src", "agent.mjs"),
  workingDirectory: root, // .env is resolved from here
  // Restart aggressively but not hot-loopingly.
  wait: 2,
  grow: 0.5,
  maxRestarts: 40,
});

svc.on("install", () => {
  console.log("Service installed. Starting…");
  svc.start();
});
svc.on("start", () => console.log("JeffsDocumentIntakeAgent started."));
svc.on("alreadyinstalled", () => console.log("Already installed — run service:uninstall first to reconfigure."));
svc.on("error", (e) => {
  console.error("Service error:", e);
  process.exitCode = 1;
});

svc.install();
