import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Copies the release runner into src-tauri/resources so tauri.conf.json
// can bundle it. Fails loudly if the runner was not built yet.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, "src-runner", "target", "release", "quest-runner.exe");
const target = join(root, "src-tauri", "resources", "quest-runner.exe");

if (!existsSync(source)) {
  console.error(
    `Runner not built: ${source} missing. Run "pnpm build:runner:win" first.`,
  );
  process.exit(1);
}

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log(`Copied runner -> ${target}`);
