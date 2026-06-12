/**
 * PageHeader — the shared page chrome for QTekLink (mirrors admin-app's
 * PageHeader idiom). Neutral title in --foreground (not a burgundy headline),
 * a muted description, and an optional right slot (the signed-in identity
 * block, an action button, etc.). Purely presentational.
 */
import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-foreground">{title}</h1>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children ? <div className="text-right">{children}</div> : null}
    </header>
  );
}

/**
 * IdentityBlock — the email + "role · shop N" pair shown on the right of most
 * page headers, with the role as an outline Badge instead of raw uppercase text.
 */
export function IdentityBlock({
  email,
  role,
  shopId,
}: {
  email: string;
  role: string;
  shopId: number | string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div>
        <p className="text-sm font-medium text-foreground">{email}</p>
        <p className="text-xs text-muted-foreground">shop {shopId}</p>
      </div>
      <RoleBadge role={role} />
    </div>
  );
}

import { Badge } from "@/components/ui/badge";

function RoleBadge({ role }: { role: string }) {
  return (
    <Badge variant="outline" className="uppercase tracking-wide">
      {role}
    </Badge>
  );
}
