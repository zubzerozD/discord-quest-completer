pub mod games;

use games::{PlayOutcome, RunningGames};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

/// Resolves the runner template shipped as a Tauri resource (release) or
/// sitting under `src-tauri/resources/` (dev), plus the managed games root.
fn resolve_layout() -> Result<(PathBuf, PathBuf), String> {
    let exe_dir = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .ok_or("cannot resolve executable directory")?
        .to_path_buf();
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    let runner = games::runner_candidates(&exe_dir, &cwd)
        .into_iter()
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| "quest-runner.exe not found (did you run `pnpm runner:win`?)".to_string())?;
    Ok((runner, exe_dir.join("games")))
}

struct AppState {
    runner: PathBuf,
    games_root: PathBuf,
    running: Mutex<RunningGames>,
}

/// Prepares `games/<app_id>/<executable>` with a fresh runner copy.
#[tauri::command]
fn ensure_game(
    app_id: String,
    executable: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let dir = games::prepare_game(
        &state.games_root,
        &app_id,
        &executable,
        &state.runner,
    )?;
    Ok(dir.display().to_string())
}

/// Starts the dummy for a game unless it is already running.
/// `play` prepares the dummy itself when missing (single-call contract).
#[tauri::command]
fn play_game(
    app_id: String,
    executable: String,
    title: String,
    state: tauri::State<'_, AppState>,
) -> Result<PlayOutcome, String> {
    let mut running = state.running.lock().map_err(|e| e.to_string())?;
    running.play(
        &app_id,
        &state.games_root,
        &executable,
        &title,
        &state.runner,
    )
}

/// Stops only the instance this app started for `app_id`.
#[tauri::command]
fn stop_game(app_id: String, state: tauri::State<'_, AppState>) -> Result<bool, String> {
    let mut running = state.running.lock().map_err(|e| e.to_string())?;
    running.stop(&app_id)
}

/// Live dummies: `app_id -> pid`, for UI state after reload/focus.
#[tauri::command]
fn list_running(state: tauri::State<'_, AppState>) -> Result<Vec<(String, u32)>, String> {
    let mut running = state.running.lock().map_err(|e| e.to_string())?;
    Ok(running.running_snapshot())
}

/// Removes app folders whose dummy is not running (S6, on-demand path).
/// Returns the app ids removed; running games' folders are never touched.
#[tauri::command]
fn cleanup_games(state: tauri::State<'_, AppState>) -> Result<Vec<String>, String> {
    let mut running = state.running.lock().map_err(|e| e.to_string())?;
    Ok(running.cleanup_stale_dirs(&state.games_root))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let (runner, games_root) = resolve_layout()?;
            app.manage(AppState {
                runner,
                games_root,
                running: Mutex::new(RunningGames::new()),
            });
            // S6: startup cleanup — stale folders from previous sessions go,
            // running dummies' folders survive (none can run yet at startup,
            // but locked exes from a killed session are skipped by removal).
            if let Some(state) = app.try_state::<AppState>() {
                if let Ok(mut running) = state.running.lock() {
                    let removed = running.cleanup_stale_dirs(&state.games_root);
                    if !removed.is_empty() {
                        eprintln!("cleanup: removed {} stale game folder(s)", removed.len());
                    }
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // No dummy may outlive the app (upstream leaked them).
                if let Some(state) = window.app_handle().try_state::<AppState>() {
                    if let Ok(mut running) = state.running.lock() {
                        let killed = running.stop_all();
                        if killed > 0 {
                            eprintln!("stopped {killed} dummy game(s) on exit");
                        }
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            ensure_game,
            play_game,
            stop_game,
            list_running,
            cleanup_games
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
