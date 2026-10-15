/*
 * Lets a LOCAL script import the app's TypeScript modules (lib/hq/**) under plain Node, which
 * strips types natively but does not know the project's conventions:
 *   - "@/x"            -> <repo>/x  (the tsconfig path alias)
 *   - "./x", "../x"    -> x.ts / x.tsx / x/index.ts when written without an extension
 *   - "server-only"    -> an empty module (that package throws outside a React Server build;
 *                         these scripts are server-side by definition)
 *
 * Development tooling only: imported first by scripts/hq/mcp-tools-smoke.mts. Nothing in the app
 * imports it.
 */
import { registerHooks } from "node:module";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CANDIDATES = ["", ".ts", ".mts", "/index.ts"];

function probe(base: string): string | null {
  for (const suffix of CANDIDATES) {
    const p = base + suffix;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "data:text/javascript,export%20%7B%7D%3B", shortCircuit: true };
    let target: string | null = null;
    if (specifier.startsWith("@/")) {
      target = probe(path.join(root, specifier.slice(2)));
    } else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
      const parent = fileURLToPath(context.parentURL);
      if (!parent.includes(`${path.sep}node_modules${path.sep}`)) {
        const resolved = path.resolve(path.dirname(parent), specifier);
        target = /\.m?ts$/.test(specifier) ? (existsSync(resolved) ? resolved : null) : path.extname(specifier) ? null : probe(resolved);
      }
    }
    if (target && /\.(m?ts)$/.test(target)) return { url: pathToFileURL(target).href, format: "module-typescript", shortCircuit: true };
    if (target) return { url: pathToFileURL(target).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
