//! Content-deduplicated backups, separate from saving. Last 10 per document.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::docs::{atomic_write, sha256_hex};

const KEEP: usize = 10;

fn backup_dir(app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let key = &sha256_hex(path.to_lowercase().as_bytes())[..16];
    let dir = base.join("backups").join(key);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    pub id: String,
    pub created_ms: u64,
    pub reason: String,
    pub size: u64,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Copies the file currently on disk. Name: `<ms>_<reason>_<sha16>.excalidraw`.
/// Identical content already backed up is skipped; a missing file is a no-op.
#[tauri::command]
pub fn backup_create(
    app: AppHandle,
    path: String,
    reason: String,
) -> Result<Option<String>, String> {
    let bytes = match fs::read(Path::new(&path)) {
        Ok(b) => b,
        Err(_) => return Ok(None),
    };
    let dir = backup_dir(&app, &path)?;
    let hash = sha256_hex(&bytes)[..16].to_string();
    let duplicate = fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .any(|e| e.file_name().to_string_lossy().contains(&hash));
    if duplicate {
        return Ok(None);
    }
    let reason: String = reason.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    let id = format!("{}_{}_{}.excalidraw", now_ms(), reason, hash);
    atomic_write(&dir.join(&id), &bytes)?;
    prune(&dir)?;
    Ok(Some(id))
}

fn prune(dir: &Path) -> Result<(), String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".excalidraw"))
        .collect();
    names.sort();
    while names.len() > KEEP {
        let _ = fs::remove_file(dir.join(names.remove(0)));
    }
    Ok(())
}

#[tauri::command]
pub fn backup_list(app: AppHandle, path: String) -> Result<Vec<BackupEntry>, String> {
    let dir = backup_dir(&app, &path)?;
    let mut out: Vec<BackupEntry> = fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter_map(|e| {
            let id = e.file_name().to_string_lossy().into_owned();
            let stem = id.strip_suffix(".excalidraw")?.to_string();
            let mut parts = stem.splitn(3, '_');
            let created_ms = parts.next()?.parse().ok()?;
            let reason = parts.next()?.to_string();
            Some(BackupEntry {
                size: e.metadata().map(|m| m.len()).unwrap_or(0),
                id,
                created_ms,
                reason,
            })
        })
        .collect();
    out.sort_by(|a, b| b.created_ms.cmp(&a.created_ms));
    Ok(out)
}

#[tauri::command]
pub fn backup_read(app: AppHandle, path: String, id: String) -> Result<String, String> {
    if id.contains(['/', '\\']) || id.contains("..") {
        return Err("invalid id".into());
    }
    fs::read_to_string(backup_dir(&app, &path)?.join(id)).map_err(|e| e.to_string())
}
