//! Stable local media discovery. Symlinks, hidden files and partial uploads are ignored.
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
#[derive(Default, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub directories: Vec<PathBuf>,
}
pub fn files(dir: &Path, result: &mut Vec<PathBuf>, depth: usize) {
    if depth > 16 || dir.is_symlink() {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_symlink() {
            continue;
        }
        let path = entry.path();
        if kind.is_dir() {
            files(&path, result, depth + 1);
        } else if kind.is_file() {
            let ext = path
                .extension()
                .and_then(|x| x.to_str())
                .unwrap_or("")
                .to_lowercase();
            if [
                "m4a", "mp3", "wav", "mp4", "aac", "flac", "ogg", "webm", "mov", "mkv", "aiff",
                "caf", "opus", "wma", "m4v", "avi", "mpeg", "mpg", "ts",
            ]
            .contains(&ext.as_str())
            {
                result.push(path);
            }
        }
    }
}
pub fn signature(path: &Path) -> Option<String> {
    let m = path.metadata().ok()?;
    let t = m
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?;
    Some(format!("{}:{}:{}", m.len(), t.as_secs(), t.subsec_nanos()))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_directory_is_empty() {
        let mut out = vec![];
        files(Path::new("/not/a/tingo/directory"), &mut out, 0);
        assert!(out.is_empty());
    }
}
