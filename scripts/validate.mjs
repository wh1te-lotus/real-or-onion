// Offline validator for data/headlines.js. No dependencies, no network.
// Usage: node scripts/validate.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RUN_LENGTH = 20; // keep in sync with game.js
const here = dirname(fileURLToPath(import.meta.url));
const file = join(here, "..", "data", "headlines.js");

const errors = [];
const warnings = [];

// Evaluate the data file in a sandbox with a stub window.
const sandbox = { window: {} };
try {
  vm.runInNewContext(readFileSync(file, "utf8"), sandbox, { filename: file });
} catch (e) {
  console.error("Could not evaluate data/headlines.js: " + e.message);
  process.exit(1);
}
const list = sandbox.window.HEADLINES;
if (!Array.isArray(list)) {
  console.error("window.HEADLINES is missing or is not an array.");
  process.exit(1);
}

const isStr = (v) => typeof v === "string" && v.trim() !== "";
const ids = new Set();
const display = new Map();
let real = 0, onion = 0, modified = 0;

list.forEach((h, i) => {
  const tag = h && isStr(h.id) ? h.id : `#${i}`;
  const err = (msg) => errors.push(`${tag}: ${msg}`);
  if (!h || typeof h !== "object") return err("entry is not an object");

  if (!isStr(h.id)) err("missing or empty id");
  else if (ids.has(h.id)) err("duplicate id");
  else ids.add(h.id);

  if (h.type !== "real" && h.type !== "onion") err(`type must be "real" or "onion"`);
  else if (h.type === "real") real++;
  else onion++;

  if (!isStr(h.displayHeadline)) err("missing displayHeadline");
  else display.set(h.displayHeadline, (display.get(h.displayHeadline) || 0) + 1);

  if (!isStr(h.publisher)) err("missing publisher");

  if (!isStr(h.url)) err("missing url");
  else {
    try {
      const u = new URL(h.url);
      if (u.protocol !== "http:" && u.protocol !== "https:") err("url must be http(s)");
    } catch {
      err("url does not parse");
    }
  }

  if (h.type === "real") {
    if (!isStr(h.originalHeadline)) err("real entry missing originalHeadline");
    if (typeof h.wasModified !== "boolean") err("real entry needs boolean wasModified");
    if (isStr(h.originalHeadline) && isStr(h.displayHeadline) && typeof h.wasModified === "boolean") {
      const differs = h.displayHeadline !== h.originalHeadline;
      if (differs !== h.wasModified) {
        err(`wasModified is ${h.wasModified} but the two headlines ${differs ? "differ" : "match"}`);
      }
    }
    if (h.wasModified === true) modified++;
  }
});

const total = list.length;
if (total < RUN_LENGTH) warnings.push(`Pool has ${total} entries, fewer than RUN_LENGTH (${RUN_LENGTH}).`);
if (total > 0 && Math.abs(real - onion) > 0.3 * total) {
  warnings.push(`Real (${real}) and Onion (${onion}) counts differ by more than 30% of the pool.`);
}
for (const [text, n] of display) {
  if (n > 1) warnings.push(`Duplicate displayHeadline (${n}x): ${text}`);
}

console.log("Dataset summary");
console.log(`  total:         ${total}`);
console.log(`  real:          ${real}`);
console.log(`  onion:         ${onion}`);
console.log(`  modified real: ${modified}`);
console.log(`  errors:        ${errors.length}`);
console.log(`  warnings:      ${warnings.length}`);
errors.forEach((m) => console.log("  ERROR   " + m));
warnings.forEach((m) => console.log("  WARNING " + m));
process.exit(errors.length ? 1 : 0);
