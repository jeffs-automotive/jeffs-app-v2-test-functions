// Remove the Windows Service. Run from an ELEVATED prompt:
//   npm run service:uninstall

import path from "node:path";
import { fileURLToPath } from "node:url";
import nodewindows from "node-windows";

const { Service } = nodewindows;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const svc = new Service({
  name: "JeffsDocumentIntakeAgent",
  script: path.join(root, "src", "agent.mjs"),
});

svc.on("uninstall", () => console.log("JeffsDocumentIntakeAgent uninstalled."));
svc.on("error", (e) => {
  console.error("Service error:", e);
  process.exitCode = 1;
});

svc.uninstall();
