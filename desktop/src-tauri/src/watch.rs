//! Watches the parent directories of open documents (atomic replace changes the
//! file's identity, so watching the file itself is unreliable) and emits
//! `doc-changed { path, kind }`, debounced, with our own writes suppressed.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::docs::{disk_version, same_version, DiskVersion};

#[derive(Default)]
struct State {
    watcher: Option<RecommendedWatcher>,
    /// lowercase canonical file path -> original path
    files: HashMap<String, String>,
    /// watched parent dir -> number of files in it
    dirs: HashMap<PathBuf, usize>,
    /// lowercase path -> version we wrote last
    own_writes: HashMap<String, DiskVersion>,
    /// lowercase paths with a pending debounced check
    pending: HashSet<String>,
}

fn state() -> &'static Mutex<State> {
    static STATE: OnceLock<Mutex<State>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(State::default()))
}

fn key(p: &Path) -> String {
    p.to_string_lossy().to_lowercase()
}

pub fn note_own_write(path: &Path, version: &DiskVersion) {
    if let Ok(mut s) = state().lock() {
        s.own_writes.insert(key(path), version.clone());
    }
}

#[derive(Serialize, Clone)]
struct DocChanged {
    path: String,
    kind: &'static str, // "modified" | "removed"
}

fn schedule_check(app: AppHandle, k: String) {
    {
        let mut s = state().lock().unwrap();
        if !s.pending.insert(k.clone()) {
            return; // already debouncing this file
        }
    }
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(300));
        let (path, own) = {
            let mut s = state().lock().unwrap();
            s.pending.remove(&k);
            match s.files.get(&k) {
                Some(p) => (p.clone(), s.own_writes.get(&k).cloned()),
                None => return,
            }
        };
        let current = disk_version(Path::new(&path)).ok().flatten();
        let event = match (&current, &own) {
            (None, _) => DocChanged { path, kind: "removed" },
            (Some(cur), Some(mine)) if same_version(cur, mine) => return, // our own save
            (Some(_), _) => DocChanged { path, kind: "modified" },
        };
        let _ = app.emit("doc-changed", event);
    });
}

fn ensure_watcher(app: &AppHandle, s: &mut State) -> Result<(), String> {
    if s.watcher.is_some() {
        return Ok(());
    }
    let app = app.clone();
    let watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
        let Ok(event) = res else { return };
        if matches!(event.kind, EventKind::Access(_)) {
            return;
        }
        // rename/replace arrives as several events: just re-check every path touched
        let keys: Vec<String> = {
            let s = state().lock().unwrap();
            event
                .paths
                .iter()
                .map(|p| key(p))
                .filter(|k| s.files.contains_key(k))
                .collect()
        };
        for k in keys {
            schedule_check(app.clone(), k);
        }
    })
    .map_err(|e| e.to_string())?;
    s.watcher = Some(watcher);
    Ok(())
}

/// Replace the watched set with `paths` (canonical document paths).
#[tauri::command]
pub fn watch_set(app: AppHandle, paths: Vec<String>) -> Result<(), String> {
    let mut s = state().lock().unwrap();
    ensure_watcher(&app, &mut s)?;

    let files: HashMap<String, String> = paths
        .iter()
        .map(|p| (key(Path::new(p)), p.clone()))
        .collect();
    let mut wanted: HashMap<PathBuf, usize> = HashMap::new();
    for p in files.values() {
        if let Some(dir) = Path::new(p).parent() {
            *wanted.entry(dir.to_path_buf()).or_default() += 1;
        }
    }

    let old_dirs: Vec<PathBuf> = s.dirs.keys().cloned().collect();
    let watcher = s.watcher.as_mut().unwrap();
    for dir in old_dirs.iter().filter(|d| !wanted.contains_key(*d)) {
        let _ = watcher.unwatch(dir);
    }
    for dir in wanted.keys() {
        // re-arm every time: a recreated directory needs a fresh watch
        let _ = watcher.unwatch(dir);
        let _ = watcher.watch(dir, RecursiveMode::NonRecursive);
    }
    s.own_writes.retain(|k, _| files.contains_key(k));
    s.files = files;
    s.dirs = wanted;
    Ok(())
}
