"use client";

/**
 * TemplatesDirectTab — customer message templates for /schedulerconfig.
 *
 * OTP is fixed (not editable here). Editable matrix:
 *   kind    = confirmation | reminder_24h | reminder_2h
 *   channel = sms | email
 * per scope:
 *   "Shop default" (type_id = null) + one entry per ACTIVE appointment type.
 *
 * Each grid cell shows whether a template exists AT THIS scope or inherits
 * the shop default. Clicking a cell opens <TemplatesEditor>. All saves go
 * through setMessageTemplateAction (type_id null = shop default).
 */
import { useMemo, useState } from "react";
import { Mail, MessageSquare, PencilLine } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  AppointmentTypeAdminRow,
  MessageTemplateRow,
} from "@/lib/scheduler/read-dal";
import { TemplatesEditor } from "./TemplatesEditor";

const KINDS: { kind: MessageTemplateRow["kind"]; label: string }[] = [
  { kind: "confirmation", label: "Confirmation" },
  { kind: "reminder_24h", label: "24-hour reminder" },
  { kind: "reminder_2h", label: "2-hour reminder" },
];

const CHANNELS: {
  channel: MessageTemplateRow["channel"];
  label: string;
  Icon: typeof Mail;
}[] = [
  { channel: "sms", label: "SMS", Icon: MessageSquare },
  { channel: "email", label: "Email", Icon: Mail },
];

interface Scope {
  typeId: string | null;
  label: string;
}

type CellKey = `${string}|${MessageTemplateRow["kind"]}|${MessageTemplateRow["channel"]}`;

function cellKey(
  typeId: string | null,
  kind: MessageTemplateRow["kind"],
  channel: MessageTemplateRow["channel"],
): CellKey {
  return `${typeId ?? "__default__"}|${kind}|${channel}`;
}

export interface TemplatesDirectTabProps {
  templates: MessageTemplateRow[];
  types: AppointmentTypeAdminRow[];
}

export function TemplatesDirectTab({ templates, types }: TemplatesDirectTabProps) {
  const scopes: Scope[] = useMemo(
    () => [
      { typeId: null, label: "Shop default" },
      ...types
        .filter((t) => t.active)
        .map((t) => ({ typeId: t.id, label: t.label })),
    ],
    [types],
  );

  const [activeScope, setActiveScope] = useState<string>("__default__");

  // Index every template by (typeId, kind, channel) for O(1) cell lookup.
  const byCell = useMemo(() => {
    const map = new Map<CellKey, MessageTemplateRow>();
    for (const t of templates) map.set(cellKey(t.type_id, t.kind, t.channel), t);
    return map;
  }, [templates]);

  const [editor, setEditor] = useState<{
    typeId: string | null;
    scopeLabel: string;
    kind: MessageTemplateRow["kind"];
    channel: MessageTemplateRow["channel"];
    ownRow: MessageTemplateRow | null;
    inheritedRow: MessageTemplateRow | null;
  } | null>(null);

  // scopes[0] is always the shop-default entry (unconditionally unshifted).
  const scope: Scope =
    scopes.find((s) => (s.typeId ?? "__default__") === activeScope) ??
    scopes[0] ?? { typeId: null, label: "Shop default" };

  function openEditor(
    kind: MessageTemplateRow["kind"],
    channel: MessageTemplateRow["channel"],
  ) {
    const ownRow = byCell.get(cellKey(scope.typeId, kind, channel)) ?? null;
    const inheritedRow =
      scope.typeId === null
        ? null
        : byCell.get(cellKey(null, kind, channel)) ?? null;
    setEditor({
      typeId: scope.typeId,
      scopeLabel: scope.label,
      kind,
      channel,
      ownRow,
      inheritedRow,
    });
  }

  return (
    <div className="space-y-6">
      {/* Comms-phase banner */}
      <div className="rounded-md border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
        Sends activate with the comms phase — templates resolve immediately but
        nothing texts or emails customers until consent + senders ship. OTP
        codes are fixed and not editable here.
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <PencilLine className="h-4 w-4" aria-hidden="true" />
            Message templates
          </CardTitle>
          <CardDescription>
            Pick a scope, then edit any cell. A cell either has its own template
            at this scope or inherits the shop default.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Scope picker */}
          <div className="space-y-1">
            <label
              htmlFor="tpl-scope"
              className="text-xs uppercase tracking-wider text-muted-foreground"
            >
              Scope
            </label>
            <select
              id="tpl-scope"
              value={activeScope}
              onChange={(e) => setActiveScope(e.target.value)}
              className="flex h-8 w-full max-w-xs rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-auto"
            >
              {scopes.map((s) => (
                <option key={s.typeId ?? "__default__"} value={s.typeId ?? "__default__"}>
                  {s.label}
                  {s.typeId === null ? " (applies unless overridden)" : ""}
                </option>
              ))}
            </select>
          </div>

          {/* kind × channel grid */}
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-2">
              <caption className="sr-only">
                Message templates for {scope.label}: kinds by channel
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="w-40 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Message
                  </th>
                  {CHANNELS.map(({ channel, label, Icon }) => (
                    <th
                      key={channel}
                      scope="col"
                      className="text-left text-xs font-medium uppercase tracking-wider text-muted-foreground"
                    >
                      <span className="flex items-center gap-1.5">
                        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                        {label}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {KINDS.map(({ kind, label }) => (
                  <tr key={kind}>
                    <th scope="row" className="text-left align-top text-sm font-medium">
                      {label}
                    </th>
                    {CHANNELS.map(({ channel }) => {
                      const own = byCell.get(cellKey(scope.typeId, kind, channel)) ?? null;
                      const inheritsDefault =
                        !own &&
                        scope.typeId !== null &&
                        !!byCell.get(cellKey(null, kind, channel));
                      const missing = !own && !inheritsDefault;
                      return (
                        <td key={channel} className="align-top">
                          <button
                            type="button"
                            onClick={() => openEditor(kind, channel)}
                            className={cn(
                              "group flex w-full min-w-[9rem] flex-col gap-1 rounded-lg border border-border bg-background p-3 text-left text-sm shadow-xs transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                            )}
                            aria-label={`Edit ${label} ${channel} template for ${scope.label}`}
                          >
                            {own ? (
                              <Badge variant="default">Set here</Badge>
                            ) : inheritsDefault ? (
                              <Badge variant="secondary">Inherited</Badge>
                            ) : (
                              <Badge variant="outline">Not set</Badge>
                            )}
                            <span className="flex items-center gap-1 text-xs text-muted-foreground group-hover:text-foreground">
                              <PencilLine className="h-3 w-3" aria-hidden="true" />
                              {missing ? "Add template" : "Edit"}
                            </span>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {scope.typeId !== null && (
            <p className="text-xs text-muted-foreground">
              Cells marked <span className="font-medium">Inherited</span> use the
              shop default until you set an override here. Editing an inherited
              cell seeds the editor from the shop default.
            </p>
          )}
        </CardContent>
      </Card>

      {editor && (
        <TemplatesEditor
          open={editor !== null}
          onOpenChange={(open) => {
            if (!open) setEditor(null);
          }}
          typeId={editor.typeId}
          scopeLabel={editor.scopeLabel}
          kind={editor.kind}
          channel={editor.channel}
          ownRow={editor.ownRow}
          inheritedRow={editor.inheritedRow}
        />
      )}
    </div>
  );
}
