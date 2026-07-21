// Config tests — required env fail-closed + last-good gateway-config cache
// (a Supabase outage must never strand scanning; files queue locally).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fetchGatewayConfig, layout, loadConfig } from "./config.mjs";

const ENV_KEYS = ["GATEWAY_URL", "AGENT_TOKEN", "WORK_ROOT"];
let saved;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("loadConfig", () => {
  it("fails closed without GATEWAY_URL/AGENT_TOKEN", () => {
    delete process.env.GATEWAY_URL;
    delete process.env.AGENT_TOKEN;
    expect(() => loadConfig("/nonexistent/.env")).toThrow(/required/);
  });

  it("loads with env set + strips trailing slash", () => {
    process.env.GATEWAY_URL = "https://gw.example/fn/";
    process.env.AGENT_TOKEN = "tok";
    const cfg = loadConfig("/nonexistent/.env");
    expect(cfg.gatewayUrl).toBe("https://gw.example/fn");
    expect(cfg.retentionDays).toBe(30);
  });
});

describe("fetchGatewayConfig", () => {
  function cfgWithTmpWork() {
    process.env.GATEWAY_URL = "https://gw.example/fn";
    process.env.AGENT_TOKEN = "tok";
    process.env.WORK_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "cfg-"));
    return loadConfig("/nonexistent/.env");
  }

  it("caches a good response, then serves it stale when the gateway is down", async () => {
    const cfg = cfgWithTmpWork();
    const good = { ok: true, profiles: [{ key: "inspection_docs", label: "X" }] };
    const okFetch = async () => new Response(JSON.stringify(good), { status: 200 });
    const first = await fetchGatewayConfig(cfg, okFetch);
    expect(first.profiles).toHaveLength(1);
    expect(fs.existsSync(layout(cfg).configCachePath)).toBe(true);

    const downFetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    const second = await fetchGatewayConfig(cfg, downFetch);
    expect(second.stale).toBe(true);
    expect(second.profiles).toEqual(good.profiles);
  });

  it("throws when the gateway is down AND no cache exists", async () => {
    const cfg = cfgWithTmpWork();
    await expect(fetchGatewayConfig(cfg, async () => {
      throw new Error("ECONNREFUSED");
    })).rejects.toThrow(/ECONNREFUSED/);
  });
});
