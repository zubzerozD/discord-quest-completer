//! Core game lifecycle: path safety, dummy placement, and process tracking.
//!
//! Process tracking holds `std::process::Child` handles instead of raw PIDs:
//! a handle targets its exact instance (no PID-reuse hazard) and killing it
//! cannot touch unrelated processes that share the image name — the upstream
//! `taskkill /IM` bug is structurally impossible here.

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command};

/// Outcome of a play request, returned to the frontend.
#[derive(Debug, serde::Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum PlayOutcome {
    Started { pid: u32 },
    AlreadyRunning { pid: u32 },
}

/// Validates one path component supplied by the catalog (app id or executable
/// name). Rejects anything that could escape the games root.
pub fn validate_component(value: &str) -> Result<(), String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("empty path component".into());
    }
    if trimmed == "." || trimmed == ".." {
        return Err(format!("relative path component not allowed: {value:?}"));
    }
    if value.contains(['/', '\\', ':']) {
        return Err(format!("path separators not allowed in {value:?}"));
    }
    Ok(())
}

/// Validates an executable path from the catalog. May be a nested relative
/// path ("hackgu/hackgu.exe" is real data), but every component must be a
/// plain name so the path can never escape the game directory.
pub fn validate_executable(value: &str) -> Result<(), String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("empty path component".into());
    }
    if trimmed.contains(':') {
        return Err(format!("drive letters and streams not allowed in {value:?}"));
    }
    let path = Path::new(trimmed);
    if path.is_absolute() {
        return Err(format!("absolute path not allowed in {value:?}"));
    }
    for component in path.components() {
        match component {
            Component::Normal(_) => {}
            other => {
                return Err(format!("unsafe path component {other:?} in {value:?}"));
            }
        }
    }
    Ok(())
}

/// Builds `games/<app_id>` under the games root, validating `app_id`.
pub fn game_dir(games_root: &Path, app_id: &str) -> Result<PathBuf, String> {
    validate_component(app_id)?;
    Ok(games_root.join(app_id))
}

/// Creates `games/<app_id>/<executable>` by copying the runner template.
/// Always overwrites so an updated runner replaces older copies.
/// Returns the game directory.
pub fn prepare_game(
    games_root: &Path,
    app_id: &str,
    executable: &str,
    runner_src: &Path,
) -> Result<PathBuf, String> {
    let dir = game_dir(games_root, app_id)?;
    validate_executable(executable)?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    let target = dir.join(executable);
    // Nested executables ("sub/game.exe") need their parent directory.
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
    }
    std::fs::copy(runner_src, &target)
        .map_err(|e| format!("cannot copy runner to {}: {e}", target.display()))?;
    Ok(dir)
}

/// Where to look for the bundled runner, most specific first:
/// next to the executable (release bundle) and the working directory
/// (Tauri dev runs with `src-tauri/` as cwd).
pub fn runner_candidates(exe_dir: &Path, cwd: &Path) -> Vec<PathBuf> {
    vec![
        exe_dir.join("resources").join("quest-runner.exe"),
        cwd.join("resources").join("quest-runner.exe"),
    ]
}

/// Tracks running dummy games by app id.
pub struct RunningGames {
    entries: HashMap<String, Child>,
}

impl RunningGames {
    pub fn new() -> Self {
        Self {
            entries: HashMap::new(),
        }
    }

    /// Returns the pid when a live entry exists, pruning stale entries
    /// (child already exited) as a side effect.
    pub fn active_pid(&mut self, app_id: &str) -> Option<u32> {
        let stale = match self.entries.get_mut(app_id) {
            Some(child) => matches!(child.try_wait(), Ok(Some(_))),
            None => return None,
        };
        if stale {
            self.entries.remove(app_id);
            None
        } else {
            self.entries.get(app_id).map(|child| child.id())
        }
    }

    /// Ensures `games_root/<app_id>/<executable>` exists (copying the runner
    /// template when missing), then starts it, guarding against a duplicate
    /// spawn for the same app id. Preparing here keeps the "Play just works"
    /// contract in one place instead of relying on callers to pre-create.
    pub fn play(
        &mut self,
        app_id: &str,
        games_root: &Path,
        executable: &str,
        title: &str,
        runner_src: &Path,
    ) -> Result<PlayOutcome, String> {
        validate_executable(executable)?;
        if let Some(pid) = self.active_pid(app_id) {
            return Ok(PlayOutcome::AlreadyRunning { pid });
        }
        let dir = game_dir(games_root, app_id)?;
        let exe_path = dir.join(executable);
        if !exe_path.is_file() {
            prepare_game(games_root, app_id, executable, runner_src)?;
        }
        let child = Command::new(&exe_path)
            .args(["--title", title])
            .current_dir(&dir)
            .spawn()
            .map_err(|e| format!("cannot start {}: {e}", exe_path.display()))?;
        let pid = child.id();
        self.entries.insert(app_id.to_string(), child);
        Ok(PlayOutcome::Started { pid })
    }

