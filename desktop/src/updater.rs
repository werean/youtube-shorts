use crate::backend::BackendProcess;
use reqwest::blocking::Client;
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub const DEFAULT_REPO: &str = "werean/youtube-shorts";
pub const DEFAULT_RELEASE_API_URL: &str =
    "https://api.github.com/repos/werean/youtube-shorts/releases/latest";
pub const USER_AGENT: &str = "youtube-shorts-desktop";
pub const EXE_ASSET_NAME: &str = "youtube-shorts.exe";
pub const MANIFEST_ASSET_NAME: &str = "portable-manifest.json";

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct GitHubAsset {
    pub name: String,
    pub browser_download_url: String,
    #[serde(default)]
    pub digest: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct GitHubRelease {
    pub tag_name: String,
    #[serde(default)]
    pub html_url: Option<String>,
    #[serde(default)]
    pub assets: Vec<GitHubAsset>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppVersionInfo {
    pub current_version: String,
    pub is_portable: bool,
    pub repo: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateInfo {
    pub current_version: String,
    pub latest_version: Option<String>,
    pub update_available: bool,
    pub release_url: Option<String>,
    pub can_auto_update: bool,
    pub status: String,
    pub message: String,
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
    let exe_asset = release.assets.iter().find(|a| a.name == EXE_ASSET_NAME);
    let manifest_asset = release
        .assets
        .iter()
        .find(|a| a.name == MANIFEST_ASSET_NAME);
    (exe_asset, manifest_asset)
}

pub fn extract_sha256_from_digest(digest: Option<&str>) -> Option<String> {
    let raw = digest?.trim();
    if raw.is_empty() {
        return None;
    }
    let hex_part = match raw.split_once(':') {
        Some((alg, rest)) if alg.trim().eq_ignore_ascii_case("sha256") => rest.trim(),
        _ => raw,
    };
    if hex_part.is_empty() {
        None
    } else {
        Some(hex_part.to_ascii_lowercase())
    }
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

pub fn build_update_and_relaunch_cmd(pid: u32, exe_dir: &Path, exe_name: &str) -> String {
    let dir = exe_dir.to_string_lossy();
    format!(
        "@echo off\r\n\
         setlocal enableextensions\r\n\
         set \"APP_PID={pid}\"\r\n\
         set \"EXE_DIR={dir}\"\r\n\
         set \"TARGET_EXE={exe_name}\"\r\n\
         set \"NEW_EXE=%EXE_DIR%\\%TARGET_EXE%.new\"\r\n\
         set \"DEST_EXE=%EXE_DIR%\\%TARGET_EXE%\"\r\n\
         \r\n\
         REM Wait for running process %APP_PID% to exit (up to 30s)\r\n\
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
         \r\n\
         REM Replace executable with retry loop in case Windows holds lock briefly\r\n\
         set /a MOVE_RETRIES=0\r\n\
         :move_loop\r\n\
         if exist \"%NEW_EXE%\" (\r\n\
           move /Y \"%NEW_EXE%\" \"%DEST_EXE%\" >nul 2>&1\r\n\
           if errorlevel 1 (\r\n\
             set /a MOVE_RETRIES+=1\r\n\
             if %MOVE_RETRIES% LSS 20 (\r\n\
               ping -n 2 127.0.0.1 >nul\r\n\
               goto move_loop\r\n\
             )\r\n\
           )\r\n\
         )\r\n\
         \r\n\
         start \"\" \"%DEST_EXE%\"\r\n\
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

fn fetch_github_release(api_url: &str, timeout: Duration) -> Result<GitHubRelease, String> {
    let client = build_http_client(timeout)?;
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
    parse_github_release(&release_text)
}

pub fn check_update_status(
    api_url: &str,
    current_version: &str,
    is_portable: bool,
) -> Result<AppUpdateInfo, String> {
    let current = parse_release_version(current_version)?;
    let release = fetch_github_release(api_url, Duration::from_secs(10))?;
    let latest = parse_release_version(&release.tag_name)?;
    let release_url = release
        .html_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToString::to_string);

    let (exe_asset, _manifest_asset) = find_release_assets(&release);
    let has_exe_asset = exe_asset.is_some();
    let update_available = latest > current;
    let can_auto_update = is_portable && update_available && has_exe_asset;

    let (status, message) = if !update_available {
        (
            "up_to_date".to_string(),
            format!("Você já está na versão mais recente (v{current})."),
        )
    } else if has_exe_asset {
        (
            "update_available".to_string(),
            format!("Nova versão v{latest} disponível!"),
        )
    } else {
        (
            "no_asset".to_string(),
            format!("Versão v{latest} encontrada, mas sem executável portable nos assets."),
        )
    };

    Ok(AppUpdateInfo {
        current_version: current.to_string(),
        latest_version: Some(latest.to_string()),
        update_available,
        release_url,
        can_auto_update,
        status,
        message,
    })
}

fn stage_release_exe(
    client: &Client,
    release: &GitHubRelease,
    exe_dir: &Path,
) -> Result<PathBuf, String> {
    let (exe_asset, manifest_asset) = find_release_assets(release);
    let Some(exe_asset) = exe_asset else {
        return Err(format!(
            "Release {} is missing asset {}",
            release.tag_name, EXE_ASSET_NAME
        ));
    };

    let expected_sha =
        if let Some(digest_sha) = extract_sha256_from_digest(exe_asset.digest.as_deref()) {
            Some(digest_sha)
        } else if let Some(manifest) = manifest_asset {
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
            if let Some(ref asset_name) = parsed.asset_name {
                if asset_name != EXE_ASSET_NAME {
                    return Err(format!(
                        "Manifest asset_name '{asset_name}' does not match '{EXE_ASSET_NAME}'"
                    ));
                }
            }
            Some(parsed.sha256)
        } else {
            None
        };

    let download_client = build_http_client(Duration::from_secs(120))?;
    let exe_bytes = download_bytes(&download_client, &exe_asset.browser_download_url)?;

    fs::create_dir_all(exe_dir)
        .map_err(|e| format!("Failed ensuring directory {}: {e}", exe_dir.display()))?;
    let new_exe_path = exe_dir.join(format!("{EXE_ASSET_NAME}.new"));
    fs::write(&new_exe_path, &exe_bytes)
        .map_err(|e| format!("Failed writing {}: {e}", new_exe_path.display()))?;

    if let Some(ref sha) = expected_sha {
        let written_bytes = fs::read(&new_exe_path).map_err(|e| {
            let _ = fs::remove_file(&new_exe_path);
            format!("Failed reading {}: {e}", new_exe_path.display())
        })?;
        if let Err(err) = verify_sha256(&written_bytes, sha) {
            let _ = fs::remove_file(&new_exe_path);
            return Err(err);
        }
    }

    Ok(new_exe_path)
}

pub fn prepare_exe_update(
    api_url: &str,
    current_version: &str,
    exe_dir: &Path,
) -> Result<Option<(Version, PathBuf)>, String> {
    let client = build_http_client(Duration::from_secs(15))?;
    let release = fetch_github_release(api_url, Duration::from_secs(15))?;

    let Some((_current, latest)) = is_newer_version(current_version, &release.tag_name)? else {
        return Ok(None);
    };

    let new_exe_path = stage_release_exe(&client, &release, exe_dir)?;
    Ok(Some((latest, new_exe_path)))
}

pub fn schedule_update_and_relaunch(exe_dir: &Path) -> Result<PathBuf, String> {
    let script_path = std::env::temp_dir().join("update-and-relaunch.cmd");
    let script_content =
        build_update_and_relaunch_cmd(std::process::id(), exe_dir, EXE_ASSET_NAME);
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

    Ok(script_path)
}

pub fn apply_update_and_schedule_relaunch(
    api_url: &str,
    current_version: &str,
    exe_dir: &Path,
    backend_proc: Option<&mut BackendProcess>,
) -> Result<UpdateOutcome, String> {
    let release = fetch_github_release(api_url, Duration::from_secs(10))?;
    let current = parse_release_version(current_version)?;
    let latest = parse_release_version(&release.tag_name)?;
    if latest <= current {
        return Ok(UpdateOutcome::UpToDate { current, latest });
    }

    let (exe_asset, _manifest_asset) = find_release_assets(&release);
    if exe_asset.is_none() {
        return Ok(UpdateOutcome::NoPortableAsset { latest });
    }

    let client = build_http_client(Duration::from_secs(15))?;
    let _new_exe_path = stage_release_exe(&client, &release, exe_dir)?;

    if let Some(proc_handle) = backend_proc {
        proc_handle.shutdown();
    }

    let script_path = schedule_update_and_relaunch(exe_dir)?;
    Ok(UpdateOutcome::RestartScheduled {
        version: latest,
        script_path,
    })
}

pub fn check_and_apply_startup_update(
    exe_dir: &Path,
    backend_proc: Option<&mut BackendProcess>,
) -> Result<UpdateOutcome, String> {
    if is_auto_update_disabled() {
        return Ok(UpdateOutcome::Disabled);
    }

    let api_url = resolve_update_api_url();
    let current_version = env!("CARGO_PKG_VERSION");
    apply_update_and_schedule_relaunch(&api_url, current_version, exe_dir, backend_proc)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::net::TcpListener;
    use tempfile::TempDir;

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
    fn test_parse_github_release_and_find_exe_assets() {
        let json = r#"{
            "tag_name": "v0.1.5",
            "assets": [
                {
                    "name": "youtube-shorts.exe",
                    "browser_download_url": "https://example.invalid/youtube-shorts.exe",
                    "digest": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
                }
            ]
        }"#;

        let release = parse_github_release(json).unwrap();
        assert_eq!(release.tag_name, "v0.1.5");
        let (exe_asset, manifest_asset) = find_release_assets(&release);
        let exe_asset = exe_asset.unwrap();
        assert_eq!(exe_asset.name, EXE_ASSET_NAME);
        assert_eq!(
            exe_asset.digest.as_deref(),
            Some("sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
        );
        assert!(manifest_asset.is_none());

        let json_without_digest = r#"{
            "tag_name": "v0.1.4",
            "assets": [
                {
                    "name": "portable-manifest.json",
                    "browser_download_url": "https://example.invalid/portable-manifest.json"
                },
                {
                    "name": "youtube-shorts.exe",
                    "browser_download_url": "https://example.invalid/youtube-shorts.exe"
                }
            ]
        }"#;
        let legacy_release = parse_github_release(json_without_digest).unwrap();
        let (legacy_exe, legacy_manifest) = find_release_assets(&legacy_release);
        assert_eq!(legacy_exe.unwrap().digest, None);
        assert_eq!(legacy_manifest.unwrap().name, MANIFEST_ASSET_NAME);
    }

    #[test]
    fn test_extract_sha256_from_digest() {
        let upper_hex = "A".repeat(64);
        let lower_hex = "a".repeat(64);
        assert_eq!(
            extract_sha256_from_digest(Some(&format!("sha256:{lower_hex}"))).as_deref(),
            Some(lower_hex.as_str())
        );
        assert_eq!(
            extract_sha256_from_digest(Some(&format!("  SHA256:{upper_hex}  "))).as_deref(),
            Some(lower_hex.as_str())
        );
        assert_eq!(
            extract_sha256_from_digest(Some(&upper_hex)).as_deref(),
            Some(lower_hex.as_str())
        );
        assert_eq!(extract_sha256_from_digest(None), None);
        assert_eq!(extract_sha256_from_digest(Some("   ")), None);
        assert_eq!(extract_sha256_from_digest(Some("sha256:")), None);
    }

    #[test]
    fn test_sha256_verification_pass_and_fail() {
        let payload = b"youtube-shorts-single-exe-binary-content";
        let digest = compute_sha256_hex(payload);
        assert_eq!(digest.len(), 64);
        assert!(verify_sha256(payload, &digest.to_uppercase()).is_ok());
        assert!(verify_sha256(payload, &"0".repeat(64)).is_err());
    }

    #[test]
    fn test_build_update_and_relaunch_cmd_layout() {
        let cmd = build_update_and_relaunch_cmd(
            4242,
            Path::new("C:\\Apps\\YouTubeShorts"),
            "youtube-shorts.exe",
        );

        assert!(cmd.contains("APP_PID=4242"));
        assert!(cmd.contains("EXE_DIR=C:\\Apps\\YouTubeShorts"));
        assert!(cmd.contains("TARGET_EXE=youtube-shorts.exe"));
        assert!(cmd.contains("%EXE_DIR%\\%TARGET_EXE%.new"));
        assert!(cmd.contains("move /Y \"%NEW_EXE%\" \"%DEST_EXE%\""));
        assert!(cmd.contains(":move_loop"));
        assert!(cmd.contains("start \"\" \"%DEST_EXE%\""));
        assert!(cmd.contains("del \"%~f0\""));
        assert!(!cmd.contains("rmdir /S /Q \"%EXE_DIR%\\data\""));
        assert!(!cmd.contains("rmdir /S /Q \"%EXE_DIR%\\backend\""));
    }

    fn spawn_mock_release_server(
        exe_digest: Option<String>,
        manifest_sha256: Option<String>,
        exe_bytes: Vec<u8>,
    ) -> (String, std::thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let base_url = format!("http://{addr}");

        let mut assets = Vec::new();
        let mut expected_requests = 2usize; // /releases/latest + youtube-shorts.exe

        let manifest_json = manifest_sha256.map(|sha| {
            assets.push(GitHubAsset {
                name: MANIFEST_ASSET_NAME.to_string(),
                browser_download_url: format!("{base_url}/{MANIFEST_ASSET_NAME}"),
                digest: None,
            });
            if exe_digest.is_none() {
                expected_requests += 1;
            }
            serde_json::to_string(&PortableManifest {
                version: "0.2.0".to_string(),
                asset_name: Some(EXE_ASSET_NAME.to_string()),
                sha256: sha,
            })
            .unwrap()
        });

        assets.push(GitHubAsset {
            name: EXE_ASSET_NAME.to_string(),
            browser_download_url: format!("{base_url}/{EXE_ASSET_NAME}"),
            digest: exe_digest,
        });

        let release_json = serde_json::to_string(&GitHubRelease {
            tag_name: "v0.2.0".to_string(),
            html_url: Some(format!("{base_url}/releases/tag/v0.2.0")),
            assets,
        })
        .unwrap();

        let handle = std::thread::spawn(move || {
            for _ in 0..expected_requests {
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
                        if let Some(ref manifest) = manifest_json {
                            let body = manifest.as_bytes();
                            let header = format!(
                                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n",
                                body.len()
                            );
                            let _ = stream.write_all(header.as_bytes());
                            let _ = stream.write_all(body);
                        }
                    } else if first_line.contains(EXE_ASSET_NAME) {
                        let header = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: {}\r\n\r\n",
                            exe_bytes.len()
                        );
                        let _ = stream.write_all(header.as_bytes());
                        let _ = stream.write_all(&exe_bytes);
                    }
                }
            }
        });

        (base_url, handle)
    }

    #[test]
    fn test_end_to_end_prepare_exe_update_with_github_digest() {
        let exe_bytes = b"MZ-v0.2.0-single-exe-binary".to_vec();
        let valid_sha = compute_sha256_hex(&exe_bytes);
        let (base_url, handle) = spawn_mock_release_server(
            Some(format!("sha256:{}", valid_sha.to_uppercase())),
            None,
            exe_bytes.clone(),
        );

        let exe_dir = TempDir::new().unwrap();
        let (version, new_exe_path) = prepare_exe_update(
            &format!("{base_url}/releases/latest"),
            "0.1.0",
            exe_dir.path(),
        )
        .unwrap()
        .expect("Expected newer version to be downloaded");

        let _ = handle.join();

        assert_eq!(version, Version::new(0, 2, 0));
        assert_eq!(new_exe_path, exe_dir.path().join("youtube-shorts.exe.new"));
        assert_eq!(fs::read(&new_exe_path).unwrap(), exe_bytes);
    }

    #[test]
    fn test_prepare_exe_update_deletes_new_file_on_digest_sha256_mismatch() {
        let exe_bytes = b"corrupted-exe-payload".to_vec();
        let (base_url, handle) = spawn_mock_release_server(
            Some(format!("sha256:{}", "f".repeat(64))),
            None,
            exe_bytes,
        );

        let exe_dir = TempDir::new().unwrap();
        let err = prepare_exe_update(
            &format!("{base_url}/releases/latest"),
            "0.1.0",
            exe_dir.path(),
        )
        .unwrap_err();

        let _ = handle.join();

        assert!(err.contains("SHA-256 verification failed"));
        assert!(!exe_dir.path().join("youtube-shorts.exe.new").exists());
    }

    #[test]
    fn test_prepare_exe_update_falls_back_to_manifest_when_digest_absent() {
        let exe_bytes = b"MZ-v0.2.0-legacy-manifest-fallback".to_vec();
        let valid_sha = compute_sha256_hex(&exe_bytes);
        let (base_url, handle) =
            spawn_mock_release_server(None, Some(valid_sha), exe_bytes.clone());

        let exe_dir = TempDir::new().unwrap();
        let (version, new_exe_path) = prepare_exe_update(
            &format!("{base_url}/releases/latest"),
            "0.1.0",
            exe_dir.path(),
        )
        .unwrap()
        .expect("Expected newer version via manifest fallback");

        let _ = handle.join();

        assert_eq!(version, Version::new(0, 2, 0));
        assert_eq!(fs::read(&new_exe_path).unwrap(), exe_bytes);
    }

    #[test]
    fn test_prepare_exe_update_deletes_new_file_on_manifest_fallback_mismatch() {
        let exe_bytes = b"corrupted-legacy-exe-payload".to_vec();
        let (base_url, handle) =
            spawn_mock_release_server(None, Some("f".repeat(64)), exe_bytes);

        let exe_dir = TempDir::new().unwrap();
        let err = prepare_exe_update(
            &format!("{base_url}/releases/latest"),
            "0.1.0",
            exe_dir.path(),
        )
        .unwrap_err();

        let _ = handle.join();

        assert!(err.contains("SHA-256 verification failed"));
        assert!(!exe_dir.path().join("youtube-shorts.exe.new").exists());
    }

    fn spawn_single_release_metadata_server(
        release: GitHubRelease,
    ) -> (String, std::thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let base_url = format!("http://{addr}");
        let release_json = serde_json::to_string(&release).unwrap();

        let handle = std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 2048];
                let _ = stream.read(&mut buf);
                let body = release_json.as_bytes();
                let header = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n",
                    body.len()
                );
                let _ = stream.write_all(header.as_bytes());
                let _ = stream.write_all(body);
            }
        });

        (base_url, handle)
    }

    #[test]
    fn test_check_update_status_up_to_date() {
        let (base_url, handle) = spawn_single_release_metadata_server(GitHubRelease {
            tag_name: "v0.1.3".to_string(),
            html_url: Some("https://github.com/werean/youtube-shorts/releases/tag/v0.1.3".to_string()),
            assets: vec![GitHubAsset {
                name: EXE_ASSET_NAME.to_string(),
                browser_download_url: "https://example.invalid/youtube-shorts.exe".to_string(),
                digest: None,
            }],
        });

        let info = check_update_status(&format!("{base_url}/releases/latest"), "0.1.3", true)
            .unwrap();
        let _ = handle.join();

        assert_eq!(info.current_version, "0.1.3");
        assert_eq!(info.latest_version.as_deref(), Some("0.1.3"));
        assert!(!info.update_available);
        assert!(!info.can_auto_update);
        assert_eq!(info.status, "up_to_date");
        assert_eq!(
            info.release_url.as_deref(),
            Some("https://github.com/werean/youtube-shorts/releases/tag/v0.1.3")
        );
        assert!(info.message.contains("v0.1.3"));
    }

    #[test]
    fn test_check_update_status_update_available_portable_vs_non_portable() {
        let release = GitHubRelease {
            tag_name: "v0.2.0".to_string(),
            html_url: Some("https://github.com/werean/youtube-shorts/releases/tag/v0.2.0".to_string()),
            assets: vec![GitHubAsset {
                name: EXE_ASSET_NAME.to_string(),
                browser_download_url: "https://example.invalid/youtube-shorts.exe".to_string(),
                digest: Some("sha256:abcdef".to_string()),
            }],
        };

        let (base_url_portable, handle_portable) =
            spawn_single_release_metadata_server(release.clone());
        let portable_info =
            check_update_status(&format!("{base_url_portable}/releases/latest"), "0.1.3", true)
                .unwrap();
        let _ = handle_portable.join();

        assert_eq!(portable_info.current_version, "0.1.3");
        assert_eq!(portable_info.latest_version.as_deref(), Some("0.2.0"));
        assert!(portable_info.update_available);
        assert!(portable_info.can_auto_update);
        assert_eq!(portable_info.status, "update_available");
        assert!(portable_info.message.contains("v0.2.0"));

        let (base_url_dev, handle_dev) = spawn_single_release_metadata_server(release);
        let non_portable_info =
            check_update_status(&format!("{base_url_dev}/releases/latest"), "0.1.3", false)
                .unwrap();
        let _ = handle_dev.join();

        assert!(non_portable_info.update_available);
        assert!(!non_portable_info.can_auto_update);
        assert_eq!(non_portable_info.status, "update_available");
    }

    #[test]
    fn test_check_update_status_no_asset() {
        let (base_url, handle) = spawn_single_release_metadata_server(GitHubRelease {
            tag_name: "v0.2.1".to_string(),
            html_url: Some("https://github.com/werean/youtube-shorts/releases/tag/v0.2.1".to_string()),
            assets: vec![],
        });

        let info = check_update_status(&format!("{base_url}/releases/latest"), "0.1.3", true)
            .unwrap();
        let _ = handle.join();

        assert_eq!(info.current_version, "0.1.3");
        assert_eq!(info.latest_version.as_deref(), Some("0.2.1"));
        assert!(info.update_available);
        assert!(!info.can_auto_update);
        assert_eq!(info.status, "no_asset");
        assert!(info.message.contains("v0.2.1"));
    }
}
