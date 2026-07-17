import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Loading skeleton mirroring the dashboard shape (header + metric row + stale table). */
export default function Loading() {
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
      <div className="space-y-2 border-b border-border pb-4">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-96" />
      </div>
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="flex flex-col items-center gap-2 p-5">
              <Skeleton className="h-8 w-10" />
              <Skeleton className="h-3 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="space-y-2">
        <Skeleton className="h-5 w-40" />
        <div className="overflow-hidden rounded-lg border border-border shadow-xs">
          <Skeleton className="h-10 w-full rounded-none" />
          <div className="divide-y divide-border">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="px-3 py-2.5">
                <Skeleton className="h-4 w-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
