import { describe, expect, it } from "vitest";
import bundledRaw from "../assets/gamelist.json?raw";
import { sanitize, win32Executables } from "./catalog";

/**
 * The bundled snapshot is the offline fallback, so it must be a sanitized
 * catalog in itself: no dead weight (entries this Windows app can never run)
 * and no fields the app does not read — it ships inside the JS bundle.
 */
describe("bundled snapshot", () => {
  const parsed: unknown = JSON.parse(bundledRaw);
  const games = sanitize(parsed);

  it("is a valid payload that survives sanitize", () => {
    expect(games).not.toBeNull();
  });

  it("contains only entries with a win32 executable", () => {
    const raw = parsed as { executables?: unknown }[];
    const dead = raw.filter(
      (entry) =>
        !Array.isArray(entry.executables) ||
        !entry.executables.some(
          (exe) =>
            typeof exe === "object" &&
            exe !== null &&
            (exe as { os?: unknown }).os === "win32",
        ),
    );
    expect(dead).toHaveLength(0);
  });

  it("carries only the fields the app reads (id, name, aliases, executables)", () => {
    const allowed = new Set(["id", "name", "aliases", "executables"]);
    for (const entry of parsed as Record<string, unknown>[]) {
      for (const key of Object.keys(entry)) {
        expect(allowed.has(key)).toBe(true);
      }
    }
  });

  it("stays under 6 MB so the bundle chunk stays reasonable", () => {
    expect(bundledRaw.length).toBeLessThan(6 * 1024 * 1024);
  });

  it("still resolves a known game with its executables", () => {
    const overwatch = games?.find((g) => g.name === "Overwatch");
    expect(overwatch).toBeDefined();
    expect(win32Executables(overwatch!).length).toBeGreaterThan(0);
  });
});
