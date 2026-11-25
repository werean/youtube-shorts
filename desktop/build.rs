use std::env;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

fn should_skip_dir(name: &str) -> bool {
    matches!(name, "__pycache__" | ".pytest_cache" | ".venv" | ".git")
}

fn should_skip_file(name: &str) -> bool {
    name.ends_with(".pyc") || name.ends_with(".pyo")
}

fn collect_dir_entries(
    base_dir: &Path,
    current_dir: &Path,
    archive_prefix: &str,
    entries: &mut Vec<(String, PathBuf)>,
) -> Result<(), String> {
    println!("cargo:rerun-if-changed={}", current_dir.display());
    let mut read_entries = fs::read_dir(current_dir)
        .map_err(|e| format!("Failed reading {}: {e}", current_dir.display()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed iterating {}: {e}", current_dir.display()))?;
    read_entries.sort_by_key(|e| e.file_name());

    for entry in read_entries {
        let path = entry.path();
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy();
        let file_type = entry
            .file_type()
            .map_err(|e| format!("Failed inspecting {}: {e}", path.display()))?;

        if file_type.is_dir() {
            if should_skip_dir(&name) {
                continue;
            }
            collect_dir_entries(base_dir, &path, archive_prefix, entries)?;
        } else if file_type.is_file() {
            if should_skip_file(&name) {
                continue;
            }
            let rel = path
                .strip_prefix(base_dir)
                .map_err(|e| format!("Failed relativizing {}: {e}", path.display()))?;
            let rel_posix = rel
                .components()
                .map(|c| c.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/");
            let archive_path = format!("{archive_prefix}/{rel_posix}");
            println!("cargo:rerun-if-changed={}", path.display());
            entries.push((archive_path, path));
        }
    }

    Ok(())
}

fn build_embedded_runtime_zip() -> Result<(), String> {
    let manifest_dir = PathBuf::from(
        env::var("CARGO_MANIFEST_DIR").map_err(|e| format!("Missing CARGO_MANIFEST_DIR: {e}"))?,
    );
    let repo_root = manifest_dir
        .parent()
        .ok_or_else(|| "desktop/ has no parent repo root".to_string())?;
    let out_dir = PathBuf::from(env::var("OUT_DIR").map_err(|e| format!("Missing OUT_DIR: {e}"))?);

    let backend_app_dir = repo_root.join("backend").join("app");
    if !backend_app_dir.is_dir() {
        return Err(format!(
            "Missing backend/app directory at {}",
            backend_app_dir.display()
        ));
    }

    let pyproject_path = repo_root.join("backend").join("pyproject.toml");
    if !pyproject_path.is_file() {
        return Err(format!(
            "Missing backend/pyproject.toml at {}",
            pyproject_path.display()
        ));
    }

    let default_configs_path = repo_root.join("data").join("default_configs.json");
    if !default_configs_path.is_file() {
        return Err(format!(
            "Missing data/default_configs.json at {}",
            default_configs_path.display()
        ));
    }

    let mut entries: Vec<(String, PathBuf)> = Vec::new();
    collect_dir_entries(&backend_app_dir, &backend_app_dir, "backend/app", &mut entries)?;

    println!("cargo:rerun-if-changed={}", pyproject_path.display());
    entries.push(("backend/pyproject.toml".to_string(), pyproject_path));

    println!("cargo:rerun-if-changed={}", default_configs_path.display());
    entries.push(("data/default_configs.json".to_string(), default_configs_path));

    entries.sort_by(|a, b| a.0.cmp(&b.0));

    let zip_path = out_dir.join("embedded-runtime.zip");
    let zip_file = File::create(&zip_path)
        .map_err(|e| format!("Failed creating {}: {e}", zip_path.display()))?;
    let mut writer = ZipWriter::new(zip_file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    for (archive_path, src_path) in entries {
        let bytes =
            fs::read(&src_path).map_err(|e| format!("Failed reading {}: {e}", src_path.display()))?;
        writer
            .start_file(&archive_path, options)
            .map_err(|e| format!("Failed starting zip entry {archive_path}: {e}"))?;
        writer
            .write_all(&bytes)
            .map_err(|e| format!("Failed writing zip entry {archive_path}: {e}"))?;
    }

    writer
        .finish()
        .map_err(|e| format!("Failed finalizing {}: {e}", zip_path.display()))?;

    Ok(())
}

fn main() {
    if let Err(err) = build_embedded_runtime_zip() {
        panic!("build.rs failed to pack embedded runtime: {err}");
    }
    tauri_build::build();
}
