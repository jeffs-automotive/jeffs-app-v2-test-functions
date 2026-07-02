// config — llm-testing module.
// Extracted from llm-testing/index.ts (file-size-refactor). Mechanical split.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Anthropic from "npm:@anthropic-ai/sdk@^0.97";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SECRET_KEY")!;
const AI_GATEWAY_API_KEY = Deno.env.get("AI_GATEWAY_API_KEY")!;
export const SHOP_ID = parseInt(Deno.env.get("TEKMETRIC_SHOP_ID") ?? "7476", 10);

const DEFAULT_MODEL = "anthropic/claude-haiku-4-5";
export const FALLBACK_MODEL = "anthropic/claude-sonnet-4-6";
export const MAX_OUTPUT_TOKENS = 1024;

export const STAGE1_MODEL =
  Deno.env.get("DIAGNOSE_CONCERN_STAGE1_MODEL") ??
  Deno.env.get("DIAGNOSE_CONCERN_MODEL") ??
  DEFAULT_MODEL;
export const STAGE2_MODEL =
  Deno.env.get("DIAGNOSE_CONCERN_STAGE2_MODEL") ??
  Deno.env.get("DIAGNOSE_CONCERN_MODEL") ??
  DEFAULT_MODEL;
export const STAGE3_MODEL =
  Deno.env.get("DIAGNOSE_CONCERN_STAGE3_MODEL") ??
  Deno.env.get("DIAGNOSE_CONCERN_MODEL") ??
  DEFAULT_MODEL;

export const OTHER_CONCERN_CATEGORY = "other";

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const anthropic = new Anthropic({
  apiKey: AI_GATEWAY_API_KEY,
  baseURL: "https://ai-gateway.vercel.sh",
});
