//! Typed wrappers over the Tauri commands exposed by src-tauri.
//! Tauri v2 maps camelCase JS args to snake_case Rust params automatically.
import { invoke } from "@tauri-apps/api/core";

export interface PlayOutcome {
  status: "started" | "already_running";
  pid: number;
}

export function ensureGame(appId: string, executable: string): Promise<string> {
  return invoke<string>("ensure_game", { appId, executable });
}

export function playGame(
  appId: string,
  executable: string,
  title: string,
): Promise<PlayOutcome> {
  return invoke<PlayOutcome>("play_game", { appId, executable, title });
}

export function stopGame(appId: string): Promise<boolean> {
  return invoke<boolean>("stop_game", { appId });
}

export function listRunning(): Promise<Array<[string, number]>> {
  return invoke<Array<[string, number]>>("list_running");
}

/** Removes stale game folders (running games' folders are kept). S6. */
export function cleanupGames(): Promise<string[]> {
  return invoke<string[]>("cleanup_games");
}
