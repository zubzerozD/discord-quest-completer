import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const exeSource = join(root, "src-tauri", "target", "release", "discord-quest-completer.exe");
const runnerSource = join(root, "src-tauri", "resources", "quest-runner.exe");

if (!existsSync(exeSource)) {
  console.error(`Main binary missing: ${exeSource}. Build the Tauri app first.`);
  process.exit(1);
}
if (!existsSync(runnerSource)) {
  console.error(`Runner binary missing: ${runnerSource}. Build the runner first.`);
  process.exit(1);
}

const distDir = join(root, "dist-portable");
const portableDir = join(distDir, "Discord-Quest-Completer-Portable");
const zipOutput = join(distDir, "Discord-Quest-Completer-Portable.zip");

rmSync(distDir, { recursive: true, force: true });
mkdirSync(join(portableDir, "resources"), { recursive: true });

copyFileSync(exeSource, join(portableDir, "Discord Quest Completer.exe"));
copyFileSync(runnerSource, join(portableDir, "resources", "quest-runner.exe"));

writeFileSync(
  join(portableDir, "LEEME-PORTABLE.txt"),
  `Discord Quest Completer (Versión Portable)
=========================================

1. No requiere instalación en el sistema.
2. Haz doble clic en "Discord Quest Completer.exe" para iniciar la aplicación.
3. Si Windows SmartScreen muestra la pantalla azul ("Windows protegió su PC"):
   - Haz clic en "Más información".
   - Haz clic en "Ejecutar de todas formas".
`
);

try {
  execSync(`tar -a -c -f "${zipOutput}" -C "${distDir}" "Discord-Quest-Completer-Portable"`);
  console.log(`Portable ZIP created successfully at: ${zipOutput}`);
} catch (e) {
  console.error("Failed to create ZIP using tar:", e);
  process.exit(1);
}
