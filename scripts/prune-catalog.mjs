// Prunes src/assets/gamelist.json down to what the app actually reads:
//   - only entries with at least one win32 executable (the rest can never run
//     on this Windows-only app; sanitize() would drop them at runtime anyway)
//   - only the fields the app reads: id, name, aliases, executables
// Run via `pnpm prune:catalog`. Safe to re-run on an already-pruned file.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const target = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "assets",
  "gamelist.json",
);

const entries = JSON.parse(readFileSync(target, "utf8"));
if (!Array.isArray(entries)) {
  console.error("gamelist.json is not an array — aborting");
  process.exit(1);
}

const before = Buffer.byteLength(JSON.stringify(entries));

const pruned = entries
  .filter(
    (entry) =>
      Array.isArray(entry?.executables) &&
      entry.executables.some((exe) => exe?.os === "win32" && typeof exe.name === "string"),
  )
  .map((entry) => ({
    id: entry.id,
    name: entry.name,
    aliases: Array.isArray(entry.aliases) ? entry.aliases : [],
    executables: entry.executables.filter((exe) => exe?.os === "win32"),
  }));

const out = JSON.stringify(pruned);
writeFileSync(target, out, "utf8");

console.log(
  `prune:catalog: ${entries.length} -> ${pruned.length} entries, ` +
    `${(before / 1024 / 1024).toFixed(1)} MB -> ${(Buffer.byteLength(out) / 1024 / 1024).toFixed(1)} MB`,
);
