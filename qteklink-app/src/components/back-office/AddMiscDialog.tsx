"use client";

/** AddMiscDialog — the office manager's free-form issue: title + optional RO# + notes. */
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { createMiscAction } from "@/actions/back-office/issues";

const inputCls =
  "w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function AddMiscDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createMiscAction, null);

  useEffect(() => {
    if (state?.ok) {
      setOpen(false);
      router.refresh();
    }
  }, [state?.timestamp, state?.ok, router]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus aria-hidden="true" />
        Add
      </DialogTrigger>
      <DialogContent>
        <form action={action}>
          <DialogHeader>
            <DialogTitle>Add a misc issue</DialogTitle>
            <DialogDescription>A one-off issue to send to the service advisors.</DialogDescription>
          </DialogHeader>
          <div className="mt-3 grid gap-3">
            <label className="block text-xs font-medium text-muted-foreground">
              Title
              <Input name="title" className="mt-1" maxLength={200} placeholder="Short summary" required />
            </label>
            <label className="block text-xs font-medium text-muted-foreground">
              RO # (if applicable)
              <Input name="ro_number" className="mt-1 tabular-nums" inputMode="numeric" maxLength={64} placeholder="e.g. 154157" />
            </label>
            <label className="block text-xs font-medium text-muted-foreground">
              Notes
              <textarea name="bo_notes" rows={4} maxLength={4000} className={`mt-1 ${inputCls}`} placeholder="What needs to happen?" />
            </label>
          </div>
          {state?.ok === false && <p className="mt-2 text-xs text-red-700 dark:text-red-400">{state.message}</p>}
          <DialogFooter className="mt-3">
            <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
            <Button type="submit" loading={pending} loadingText="Adding…">
              <Plus aria-hidden="true" />
              Add issue
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
