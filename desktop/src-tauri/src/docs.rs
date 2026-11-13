//! Document I/O: canonical paths, disk versions and atomic writes.
//! Backups are deliberately NOT created here (see backup.rs).

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiskVersion {
    pub mtime_ns: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedDoc {
    pub canonical: String,
    pub text: String,
    pub version: DiskVersion,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SaveResult {
    Saved {
        canonical: String,
        version: DiskVersion,
    },
    Conflict {
        current: Option<DiskVersion>,
    },
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// Strip the `\\?\` prefix `fs::canonicalize` adds on Windows.
fn strip_verbatim(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{rest}"))
    } else if let Some(rest) = s.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        p
    }
}

pub fn canonical(path: &Path) -> Result<PathBuf, String> {
    Ok(strip_verbatim(
        fs::canonicalize(path).map_err(|e| e.to_string())?,
    ))
}

/// Canonicalise a path whose file may not exist yet (Save As target).
pub fn canonical_target(path: &Path) -> Result<PathBuf, String> {
    if path.exists() {
        return canonical(path);
    }
    let parent = path.parent().ok_or("path has no parent")?;
    let name = path.file_name().ok_or("path has no file name")?;
    Ok(canonical(parent)?.join(name))
}

pub fn disk_version(path: &Path) -> Result<Option<DiskVersion>, String> {
    let meta = match fs::metadata(path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    let mtime_ns = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_nanos().to_string())
        .unwrap_or_default();
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    Ok(Some(DiskVersion {
        mtime_ns,
        size: meta.len(),
        sha256: sha256_hex(&bytes),
    }))
}

/// Same bytes on disk? mtime precision differs between filesystems, so
/// size + hash decide.
pub fn same_version(a: &DiskVersion, b: &DiskVersion) -> bool {
    a.size == b.size && a.sha256 == b.sha256
}

/// temp file in the same directory -> fsync -> rename over the target.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let dir = path.parent().ok_or("path has no parent")?;
    let name = path.file_name().ok_or("no file name")?.to_string_lossy();
    let tmp = dir.join(format!(".{name}.tmp-{}", std::process::id()));
    {
        let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(bytes).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })
}

#[tauri::command]
pub fn doc_open(path: String) -> Result<OpenedDoc, String> {
    let canonical = canonical(Path::new(&path))?;
    let bytes = fs::read(&canonical).map_err(|e| e.to_string())?;
    let version = disk_version(&canonical)?.ok_or("file disappeared")?;
    let text = String::from_utf8(bytes).map_err(|_| "file is not UTF-8 text".to_string())?;
    Ok(OpenedDoc {
        canonical: canonical.to_string_lossy().into_owned(),
        text,
        version,
    })
}

#[tauri::command]
pub fn doc_canonical(path: String) -> Result<String, String> {
    Ok(canonical_target(Path::new(&path))?
        .to_string_lossy()
        .into_owned())
}

#[tauri::command]
pub fn doc_version(path: String) -> Result<Option<DiskVersion>, String> {
    disk_version(Path::new(&path))
}

/// `expected = None` succeeds only when the target does not exist yet.
/// `force = true` skips the comparison (the caller backs up first).
pub fn save_bytes_checked(
    path: &Path,
    bytes: &[u8],
    expected: Option<DiskVersion>,
    force: bool,
) -> Result<SaveResult, String> {
    let target = canonical_target(path)?;
    if !force {
        let current = disk_version(&target)?;
        let ok = match (&current, &expected) {
            (None, _) => true,
            (Some(cur), Some(exp)) => same_version(cur, exp),
            (Some(_), None) => false,
        };
        if !ok {
            return Ok(SaveResult::Conflict { current });
        }
    }
    atomic_write(&target, bytes)?;
    let version = disk_version(&target)?.ok_or("file vanished after write")?;
    crate::watch::note_own_write(&target, &version);
    Ok(SaveResult::Saved {
        canonical: target.to_string_lossy().into_owned(),
        version,
    })
}

#[tauri::command]
pub fn doc_save(
    path: String,
    text: String,
    expected: Option<DiskVersion>,
    force: bool,
) -> Result<SaveResult, String> {
    save_bytes_checked(Path::new(&path), text.as_bytes(), expected, force)
}

#[tauri::command]
pub fn doc_save_bytes(
    path: String,
    bytes: Vec<u8>,
    expected: Option<DiskVersion>,
    force: bool,
) -> Result<SaveResult, String> {
    save_bytes_checked(Path::new(&path), &bytes, expected, force)
}

#[tauri::command]
pub fn doc_read_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Rename on disk; never overwrites an existing file.
#[tauri::command]
pub fn doc_rename(from: String, to: String) -> Result<String, String> {
    let src = canonical(Path::new(&from))?;
    let dst = canonical_target(Path::new(&to))?;
    let same_file = dst.to_string_lossy().to_lowercase() == src.to_string_lossy().to_lowercase();
    if dst.exists() && !same_file {
        return Err("exists".into());
    }
    fs::rename(&src, &dst).map_err(|e| e.to_string())?;
    Ok(dst.to_string_lossy().into_owned())
}

/// Cheap existence check for recent-file lists (no hashing).
#[tauri::command]
pub fn paths_exist(paths: Vec<String>) -> Vec<bool> {
    paths.iter().map(|p| Path::new(p).is_file()).collect()
}
