//! Session file, recovery snapshots and small metadata files under AppData.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::docs::atomic_write;

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(dir.join("session").join("recovery")).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn recovery_file(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    valid_id(id)?;
    Ok(data_dir(app)?
        .join("session")
        .join("recovery")
        .join(format!("{id}.excalidraw")))
}

fn valid_id(id: &str) -> Result<(), String> {
    let ok = !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if ok {
        Ok(())
    } else {
        Err("invalid id".into())
    }
}

/// Moves a malformed file aside as `*.corrupt-<unix secs>`.
fn quarantine(path: &Path) {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut bad = path.as_os_str().to_owned();
    bad.push(format!(".corrupt-{ts}"));
    let _ = fs::rename(path, PathBuf::from(bad));
}

fn read_json(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(text) if serde_json::from_str::<serde_json::Value>(&text).is_ok() => Ok(Some(text)),
        Ok(_) => {
            quarantine(path);
            Err("corrupt".into())
        }
        Err(_) => Ok(None),
    }
}

#[tauri::command]
pub fn session_load(app: AppHandle) -> Result<Option<String>, String> {
    read_json(&data_dir(&app)?.join("session").join("session.json"))
}

#[tauri::command]
pub fn session_save(app: AppHandle, json: String) -> Result<(), String> {
    atomic_write(
        &data_dir(&app)?.join("session").join("session.json"),
        json.as_bytes(),
    )
}

#[tauri::command]
pub fn recovery_write(app: AppHandle, id: String, text: String) -> Result<(), String> {
    atomic_write(&recovery_file(&app, &id)?, text.as_bytes())
}

/// A corrupt snapshot is quarantined and reported as missing.
#[tauri::command]
pub fn recovery_read(app: AppHandle, id: String) -> Result<Option<String>, String> {
    Ok(read_json(&recovery_file(&app, &id)?).unwrap_or(None))
}

#[tauri::command]
pub fn recovery_delete(app: AppHandle, id: String) -> Result<(), String> {
    let _ = fs::remove_file(recovery_file(&app, &id)?);
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryEntry {
    pub id: String,
    pub modified_ms: u64,
    pub size: u64,
}

#[tauri::command]
pub fn recovery_list(app: AppHandle) -> Result<Vec<RecoveryEntry>, String> {
    let dir = data_dir(&app)?.join("session").join("recovery");
    Ok(fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let id = name.strip_suffix(".excalidraw")?.to_string();
            let meta = e.metadata().ok()?;
            let modified_ms = meta
                .modified()
                .ok()?
                .duration_since(UNIX_EPOCH)
                .ok()?
                .as_millis() as u64;
            Some(RecoveryEntry {
                id,
                modified_ms,
                size: meta.len(),
            })
        })
        .collect())
}

/// Small JSON files for app metadata: recents, prefs, library, frame order.
#[tauri::command]
pub fn meta_read(app: AppHandle, name: String) -> Result<Option<String>, String> {
    valid_id(&name)?;
    Ok(read_json(&data_dir(&app)?.join(format!("{name}.json"))).unwrap_or(None))
}

#[tauri::command]
pub fn meta_write(app: AppHandle, name: String, json: String) -> Result<(), String> {
    valid_id(&name)?;
    atomic_write(&data_dir(&app)?.join(format!("{name}.json")), json.as_bytes())
}
