/*
 * Signed-in screenshots of Planted HQ, for review. LOCAL ONLY.
 *
 *   npm run hq:shot -- <baseUrl> <email> <outDir> <width> <height> <path> [<path> ...]
 *   npm run hq:shot -- http://localhost:3500 shannon@planted.test shots 1280 900 /hq /hq/growth/contacts
 *
 * Mints a real Supabase session for a seeded user (no email), launches headless Chrome with
 * a throwaway profile, sets the same cookie @supabase/ssr writes, and captures the full page
 * of each path. Talks to Chrome over the DevTools protocol with Node's built-in WebSocket,
 * so it needs no extra dependency.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChunks, stringToBase64URL } from "@supabase/ssr";
import { requireLocal, sessionFor, url as supabaseUrl } from "./lib.mts";

requireLocal();

const [baseUrl, email, outDir, w, h, ...paths] = process.argv.slice(2);
if (!baseUrl || !email || !outDir || !w || !h || paths.length === 0) {
  console.error("Usage: npm run hq:shot -- <baseUrl> <email> <outDir> <width> <height> <path> [<path> ...]");
  process.exit(1);
}
const width = Number(w);
const height = Number(h);
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9300 + Math.floor(Math.random() * 400);

mkdirSync(outDir, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "hq-shot-"));
const chrome = spawn(
  CHROME,
  [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "about:blank"],
  { stdio: "ignore" },
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForChrome(): Promise<void> {
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error("Chrome did not start");
}

type Pending = { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void };

async function main() {
  await waitForChrome();
  const target = (await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json()) as { webSocketDebuggerUrl: string };
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise<void>((res, rej) => {
    ws.addEventListener("open", () => res());
    ws.addEventListener("error", () => rej(new Error("DevTools socket failed")));
  });

  let id = 0;
  const pending = new Map<number, Pending>();
  const waiters: Array<{ method: string; resolve: () => void }> = [];
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data)) as { id?: number; result?: Record<string, unknown>; error?: { message: string }; method?: string };
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id)!;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result ?? {});
    } else if (msg.method) {
      for (const wt of waiters.filter((x) => x.method === msg.method)) wt.resolve();
    }
  });
  const send = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      id += 1;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const once = (method: string) => new Promise<void>((resolve) => waiters.push({ method, resolve }));

  await send("Page.enable");
  await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });

  // The session cookie @supabase/ssr would write.
  const session = await sessionFor(email);
  const name = `sb-${new URL(supabaseUrl!).hostname.split(".")[0]}-auth-token`;
  const chunks = createChunks(name, `base64-${stringToBase64URL(JSON.stringify(session))}`);
  const host = new URL(baseUrl).hostname;
  for (const c of chunks) await send("Network.setCookie", { name: c.name, value: c.value, domain: host, path: "/" });

  for (const p of paths) {
    const loaded = once("Page.loadEventFired");
    await send("Page.navigate", { url: new URL(p, baseUrl).toString() });
    await loaded;
    await sleep(2500); // hydration and any client-side effects
    const metrics = (await send("Page.getLayoutMetrics")) as { cssContentSize: { width: number; height: number } };
    const full = Math.min(Math.ceil(metrics.cssContentSize.height), 6000);
    const shot = (await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height: Math.max(full, height), scale: 1 },
    })) as { data: string };
    const file = join(outDir, `${p.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/-+$/g, "") || "home"}-${width}.png`);
    writeFileSync(file, Buffer.from(shot.data, "base64"));
    console.log(file);
  }
  ws.close();
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => {
    chrome.kill();
    setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500);
  });
