// Diagnostic: confirms which env vars the --env-file loader picked up.
// Prints presence + length + 7-char prefix only — never the full value.
const keys = [
  "ANTHROPIC_API_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_URL",
  // 2026 canonical (Vercel Marketplace integration injects these)
  "SUPABASE_SECRET_KEYS",
  "SUPABASE_PUBLISHABLE_KEYS",
  // Transition-period singulars
  "SUPABASE_SECRET_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  // Legacy
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
];
for (const k of keys) {
  const v = process.env[k];
  if (!v) {
    console.log(`${k.padEnd(35)} MISSING`);
  } else {
    const prefix = v.slice(0, 7);
    console.log(`${k.padEnd(35)} present (len=${v.length}, prefix="${prefix}…")`);
  }
}
console.log("\nTotal env vars in process.env:", Object.keys(process.env).length);
