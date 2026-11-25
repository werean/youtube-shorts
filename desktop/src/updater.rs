use reqwest::blocking::Client;
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;
use zip::ZipArchive;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub const DEFAULT_RELEASE_API_URL: &str =
    "https://api.github.com/repos/werean/youtube-shorts/releases/latest";
pub const USER_AGENT: &str = "youtube-shorts-desktop";
pub const PORTABLE_ZIP_ASSET_NAME: &str = "youtube-shorts-portable-win64.zip";
pub const MANIFEST_ASSET_NAME: &str = "portable-manifest.json";
pub const PORTABLE_EXE_NAME: &str = "youtube-shorts.exe";

pub const PRESERVED_RELATIVE_PATHS: &[&str] = &[
    "data/settings.json",
    "data/custom_settings.json",
    "data/saved_llm_prompts.json",
    "data/jobs",
    "data/profile",
    "backend/.venv",
];

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct GitHubAsset {
    pub name: String,
    pub browser_download_url: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct GitHubRelease {
    pub tag_name: String,
    #[serde(default)]
    pub assets: Vec<GitHubAsset>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct PortableManifest {
    pub version: String,
    #[serde(default)]
    pub asset_name: Option<String>,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UpdateOutcome {
    Disabled,
    UpToDate {
        current: Version,
        latest: Version,
    },
    NoPortableAsset {
        latest: Version,
    },
    RestartScheduled {
        version: Version,
        script_path: PathBuf,
    },
}

pub fn is_auto_update_disabled() -> bool {
    match std::env::var("YTS_DISABLE_AUTO_UPDATE") {
        Ok(val) => matches!(
            val.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes"
        ),
        Err(_) => false,
    }
}

pub fn resolve_update_api_url() -> String {
    match std::env::var("YTS_UPDATE_API_URL") {
        Ok(val) if !val.trim().is_empty() => val.trim().to_string(),
        _ => DEFAULT_RELEASE_API_URL.to_string(),
    }
}

pub fn parse_release_version(tag_name: &str) -> Result<Version, String> {
    let trimmed = tag_name.trim();
    let stripped = trimmed
        .strip_prefix('v')
        .or_else(|| trimmed.strip_prefix('V'))
        .unwrap_or(trimmed);
    Version::parse(stripped)
        .map_err(|e| format!("Invalid release tag semver '{tag_name}': {e}"))
}

pub fn is_newer_version(
    current_version: &str,
    latest_tag: &str,
) -> Result<Option<(Version, Version)>, String> {
    let current = parse_release_version(current_version)?;
    let latest = parse_release_version(latest_tag)?;
    if latest > current {
        Ok(Some((current, latest)))
    } else {
        Ok(None)
    }
}

pub fn parse_github_release(json_str: &str) -> Result<GitHubRelease, String> {
    serde_json::from_str::<GitHubRelease>(json_str)
        .map_err(|e| format!("Failed to parse GitHub release JSON: {e}"))
}

pub fn parse_portable_manifest(json_str: &str) -> Result<PortableManifest, String> {
    serde_json::from_str::<PortableManifest>(json_str)
        .map_err(|e| format!("Failed to parse portable-manifest.json: {e}"))
}

pub fn find_release_assets(
    release: &GitHubRelease,
) -> (Option<&GitHubAsset>, Option<&GitHubAsset>) {
    let zip_asset = release
        .assets
        .iter()
        .find(|a| a.name == PORTABLE_ZIP_ASSET_NAME);
    let manifest_asset = release
        .assets
        .iter()
        .find(|a| a.name == MANIFEST_ASSET_NAME);
    (zip_asset, manifest_asset)
}

pub fn compute_sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

pub fn verify_sha256(bytes: &[u8], expected_hex: &str) -> Result<(), String> {
    let expected = expected_hex.trim().to_ascii_lowercase();
    let actual = compute_sha256_hex(bytes);
    if actual == expected {
        Ok(())
    } else {
        Err(format!(
            "SHA-256 verification failed: expected {expected}, got {actual}"
        ))
    }
}

pub fn extract_zip_bytes(zip_bytes: &[u8], dest_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dest_dir)
        .map_err(|e| format!("Failed to create staging directory {}: {e}", dest_dir.display()))?;

    let cursor = Cursor::new(zip_bytes);
    let mut archive =
        ZipArchive::new(cursor).map_err(|e| format!("Invalid portable zip archive: {e}"))?;

    for idx in 0..archive.len() {
        let mut entry = archive
            .by_index(idx)
            .map_err(|e| format!("Failed reading zip entry #{idx}: {e}"))?;

        let enclosed = entry
            .enclosed_name()
            .ok_or_else(|| format!("Unsafe path in zip entry: {}", entry.name()))?
            .to_path_buf();

        let out_path = dest_dir.join(&enclosed);
        if entry.is_dir() {
            fs::create_dir_all(&out_path).map_err(|e| {
                format!("Failed creating directory {}: {e}", out_path.display())
            })?;
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent).map_err(|e| {
                    format!("Failed creating parent directory {}: {e}", parent.display())
                })?;
            }
            let mut out_file = fs::File::create(&out_path)
                .map_err(|e| format!("Failed creating file {}: {e}", out_path.display()))?;
            std::io::copy(&mut entry, &mut out_file)
                .map_err(|e| format!("Failed extracting {}: {e}", out_path.display()))?;
        }
    }

    Ok(())
}