    /// Stops the tracked instance for `app_id`.
    /// Ok(true) = killed now, Ok(false) = was not running.
    pub fn stop(&mut self, app_id: &str) -> Result<bool, String> {
        let Some(mut child) = self.entries.remove(app_id) else {
            return Ok(false);
        };
        // Kill by handle: terminates exactly this instance, so unrelated
        // processes sharing the image name are untouched.
        child.kill().map_err(|e| format!("cannot stop {app_id}: {e}"))?;
        let _ = child.wait();
        Ok(true)
    }

    /// Stops every tracked instance; returns how many were killed.
    /// Used on app exit so no dummy outlives the app.
    pub fn stop_all(&mut self) -> usize {
        let mut killed = 0;
        for (_, mut child) in self.entries.drain() {
            if child.kill().is_ok() {
                let _ = child.wait();
                killed += 1;
            }
        }
        killed
    }

    /// Snapshot of live entries for the UI.
    pub fn running_snapshot(&mut self) -> Vec<(String, u32)> {
        let app_ids: Vec<String> = self.entries.keys().cloned().collect();
        app_ids
            .into_iter()
            .filter_map(|app_id| self.active_pid(&app_id).map(|pid| (app_id, pid)))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    const EXE: &str = "fakegame.exe";

    fn temp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "dqc-test-{}-{}-{}",
            tag,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Builds the runner on demand so the suite works from a clean clone.
    fn runner_src() -> PathBuf {
        let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
        let exe = manifest.join("../src-runner/target/release/quest-runner.exe");
        if !exe.exists() {
            let status = Command::new("cargo")
                .args([
                    "build",
                    "--release",
                    "--manifest-path",
                    "../src-runner/Cargo.toml",
                ])
                .current_dir(manifest)
                .status()
                .expect("cargo must be on PATH to build the test runner");
            assert!(status.success(), "runner build failed");
        }
        exe
    }

    // --- validate_component ---

    #[test]
    fn rejects_empty_and_traversal_components() {
        for bad in ["", "  ", ".", "..", "a/b", "a\\b", "C:evil"] {
            assert!(
                validate_component(bad).is_err(),
                "expected rejection for {bad:?}"
            );
        }
    }

    #[test]
    fn accepts_real_catalog_values() {
        for good in ["356875221078245376", "overwatch.exe", "Call of Duty.exe"] {
            assert!(validate_component(good).is_ok(), "expected {good:?}");
        }
    }

    // --- validate_executable (nested paths are real catalog data) ---

    #[test]
    fn accepts_nested_executables_from_the_catalog() {
        // Real entries look like {"name": "hackgu/hackgu.exe"}: a relative
        // path inside the game dir, which must stay allowed.
        for good in ["game.exe", "hackgu/hackgu.exe", "sub/dir/Game.exe"] {
            assert!(
                validate_executable(good).is_ok(),
                "expected {good:?} to be accepted"
            );
        }
    }

    #[test]
    fn rejects_unsafe_executables() {
        for bad in [
            "",
            "..",
            "../evil.exe",
            "a/../../evil.exe",
            "/abs.exe",
            "C:\\evil.exe",
            "C:evil",
            ".\\game.exe",
        ] {
            assert!(
                validate_executable(bad).is_err(),
                "expected rejection for {bad:?}"
            );
        }
    }

    // --- game_dir / prepare_game ---

    #[test]
    fn game_dir_joins_valid_id() {
        let root = Path::new("C:/games-root");
        assert_eq!(
            game_dir(root, "1234").unwrap(),
            root.join("1234"),
            "plain join for valid id"
        );
        assert!(game_dir(root, "../evil").is_err(), "traversal rejected");
    }

    #[test]
    fn prepare_places_renamed_runner() {
        let root = temp_root("prep");
        let dir = prepare_game(&root, "42", EXE, &runner_src()).unwrap();
        let placed = dir.join(EXE);
        assert!(placed.is_file(), "runner copied to {placed:?}");
        assert_eq!(
            fs::read(&placed).unwrap(),
            fs::read(runner_src()).unwrap(),
            "placed bytes identical to runner template"
        );
        fs::remove_dir_all(&root).ok();
    }

    // --- runner_candidates ---

    #[test]
    fn runner_candidates_prefer_exe_dir_then_cwd() {
        let exe_dir = Path::new("C:/app");
        let cwd = Path::new("C:/app/src-tauri");
        let c = runner_candidates(exe_dir, cwd);
        assert_eq!(c[0], exe_dir.join("resources").join("quest-runner.exe"));
        assert_eq!(c[1], cwd.join("resources").join("quest-runner.exe"));
        assert_eq!(c.len(), 2, "exactly two candidates");
    }

    // --- play / stop lifecycle (real processes in temp dirs) ---

    #[test]
    fn play_prepares_the_dummy_when_missing() {
        // Contract test: play's docstring promises the dummy exists before
        // spawn, so calling play on a virgin games root must work without a
        // prior prepare_game() call (the frontend relies on this).
        let root = temp_root("autoshape");
        let mut games = RunningGames::new();
        match games
            .play("7", &root, EXE, "Auto Prepared", &runner_src())
            .unwrap()
        {
            PlayOutcome::Started { pid } => assert!(pid > 0),
            other => panic!("expected Started, got {other:?}"),
        }
        assert!(root.join("7").join(EXE).is_file(), "dummy was prepared");
        games.stop("7").ok();
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn play_prepares_nested_executables() {
        // The user-visible bug: catalog entries like "hackgu/hackgu.exe"
        // were rejected, so Play silently failed for those games.
        let root = temp_root("nested");
        let mut games = RunningGames::new();
        match games
            .play("n", &root, "sub/game.exe", "Nested", &runner_src())
            .unwrap()
        {
            PlayOutcome::Started { pid } => assert!(pid > 0),
            other => panic!("expected Started, got {other:?}"),
        }
        assert!(
            root.join("n").join("sub").join("game.exe").is_file(),
            "nested dummy prepared"
        );
        games.stop("n").ok();
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn play_starts_and_reports_pid() {
        let root = temp_root("play");
        let mut games = RunningGames::new();
        match games
            .play("1", &root, EXE, "Fake Game", &runner_src())
            .unwrap()
        {
            PlayOutcome::Started { pid } => assert!(pid > 0),
            other => panic!("expected Started, got {other:?}"),
        }
        assert!(games.active_pid("1").is_some(), "entry is live");
        assert_eq!(games.stop("1").unwrap(), true, "killed now");
        assert_eq!(games.active_pid("1"), None, "pruned after stop");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn double_play_does_not_spawn_duplicate() {
        let root = temp_root("dup");
        let mut games = RunningGames::new();
        let first = games
            .play("2", &root, EXE, "Fake Game", &runner_src())
            .unwrap();
        let PlayOutcome::Started { pid: first_pid } = first else {
            panic!("first play must start");
        };
        match games
            .play("2", &root, EXE, "Fake Game", &runner_src())
            .unwrap()
        {
            PlayOutcome::AlreadyRunning { pid } => {
                assert_eq!(pid, first_pid, "same instance reported")
            }
            other => panic!("expected AlreadyRunning, got {other:?}"),
        }
        games.stop("2").ok();
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn stop_leaves_same_name_sibling_untouched() {
        let root = temp_root("sibling");
        let mut games = RunningGames::new();
        games.play("a", &root, EXE, "Copy A", &runner_src()).unwrap();
        games.play("b", &root, EXE, "Copy B", &runner_src()).unwrap();

        assert_eq!(games.stop("a").unwrap(), true, "a killed");

        // b shares the image name; its handle must still be alive.
        let mut b = games.entries.remove("b").expect("b tracked");
        assert!(
            b.try_wait().unwrap().is_none(),
            "sibling with identical name must survive stopping a"
        );
        b.kill().ok();
        b.wait().ok();
        games.stop_all();
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn stale_entry_is_pruned_on_next_play() {
        let root = temp_root("stale");
        let mut games = RunningGames::new();
        games.play("3", &root, EXE, "Fake Game", &runner_src()).unwrap();
        let pid = games.active_pid("3").unwrap();

        // Kill externally (the child died without going through stop()).
        let status = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F"])
            .status()
            .unwrap();
        assert!(status.success());

        match games
            .play("3", &root, EXE, "Fake Game", &runner_src())
            .unwrap()
        {
            PlayOutcome::Started { pid: new_pid } => {
                assert_ne!(new_pid, pid, "stale entry replaced by a fresh spawn");
            }
            other => panic!("expected Started after stale prune, got {other:?}"),
        }
        games.stop("3").ok();
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn stop_all_kills_every_tracked_instance() {
        let root = temp_root("all");
        let mut games = RunningGames::new();
        games.play("x", &root, EXE, "X", &runner_src()).unwrap();
        games.play("y", &root, EXE, "Y", &runner_src()).unwrap();

        assert_eq!(games.stop_all(), 2, "both instances killed");
        assert!(games.entries.is_empty(), "map empty after stop_all");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn running_snapshot_reports_live_pids() {
        let root = temp_root("snap");
        let mut games = RunningGames::new();
        games.play("9", &root, EXE, "Fake Game", &runner_src()).unwrap();
        let snap = games.running_snapshot();
        assert_eq!(snap.len(), 1);
        assert_eq!(snap[0].0, "9");
        assert!(snap[0].1 > 0);
        games.stop("9").ok();
        fs::remove_dir_all(&root).ok();
    }
}
