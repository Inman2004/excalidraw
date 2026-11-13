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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
        .expect("error while running Excalidraw desktop");
}