pub fn locate_payload_root(staging_dir: &Path) -> PathBuf {
    if staging_dir.join(PORTABLE_EXE_NAME).is_file()
        || staging_dir.join("backend").join("app").is_dir()
    {
        return staging_dir.to_path_buf();
    }

    if let Ok(entries) = fs::read_dir(staging_dir) {
        let dirs: Vec<PathBuf> = entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.is_dir())
            .collect();
        if dirs.len() == 1 {
            let candidate = &dirs[0];
            if candidate.join(PORTABLE_EXE_NAME).is_file()
                || candidate.join("backend").join("app").is_dir()
            {
                return candidate.clone();
            }
        }
    }

    staging_dir.to_path_buf()
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst)
        .map_err(|e| format!("Failed creating directory {}: {e}", dst.display()))?;
    for entry in fs::read_dir(src)
        .map_err(|e| format!("Failed reading directory {}: {e}", src.display()))?
    {
        let entry = entry.map_err(|e| format!("Failed reading directory entry: {e}"))?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path).map_err(|e| {
                format!(
                    "Failed copying {} -> {}: {e}",
                    src_path.display(),
                    dst_path.display()
                )
            })?;
        }
    }
    Ok(())
}

/// Applies a staged update directly into `portable_root` while strictly preserving
/// user state (`data/settings.json`, `data/custom_settings.json`,
/// `data/saved_llm_prompts.json`, `data/jobs/`, `data/profile/`, `backend/.venv/`).
pub fn apply_staged_update_preserving_user_data(
    payload_root: &Path,
    portable_root: &Path,
    target_exe_name: &str,
) -> Result<(), String> {
    let staged_exe = if payload_root.join(PORTABLE_EXE_NAME).is_file() {
        Some(payload_root.join(PORTABLE_EXE_NAME))
    } else if payload_root.join(target_exe_name).is_file() {
        Some(payload_root.join(target_exe_name))
    } else {
        None
    };

    if let Some(src_exe) = staged_exe {
        fs::create_dir_all(portable_root)
            .map_err(|e| format!("Failed creating {}: {e}", portable_root.display()))?;
        fs::copy(&src_exe, portable_root.join(target_exe_name))
            .map_err(|e| format!("Failed updating executable: {e}"))?;
    }

    let staged_backend_app = payload_root.join("backend").join("app");
    if staged_backend_app.is_dir() {
        let target_backend_app = portable_root.join("backend").join("app");
        if target_backend_app.exists() {
            fs::remove_dir_all(&target_backend_app)
                .map_err(|e| format!("Failed replacing backend/app: {e}"))?;
        }
        copy_dir_recursive(&staged_backend_app, &target_backend_app)?;
    }

    let staged_pyproject = payload_root.join("backend").join("pyproject.toml");
    if staged_pyproject.is_file() {
        let target_backend = portable_root.join("backend");
        fs::create_dir_all(&target_backend)
            .map_err(|e| format!("Failed creating backend dir: {e}"))?;
        fs::copy(&staged_pyproject, target_backend.join("pyproject.toml"))
            .map_err(|e| format!("Failed updating backend/pyproject.toml: {e}"))?;
    }

    let staged_default_configs = payload_root.join("data").join("default_configs.json");
    if staged_default_configs.is_file() {
        let target_data = portable_root.join("data");
        fs::create_dir_all(&target_data)
            .map_err(|e| format!("Failed creating data dir: {e}"))?;
        fs::copy(&staged_default_configs, target_data.join("default_configs.json"))
            .map_err(|e| format!("Failed updating data/default_configs.json: {e}"))?;
    }

    let staged_readme = payload_root.join("README-PORTABLE.txt");
    if staged_readme.is_file() {
        fs::copy(&staged_readme, portable_root.join("README-PORTABLE.txt"))
            .map_err(|e| format!("Failed updating README-PORTABLE.txt: {e}"))?;
    }

    Ok(())
}

