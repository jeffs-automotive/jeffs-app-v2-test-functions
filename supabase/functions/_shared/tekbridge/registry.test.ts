// Deno-native unit tests for the tekbridge capability registry.
//
//   deno test --allow-env supabase/functions/_shared/tekbridge/registry.test.ts

import { assert, assertEquals } from "jsr:@std/assert@^1";
import { z } from "npm:zod@^4";
import { getTekbridgeTools } from "./registry.ts";

Deno.test("getTekbridgeTools: exposes concern write + delete with valid tool() shape", () => {
  // deno-lint-ignore no-explicit-any
  const tools = getTekbridgeTools({ sb: {} as any, shopId: 7476 }) as unknown as Record<string, {
    description: string;
    inputSchema: z.ZodTypeAny;
    execute: (i: unknown) => Promise<unknown>;
  }>;

  for (const name of ["write_customer_concern", "delete_customer_concern"]) {
    assert(name in tools, `${name} present`);
    const t = tools[name];
    assert(typeof t.description === "string" && t.description.length > 0, `${name} has a description`);
    assert(typeof t.inputSchema?.parse === "function", `${name} inputSchema is a zod schema`);
    assert(typeof t.execute === "function", `${name} has execute`);
    // names conform to Anthropic's tool-name regex (enforced again at merge time)
    assert(/^[a-zA-Z0-9_-]{1,64}$/.test(name), `${name} is a valid tool name`);
  }

  // the write schema validates the expected input
  const parsed = tools.write_customer_concern.inputSchema.parse({ repair_order_id: 345, concern: "brake noise" });
  assertEquals((parsed as { repair_order_id: number }).repair_order_id, 345);
});
