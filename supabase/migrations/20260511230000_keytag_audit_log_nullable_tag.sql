-- =====================================================================
-- Allow keytag_audit_log rows without tag context (policy decisions)
-- =====================================================================
-- Created 2026-05-11. When a manual review resolves with "no_tag" or
-- "escalate_chris", there's no specific tag involved — the row is a
-- policy/decision audit entry, not a tag mutation. Previously these
-- failed the CHECK constraint that required tag_number BETWEEN 1 AND 90.
--
-- Relax to: (tag_color, tag_number) are BOTH NULL OR BOTH valid.
-- =====================================================================

ALTER TABLE public.keytag_audit_log ALTER COLUMN tag_color DROP NOT NULL;
ALTER TABLE public.keytag_audit_log ALTER COLUMN tag_number DROP NOT NULL;

ALTER TABLE public.keytag_audit_log DROP CONSTRAINT IF EXISTS keytag_audit_log_tag_color_check;
ALTER TABLE public.keytag_audit_log DROP CONSTRAINT IF EXISTS keytag_audit_log_tag_number_check;

ALTER TABLE public.keytag_audit_log ADD CONSTRAINT keytag_audit_log_tag_consistency CHECK (
  (tag_color IS NULL AND tag_number IS NULL)
  OR
  (tag_color IN ('red', 'yellow') AND tag_number BETWEEN 1 AND 90)
);
