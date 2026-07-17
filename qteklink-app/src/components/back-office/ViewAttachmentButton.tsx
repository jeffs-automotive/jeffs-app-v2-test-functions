"use client";

/**
 * ViewAttachmentButton — pulls the scanned parts-invoice image attached to this Bill/
 * Purchase in QuickBooks and shows it in a dialog. Fetched on demand (the QBO download URL
 * is short-lived), so it re-loads each time rather than persisting the URL. Read-only.
 */
import { useActionState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { fetchAttachmentsAction } from "@/actions/back-office/issues";
import type { VendorDocType } from "@/lib/qbo/vendor-docs";

export function ViewAttachmentButton({ qboTxnType, qboTxnId }: { qboTxnType: VendorDocType; qboTxnId: string }) {
  const [state, action, pending] = useActionState(fetchAttachmentsAction, null);

  return (
    <Dialog>
      <DialogTrigger render={<Button size="sm" variant="ghost" />}>
        <ImageIcon aria-hidden="true" />
        Image
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Parts invoice</DialogTitle>
          <DialogDescription>The scanned document attached to this bill in QuickBooks.</DialogDescription>
        </DialogHeader>
        <form action={action} className="mt-2">
          <input type="hidden" name="qbo_txn_type" value={qboTxnType} />
          <input type="hidden" name="qbo_txn_id" value={qboTxnId} />
          <Button type="submit" size="sm" variant="outline" loading={pending} loadingText="Loading…">
            <ImageIcon aria-hidden="true" />
            Load image
          </Button>
        </form>

        {state?.ok === false && <p className="mt-3 text-xs text-red-700 dark:text-red-400">{state.message}</p>}
        {state?.ok && state.data.length === 0 && (
          <p className="mt-3 text-sm text-muted-foreground">No document is attached to this bill in QuickBooks.</p>
        )}
        {state?.ok && state.data.length > 0 && (
          <div className="mt-3 grid gap-3">
            {state.data.map((a) => (
              <figure key={a.qboAttachableId} className="m-0">
                {a.tempDownloadUri ? (
                  <a href={a.tempDownloadUri} target="_blank" rel="noopener noreferrer">
                    {/* External short-lived QBO URL — next/image can't optimize it. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={a.tempDownloadUri}
                      alt={a.fileName ?? "Parts invoice"}
                      className="max-h-[60vh] w-full rounded-md border border-border object-contain"
                    />
                  </a>
                ) : (
                  <p className="text-sm text-muted-foreground">{a.fileName ?? "Attachment"} (no preview available)</p>
                )}
                {a.fileName && <figcaption className="mt-1 text-xs text-muted-foreground">{a.fileName}</figcaption>}
              </figure>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
