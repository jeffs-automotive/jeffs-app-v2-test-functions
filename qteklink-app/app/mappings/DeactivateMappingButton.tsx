"use client";

/**
 * DeactivateMappingButton (C2, admin-only) — remove (deactivate) one mapping via
 * deactivateMappingAction. On success it router.refresh()es so the list updates.
 * The id is a hidden field; the action re-validates it + scopes the deactivate
 * to the session shop server-side.
 */
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { deactivateMappingAction } from "@/actions/mappings";

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
      <button
        type="submit"
        disabled={pending}
        title={`Remove the ${sourceKey} mapping`}
        className="rounded border border-stone-300 px-2 py-1 text-xs text-stone-600 transition hover:border-red-400 hover:text-red-700 disabled:opacity-60"
      >
        {pending ? "Removing…" : "Remove"}
      </button>
    </form>
  );
}