pub fn build_update_and_relaunch_cmd(
    pid: u32,
    backend_pid: Option<u32>,
    payload_root: &Path,
    staging_dir: &Path,
    portable_root: &Path,
    exe_name: &str,
) -> String {
    let payload = payload_root.to_string_lossy();
    let staging = staging_dir.to_string_lossy();
    let root = portable_root.to_string_lossy();

    let stop_backend_line = match backend_pid {
        Some(bpid) => format!(
            "taskkill /PID {bpid} /T /F >nul 2>&1\r\n"
        ),
        None => String::new(),
    };

    format!(
        "@echo off\r\n\
         setlocal enableextensions\r\n\
         set \"APP_PID={pid}\"\r\n\
         set \"PAYLOAD_DIR={payload}\"\r\n\
         set \"STAGING_DIR={staging}\"\r\n\
         set \"PORTABLE_DIR={root}\"\r\n\
         set \"TARGET_EXE={exe_name}\"\r\n\
         \r\n\
         REM Wait for desktop process %APP_PID% to exit (up to 30s)\r\n\
         set /a RETRIES=0\r\n\
         :wait_loop\r\n\
         tasklist /FI \"PID eq %APP_PID%\" 2>nul | find \"%APP_PID%\" >nul\r\n\
         if not errorlevel 1 (\r\n\
           set /a RETRIES+=1\r\n\
           if %RETRIES% LSS 30 (\r\n\
             ping -n 2 127.0.0.1 >nul\r\n\
             goto wait_loop\r\n\
           )\r\n\
         )\r\n\
         {stop_backend_line}\
         \r\n\
         REM Preserved user paths (NEVER deleted or overwritten):\r\n\
         REM   data\\settings.json, data\\custom_settings.json, data\\saved_llm_prompts.json,\r\n\
         REM   data\\jobs\\, data\\profile\\, backend\\.venv\\\r\n\
         \r\n\
         if exist \"%PAYLOAD_DIR%\\youtube-shorts.exe\" (\r\n\
           copy /Y \"%PAYLOAD_DIR%\\youtube-shorts.exe\" \"%PORTABLE_DIR%\\%TARGET_EXE%\" >nul\r\n\
         )\r\n\
         if exist \"%PAYLOAD_DIR%\\backend\\app\" (\r\n\
           if exist \"%PORTABLE_DIR%\\backend\\app\" (\r\n\
             rmdir /S /Q \"%PORTABLE_DIR%\\backend\\app\"\r\n\
           )\r\n\
           if not exist \"%PORTABLE_DIR%\\backend\\app\" mkdir \"%PORTABLE_DIR%\\backend\\app\"\r\n\
           xcopy /E /I /Y /Q \"%PAYLOAD_DIR%\\backend\\app\" \"%PORTABLE_DIR%\\backend\\app\" >nul\r\n\
         )\r\n\
         if exist \"%PAYLOAD_DIR%\\backend\\pyproject.toml\" (\r\n\
           if not exist \"%PORTABLE_DIR%\\backend\" mkdir \"%PORTABLE_DIR%\\backend\"\r\n\
           copy /Y \"%PAYLOAD_DIR%\\backend\\pyproject.toml\" \"%PORTABLE_DIR%\\backend\\pyproject.toml\" >nul\r\n\
         )\r\n\
         if exist \"%PAYLOAD_DIR%\\data\\default_configs.json\" (\r\n\
           if not exist \"%PORTABLE_DIR%\\data\" mkdir \"%PORTABLE_DIR%\\data\"\r\n\
           copy /Y \"%PAYLOAD_DIR%\\data\\default_configs.json\" \"%PORTABLE_DIR%\\data\\default_configs.json\" >nul\r\n\
         )\r\n\
         if exist \"%PAYLOAD_DIR%\\README-PORTABLE.txt\" (\r\n\
           copy /Y \"%PAYLOAD_DIR%\\README-PORTABLE.txt\" \"%PORTABLE_DIR%\\README-PORTABLE.txt\" >nul\r\n\
         )\r\n\
         \r\n\
         if exist \"%STAGING_DIR%\" rmdir /S /Q \"%STAGING_DIR%\"\r\n\
         start \"\" \"%PORTABLE_DIR%\\%TARGET_EXE%\"\r\n\
         (goto) 2>nul & del \"%~f0\"\r\n"
    )
}

