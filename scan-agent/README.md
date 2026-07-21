# scan-agent — shop-PC install runbook

The Windows service that bridges the ScanSnap iX2500's PC-free network-folder scans into Supabase.
Design: `docs/document-intake/document-intake-plan.md` (D5/D6/D12). The PC holds ONE narrow
credential (`AGENT_TOKEN`); paths, storage access, and routing all live server-side.

## How it works

```
iX2500 touchscreen profile ──SMB──▶ C:\Scans\{profile}\
                                        │  (watch + 5-min re-scan; 10s stability gate;
                                        │   exclusive-open probe; magic-byte check)
                                        ▼
                              C:\ScanAgent\work\{uuid}.pdf     ← atomic claim + ledger entry
                                        │  gateway: request_upload → signed URL → PUT → confirm
                                        ▼
                        Supabase vehicle-docs bucket → document_intake_files (ready)
                                        │
                              C:\ScanAgent\archive\uploaded\{profile}\   (purged after 30 days)
                              C:\ScanAgent\archive\failed\{profile}\     (never auto-purged)
```

Failures retry forever with backoff (cap 30 min); Sentry fires on the 3rd consecutive failure,
on >25 stuck jobs, and on the disk free-space floor (5GB). A scan file is never deleted before a
confirmed upload, and the JSONL ledger (`C:\ScanAgent\ledger.jsonl`) resumes everything across
crashes/reboots.

## One-time install (elevated PowerShell)

1. **Prereqs:** Node.js ≥ 20 LTS (winget install OpenJS.NodeJS.LTS).
2. **Get the code** onto the PC (e.g. `C:\ScanAgent-app`): copy this `scan-agent/` folder.
3. `cd C:\ScanAgent-app && npm install`
4. **Configure:** `copy .env.example .env`, fill `AGENT_TOKEN` + `SENTRY_DSN`, then restrict it:
   `icacls .env /inheritance:r /grant:r "SYSTEM:F" "Administrators:F"`
5. **Create the drop share** (folder names = profile keys from `/schedulerconfig`-era seeds):
   ```powershell
   New-Item -ItemType Directory -Force C:\Scans\inspection_docs, C:\Scans\loaner_insurance
   # dedicated write-only scanner account:
   $pw = Read-Host -AsSecureString "scanner account password"
   New-LocalUser -Name scanner -Password $pw -PasswordNeverExpires -AccountNeverExpires
   New-SmbShare -Name scans -Path C:\Scans -FullAccess "Administrators" -ChangeAccess "scanner"
   # SMB hardening (plan D12): require SMB3 + signing
   Set-SmbServerConfiguration -EncryptData $true -RejectUnencryptedAccess $false -Force
   ```
   NTFS: give `scanner` Modify on `C:\Scans` only. `C:\ScanAgent` stays SYSTEM+Administrators
   (retained cards must NOT be browsable on the share — the archive lives outside it).
6. **Never-sleep + clock:**
   ```powershell
   powercfg /change standby-timeout-ac 0
   powercfg /change hibernate-timeout-ac 0
   w32tm /resync   # signed uploads + TLS are clock-sensitive
   ```
7. **Install the service:** `npm run service:install` → verify in `services.msc`
   (JeffsDocumentIntakeAgent, Automatic, Running). Log out — it keeps running.
8. **Scanner profiles** (ScanSnap Home, one-time): two network-folder profiles →
   `\\<THIS-PC>\scans\inspection_docs` and `\\<THIS-PC>\scans\loaner_insurance`, credentials =
   the `scanner` account. Scanner needs NTP egress (UDP 123) through the firewall.
   Gotcha: changing a profile's display-users setting wipes its stored SMB credentials.

## Operations

- Logs: `service/daemon/*.log` (node-windows) + Windows Event Viewer; JSON lines.
- Health: heartbeat every 15 min → `document_intake_agent_state`; the daily watchdog emails
  Chris (via Sentry rule) if it goes stale >2h during shop hours.
- Files stuck in `C:\ScanAgent\archive\failed\` were REJECTED (wrong type / gateway refusal) —
  a human decides; nothing auto-deletes there.
- Token rotation: set the new value in Supabase secrets AND `.env`, then
  `Restart-Service JeffsDocumentIntakeAgent`.
