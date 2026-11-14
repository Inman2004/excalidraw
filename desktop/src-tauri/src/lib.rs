mod backup;
mod docs;
mod session;
mod watch;

use std::path::PathBuf;

use tauri::{Emitter, Manager};

/// Every existing file argument, e.g. `.excalidraw` files opened with the app.
fn files_from_args(args: &[String]) -> Vec<String> {
    args.iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .map(PathBuf::from)
        .filter(|p| p.is_file())
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

#[tauri::command]
fn launch_files() -> Vec<String> {
    files_from_args(&std::env::args().collect::<Vec<_>>())
}

/// Data folder name used before the app was renamed to Paperimo.
const LEGACY_DATA_DIR: &str = "com.excalidraw.desktop.local";

fn copy_dir(from: &std::path::Path, to: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else if !target.exists() {
            std::fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

/// One-time carry-over of tabs, recovery snapshots, backups and preferences
/// from the pre-rename data folder. Copies (never moves, never overwrites),
/// and only while the new folder has no session of its own yet (plugins may
/// already have created the folder itself).
fn migrate_legacy_data(app: &tauri::AppHandle) {
    let Ok(new_dir) = app.path().app_data_dir() else {
        return;
    };
    if new_dir.join("session").exists() {
        return;
    }
    let Some(old_dir) = new_dir.parent().map(|p| p.join(LEGACY_DATA_DIR)) else {
        return;
    };
    if old_dir.is_dir() {
        if let Err(error) = copy_dir(&old_dir, &new_dir) {
            eprintln!("could not migrate data from {}: {error}", old_dir.display());
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            migrate_legacy_data(app.handle());
            Ok(())
        })
        // a second launch (double-clicking another file) is forwarded to this window
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            let files = files_from_args(&args);
            if !files.is_empty() {
                let _ = app.emit("open-files", files);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        // remembers window size, position and maximized state across restarts
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            launch_files,
            docs::doc_open,
            docs::doc_canonical,
            docs::doc_version,
            docs::doc_save,
            docs::doc_save_bytes,
            docs::doc_read_bytes,
            docs::doc_rename,
            docs::paths_exist,
            backup::backup_create,
            backup::backup_list,
            backup::backup_read,
            session::session_load,
            session::session_save,
            session::recovery_write,
            session::recovery_read,
            session::recovery_delete,
            session::recovery_list,
            session::meta_read,
            session::meta_write,
            watch::watch_set,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Paperimo");
}