fn build_http_client(timeout: Duration) -> Result<Client, String> {
    Client::builder()
        .user_agent(USER_AGENT)
        .timeout(timeout)
        .build()
        .map_err(|e| format!("Failed creating HTTP client: {e}"))
}

fn download_bytes(client: &Client, url: &str) -> Result<Vec<u8>, String> {
    let mut resp = client
        .get(url)
        .header("Accept", "application/octet-stream")
        .send()
        .map_err(|e| format!("Failed downloading {url}: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!(
            "HTTP {} while downloading {url}",
            resp.status().as_u16()
        ));
    }
    let mut buf = Vec::new();
    resp.read_to_end(&mut buf)
        .map_err(|e| format!("Failed reading response body from {url}: {e}"))?;
    Ok(buf)
}

pub fn prepare_update_in_staging(
    api_url: &str,
    current_version: &str,
    staging_root: &Path,
) -> Result<Option<(Version, PathBuf, PathBuf)>, String> {
    let client = build_http_client(Duration::from_secs(15))?;
    let release_resp = client
        .get(api_url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .map_err(|e| format!("Failed fetching release metadata from {api_url}: {e}"))?;
    if !release_resp.status().is_success() {
        return Err(format!(
            "Release API returned HTTP {} from {api_url}",
            release_resp.status().as_u16()
        ));
    }
    let release_text = release_resp
        .text()
        .map_err(|e| format!("Failed reading release JSON: {e}"))?;
    let release = parse_github_release(&release_text)?;

    let Some((_current, latest)) = is_newer_version(current_version, &release.tag_name)? else {
        return Ok(None);
    };

    let (zip_asset, manifest_asset) = find_release_assets(&release);
    let Some(zip_asset) = zip_asset else {
        return Err(format!(
            "Release {} is missing asset {}",
            release.tag_name, PORTABLE_ZIP_ASSET_NAME
        ));
    };

    let expected_sha = if let Some(manifest) = manifest_asset {
        let manifest_resp = client
            .get(&manifest.browser_download_url)
            .send()
            .map_err(|e| format!("Failed downloading {MANIFEST_ASSET_NAME}: {e}"))?;
        if !manifest_resp.status().is_success() {
            return Err(format!(
                "HTTP {} downloading {MANIFEST_ASSET_NAME}",
                manifest_resp.status().as_u16()
            ));
        }
        let manifest_text = manifest_resp
            .text()
            .map_err(|e| format!("Failed reading {MANIFEST_ASSET_NAME}: {e}"))?;
        let parsed = parse_portable_manifest(&manifest_text)?;
        Some(parsed.sha256)
    } else {
        None
    };

    let download_client = build_http_client(Duration::from_secs(120))?;
    let zip_bytes = download_bytes(&download_client, &zip_asset.browser_download_url)?;

    if let Some(ref sha) = expected_sha {
        verify_sha256(&zip_bytes, sha)?;
    }

    if staging_root.exists() {
        let _ = fs::remove_dir_all(staging_root);
    }
    extract_zip_bytes(&zip_bytes, staging_root)?;
    let payload_root = locate_payload_root(staging_root);

    Ok(Some((latest, staging_root.to_path_buf(), payload_root)))
}

pub fn check_and_apply_startup_update(
    portable_root: &Path,
    backend_pid: Option<u32>,
) -> Result<UpdateOutcome, String> {
    if is_auto_update_disabled() {
        return Ok(UpdateOutcome::Disabled);
    }

    let api_url = resolve_update_api_url();
    let current_version = env!("CARGO_PKG_VERSION");

    let client = build_http_client(Duration::from_secs(5))?;
    let release_resp = client
        .get(&api_url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .map_err(|e| format!("Update check request failed: {e}"))?;
    if !release_resp.status().is_success() {
        return Err(format!(
            "Update check returned HTTP {}",
            release_resp.status().as_u16()
        ));
    }
    let release_text = release_resp
        .text()
        .map_err(|e| format!("Failed reading update release JSON: {e}"))?;
    let release = parse_github_release(&release_text)?;

    let current = parse_release_version(current_version)?;
    let latest = parse_release_version(&release.tag_name)?;
    if latest <= current {
        return Ok(UpdateOutcome::UpToDate { current, latest });
    }

    let (zip_asset, _manifest_asset) = find_release_assets(&release);
    if zip_asset.is_none() {
        return Ok(UpdateOutcome::NoPortableAsset { latest });
    }

    let staging_dir = std::env::temp_dir().join(format!(
        "youtube-shorts-update-{}-{}",
        latest,
        std::process::id()
    ));

    let Some((version, staging_root, payload_root)) =
        prepare_update_in_staging(&api_url, current_version, &staging_dir)?
    else {
        return Ok(UpdateOutcome::UpToDate { current, latest });
    };

    let exe_name = std::env::current_exe()
        .ok()
        .and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_string()))
        .unwrap_or_else(|| PORTABLE_EXE_NAME.to_string());

    let script_path = std::env::temp_dir().join("update-and-relaunch.cmd");
    let script_content = build_update_and_relaunch_cmd(
        std::process::id(),
        backend_pid,
        &payload_root,
        &staging_root,
        portable_root,
        &exe_name,
    );
    fs::write(&script_path, script_content)
        .map_err(|e| format!("Failed writing update script {}: {e}", script_path.display()))?;

    #[cfg(windows)]
    {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C"])
            .arg(&script_path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW);
        cmd.spawn()
            .map_err(|e| format!("Failed spawning update script: {e}"))?;
    }

    Ok(UpdateOutcome::RestartScheduled {
        version,
        script_path,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::net::TcpListener;
    use tempfile::TempDir;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    fn build_test_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut cursor = Cursor::new(Vec::new());
        {
            let mut zip = ZipWriter::new(&mut cursor);
            let options = SimpleFileOptions::default();
            for (path, content) in entries {
                zip.start_file(path, options).unwrap();
                zip.write_all(content).unwrap();
            }
            zip.finish().unwrap();
        }
        cursor.into_inner()
    }

    #[test]
    fn test_parse_release_version_and_semver_comparison() {
        assert_eq!(parse_release_version("v0.1.2").unwrap(), Version::new(0, 1, 2));
        assert_eq!(parse_release_version("V1.2.3").unwrap(), Version::new(1, 2, 3));
        assert_eq!(parse_release_version(" 0.1.0 ").unwrap(), Version::new(0, 1, 0));
        assert!(parse_release_version("not-a-semver").is_err());

        assert!(is_newer_version("0.1.0", "v0.1.1").unwrap().is_some());
        assert!(is_newer_version("0.1.0", "0.1.0").unwrap().is_none());
        assert!(is_newer_version("0.2.0", "v0.1.9").unwrap().is_none());
    }

    #[test]
    fn test_parse_github_release_and_find_assets() {
        let json = r#"{
            "tag_name": "v0.1.5",
            "assets": [
                {
                    "name": "portable-manifest.json",
                    "browser_download_url": "https://example.invalid/portable-manifest.json"
                },
                {
                    "name": "youtube-shorts-portable-win64.zip",
                    "browser_download_url": "https://example.invalid/youtube-shorts-portable-win64.zip"
                }
            ]
        }"#;

        let release = parse_github_release(json).unwrap();
        assert_eq!(release.tag_name, "v0.1.5");
        let (zip_asset, manifest_asset) = find_release_assets(&release);
        assert_eq!(zip_asset.unwrap().name, PORTABLE_ZIP_ASSET_NAME);
        assert_eq!(manifest_asset.unwrap().name, MANIFEST_ASSET_NAME);
    }

    #[test]
    fn test_sha256_verification_pass_and_fail() {
        let payload = b"youtube-shorts-portable-binary-content";
        let digest = compute_sha256_hex(payload);
        assert_eq!(digest.len(), 64);
        assert!(verify_sha256(payload, &digest.to_uppercase()).is_ok());
        assert!(verify_sha256(payload, &"0".repeat(64)).is_err());
    }

    #[test]
    fn test_extract_zip_and_locate_payload_root() {
        let zip_bytes = build_test_zip(&[
            ("youtube-shorts.exe", b"new-exe"),
            ("backend/app/main.py", b"print('v2')"),
            ("backend/pyproject.toml", b"version='2.0.0'"),
            ("data/default_configs.json", b"{\"v\":2}"),
        ]);

        let staging = TempDir::new().unwrap();
        extract_zip_bytes(&zip_bytes, staging.path()).unwrap();

        let payload_root = locate_payload_root(staging.path());
        assert_eq!(payload_root, staging.path());
        assert_eq!(
            fs::read(payload_root.join("youtube-shorts.exe")).unwrap(),
            b"new-exe"
        );
        assert_eq!(
            fs::read(payload_root.join("backend/app/main.py")).unwrap(),
            b"print('v2')"
        );

        // Nested single wrapper directory layout also resolves cleanly
        let nested_zip = build_test_zip(&[
            ("youtube-shorts-portable/youtube-shorts.exe", b"nested-exe"),
            ("youtube-shorts-portable/backend/app/main.py", b"print('nested')"),
        ]);
        let staging2 = TempDir::new().unwrap();
        extract_zip_bytes(&nested_zip, staging2.path()).unwrap();
        let payload_root2 = locate_payload_root(staging2.path());
        assert_eq!(payload_root2, staging2.path().join("youtube-shorts-portable"));
    }

    #[test]
    fn test_apply_staged_update_preserves_user_data_and_venv() {
        let portable = TempDir::new().unwrap();
        let root = portable.path();

        // Existing install with user files and .venv
        fs::create_dir_all(root.join("backend/app/old_module")).unwrap();
        fs::create_dir_all(root.join("backend/.venv/Scripts")).unwrap();
        fs::create_dir_all(root.join("data/jobs/job_1")).unwrap();
        fs::create_dir_all(root.join("data/profile/marca-dagua")).unwrap();

        fs::write(root.join("youtube-shorts.exe"), b"old-exe").unwrap();
        fs::write(root.join("backend/app/main.py"), b"old-main").unwrap();
        fs::write(root.join("backend/app/old_module/obsolete.py"), b"obsolete").unwrap();
        fs::write(root.join("backend/pyproject.toml"), b"old-pyproject").unwrap();
        fs::write(root.join("backend/.venv/Scripts/python.exe"), b"user-venv-python").unwrap();
        fs::write(root.join("data/default_configs.json"), b"{\"old\":true}").unwrap();
        fs::write(root.join("data/settings.json"), b"{\"base_dir\":\"D:/Videos\"}").unwrap();
        fs::write(root.join("data/custom_settings.json"), b"{\"custom\":1}").unwrap();
        fs::write(root.join("data/saved_llm_prompts.json"), b"[{\"name\":\"p1\"}]").unwrap();
        fs::write(root.join("data/jobs/job_1/job.json"), b"{\"id\":\"job_1\"}").unwrap();
        fs::write(root.join("data/profile/marca-dagua/watermark.png"), b"pngdata").unwrap();

        // Staged update payload
        let staging = TempDir::new().unwrap();
        let stage = staging.path();
        fs::create_dir_all(stage.join("backend/app")).unwrap();
        fs::create_dir_all(stage.join("data")).unwrap();
        fs::write(stage.join("youtube-shorts.exe"), b"new-exe").unwrap();
        fs::write(stage.join("backend/app/main.py"), b"new-main").unwrap();
        fs::write(stage.join("backend/pyproject.toml"), b"new-pyproject").unwrap();
        fs::write(stage.join("data/default_configs.json"), b"{\"new\":true}").unwrap();
        // Even if a release zip accidentally contained settings.json, it must NOT overwrite
        fs::write(stage.join("data/settings.json"), b"{\"overwrite\":true}").unwrap();

        apply_staged_update_preserving_user_data(stage, root, "youtube-shorts.exe").unwrap();

        // Updated files
        assert_eq!(fs::read(root.join("youtube-shorts.exe")).unwrap(), b"new-exe");
        assert_eq!(fs::read(root.join("backend/app/main.py")).unwrap(), b"new-main");
        assert!(!root.join("backend/app/old_module/obsolete.py").exists());
        assert_eq!(fs::read(root.join("backend/pyproject.toml")).unwrap(), b"new-pyproject");
        assert_eq!(
            fs::read(root.join("data/default_configs.json")).unwrap(),
            b"{\"new\":true}"
        );

        // Preserved files & folders
        assert_eq!(
            fs::read(root.join("backend/.venv/Scripts/python.exe")).unwrap(),
            b"user-venv-python"
        );
        assert_eq!(
            fs::read(root.join("data/settings.json")).unwrap(),
            b"{\"base_dir\":\"D:/Videos\"}"
        );
        assert_eq!(
            fs::read(root.join("data/custom_settings.json")).unwrap(),
            b"{\"custom\":1}"
        );
        assert_eq!(
            fs::read(root.join("data/saved_llm_prompts.json")).unwrap(),
            b"[{\"name\":\"p1\"}]"
        );
        assert_eq!(
            fs::read(root.join("data/jobs/job_1/job.json")).unwrap(),
            b"{\"id\":\"job_1\"}"
        );
        assert_eq!(
            fs::read(root.join("data/profile/marca-dagua/watermark.png")).unwrap(),
            b"pngdata"
        );
    }

    #[test]
    fn test_build_update_and_relaunch_cmd_layout() {
        let cmd = build_update_and_relaunch_cmd(
            4242,
            Some(9999),
            Path::new("C:\\temp\\staging"),
            Path::new("C:\\temp\\staging"),
            Path::new("C:\\Apps\\YouTubeShorts"),
            "youtube-shorts.exe",
        );

        assert!(cmd.contains("APP_PID=4242"));
        assert!(cmd.contains("taskkill /PID 9999 /T /F"));
        assert!(cmd.contains("youtube-shorts.exe"));
        assert!(cmd.contains("backend\\app"));
        assert!(cmd.contains("backend\\pyproject.toml"));
        assert!(cmd.contains("data\\default_configs.json"));
        assert!(cmd.contains("start \"\" \"%PORTABLE_DIR%\\%TARGET_EXE%\""));
        assert!(!cmd.contains("rmdir /S /Q \"%PORTABLE_DIR%\\data\""));
        assert!(!cmd.contains("rmdir /S /Q \"%PORTABLE_DIR%\\backend\\.venv\""));
    }

    #[test]
    fn test_end_to_end_prepare_update_with_mock_http_server() {
        let zip_bytes = build_test_zip(&[
            ("youtube-shorts.exe", b"v0.2.0-exe"),
            ("backend/app/main.py", b"v0.2.0-main"),
            ("backend/pyproject.toml", b"v0.2.0-toml"),
            ("data/default_configs.json", b"{\"v\":2}"),
        ]);
        let valid_sha = compute_sha256_hex(&zip_bytes);

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let base_url = format!("http://{addr}");

        let manifest_json = serde_json::to_string(&PortableManifest {
            version: "0.2.0".to_string(),
            asset_name: Some(PORTABLE_ZIP_ASSET_NAME.to_string()),
            sha256: valid_sha,
        })
        .unwrap();

        let release_json = serde_json::to_string(&GitHubRelease {
            tag_name: "v0.2.0".to_string(),
            assets: vec![
                GitHubAsset {
                    name: MANIFEST_ASSET_NAME.to_string(),
                    browser_download_url: format!("{base_url}/{MANIFEST_ASSET_NAME}"),
                },
                GitHubAsset {
                    name: PORTABLE_ZIP_ASSET_NAME.to_string(),
                    browser_download_url: format!("{base_url}/{PORTABLE_ZIP_ASSET_NAME}"),
                },
            ],
        })
        .unwrap();

        let server_zip = zip_bytes.clone();
        let handle = std::thread::spawn(move || {
            // Serve 3 requests: release JSON, manifest JSON, zip archive
            for _ in 0..3 {
                if let Ok((mut stream, _)) = listener.accept() {
                    let mut buf = [0u8; 2048];
                    let n = stream.read(&mut buf).unwrap_or(0);
                    let req = String::from_utf8_lossy(&buf[..n]);
                    let first_line = req.lines().next().unwrap_or("");
                    if first_line.contains("/releases/latest") {
                        let body = release_json.as_bytes();
                        let header = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n",
                            body.len()
                        );
                        let _ = stream.write_all(header.as_bytes());
                        let _ = stream.write_all(body);
                    } else if first_line.contains(MANIFEST_ASSET_NAME) {
                        let body = manifest_json.as_bytes();
                        let header = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n",
                            body.len()
                        );
                        let _ = stream.write_all(header.as_bytes());
                        let _ = stream.write_all(body);
                    } else if first_line.contains(PORTABLE_ZIP_ASSET_NAME) {
                        let header = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: application/zip\r\nContent-Length: {}\r\n\r\n",
                            server_zip.len()
                        );
                        let _ = stream.write_all(header.as_bytes());
                        let _ = stream.write_all(&server_zip);
                    }
                }
            }
        });

        let staging = TempDir::new().unwrap();
        let result = prepare_update_in_staging(
            &format!("{base_url}/releases/latest"),
            "0.1.0",
            staging.path(),
        )
        .unwrap()
        .expect("Expected newer version to be staged");

        let _ = handle.join();

        assert_eq!(result.0, Version::new(0, 2, 0));
        assert_eq!(
            fs::read(result.2.join("youtube-shorts.exe")).unwrap(),
            b"v0.2.0-exe"
        );
    }
}
