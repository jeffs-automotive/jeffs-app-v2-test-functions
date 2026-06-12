"use client";

/**
 * DeactivateMappingButton (C2, admin-only) — remove (deactivate) one mapping via
 * deactivateMappingAction. On success it router.refresh()es so the list updates.
 * The id is a hidden field; the action re-validates it + scopes the deactivate
 * to the session shop server-side.
 */
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deactivateMappingAction } from "@/actions/mappings";
import { Button } from "@/components/ui/button";

export default function DeactivateMappingButton({
  id,
  sourceKey,
}: {
  id: string;
  sourceKey: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(deactivateMappingAction, null);

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state?.timestamp, state?.ok, router]);

  return (
    <form action={formAction} className="shrink-0">
      <input type="hidden" name="id" value={id} />
      <Button
        type="submit"
        variant="destructive"
        size="sm"
        loading={pending}
        loadingText="Removing…"
        title={`Remove the ${sourceKey} mapping`}
      >
        <Trash2 aria-hidden="true" />
        Remove
      </Button>
    </form>
  );
}
