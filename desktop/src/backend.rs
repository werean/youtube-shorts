use reqwest::blocking::Client;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};
use zip::ZipArchive;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub const DEFAULT_HEALTH_URL: &str = "http://127.0.0.1:8000/health";
pub const BACKEND_HOST: &str = "127.0.0.1";
pub const BACKEND_PORT: &str = "8000";
pub const EMBEDDED_VERSION_FILE: &str = ".embedded-version";
pub const STARTUP_LOG_FILE: &str = "desktop-startup.log";

pub const EMBEDDED_RUNTIME_ZIP: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/embedded-runtime.zip"));

pub const PRESERVED_RELATIVE_PATHS: &[&str] = &[
    "data/settings.json",
    "data/custom_settings.json",
    "data/saved_llm_prompts.json",
    "data/jobs",
    "data/profile",
    "backend/.venv",
];

pub const MINIMAL_SERVER_DEPS: &[&str] = &[
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.30.0",
    "pydantic>=2.8.0",
    "python-multipart>=0.0.9",
    "httpx>=0.27.0",
    "numpy>=1.26.0",
    "scipy>=1.13.0",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuntimeMode {
    DevRepo(PathBuf),
    Portable(PathBuf),
}

impl RuntimeMode {
    pub fn root(&self) -> &Path {
        match self {
            Self::DevRepo(p) | Self::Portable(p) => p.as_path(),
        }
    }

    pub fn is_dev_repo(&self) -> bool {
        matches!(self, Self::DevRepo(_))
    }
}

#[derive(Debug)]
pub struct BackendProcess {
    child: Option<Child>,
    pub pid: Option<u32>,
    pub attached_existing: bool,
}

impl BackendProcess {
    pub fn attached_existing() -> Self {
        Self {
            child: None,
            pid: None,
            attached_existing: true,
        }
    }

    pub fn from_child(child: Child) -> Self {
        let pid = Some(child.id());
        Self {
            child: Some(child),
            pid,
            attached_existing: false,
        }
    }

    pub fn shutdown(&mut self) {
        if let Some(mut child) = self.child.take() {
            let pid = child.id();
            #[cfg(windows)]
            {
                let mut tk = Command::new("taskkill");
                tk.args(["/PID", &pid.to_string(), "/T", "/F"])
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .creation_flags(CREATE_NO_WINDOW);
                let _ = tk.status();
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for BackendProcess {
    fn drop(&mut self) {
        self.shutdown();
    }
}

pub fn has_backend_entrypoint(dir: &Path) -> bool {
    dir.join("backend").join("app").join("main.py").is_file()
}

pub fn is_dev_repo_root(dir: &Path) -> bool {
    has_backend_entrypoint(dir) && dir.join("desktop").join("Cargo.toml").is_file()
}

fn is_under_desktop_target(exe_dir: &Path, repo_root: &Path) -> bool {
    let target_dir = repo_root.join("desktop").join("target");
    exe_dir.starts_with(&target_dir)
}

pub fn resolve_runtime_mode_from(
    exe_dir: Option<&Path>,
    current_dir: Option<&Path>,
) -> Option<RuntimeMode> {
    if let Some(dir) = exe_dir {
        for ancestor in dir.ancestors() {
            if is_dev_repo_root(ancestor) && is_under_desktop_target(dir, ancestor) {
                return Some(RuntimeMode::DevRepo(ancestor.to_path_buf()));
            }
        }
        return Some(RuntimeMode::Portable(dir.to_path_buf()));
    }

    if let Some(cwd) = current_dir {
        for ancestor in cwd.ancestors() {
            if is_dev_repo_root(ancestor) {
                return Some(RuntimeMode::DevRepo(ancestor.to_path_buf()));
            }
        }
        return Some(RuntimeMode::Portable(cwd.to_path_buf()));
    }

    None
}

pub fn resolve_runtime_mode() -> Result<RuntimeMode, String> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf));
    let cwd = std::env::current_dir().ok();

    resolve_runtime_mode_from(exe_dir.as_deref(), cwd.as_deref())
        .ok_or_else(|| "Unable to determine runtime root directory".to_string())
}

pub fn resolve_portable_root_from(
    exe_dir: Option<&Path>,
    current_dir: Option<&Path>,
) -> Option<PathBuf> {
    resolve_runtime_mode_from(exe_dir, current_dir).map(|mode| mode.root().to_path_buf())
}

pub fn resolve_portable_root() -> Result<PathBuf, String> {
    resolve_runtime_mode().map(|mode| mode.root().to_path_buf())
}

pub fn resolve_webview_data_dir_with(
    mode: &RuntimeMode,
    local_app_data: Option<&Path>,
) -> PathBuf {
    match mode {
        RuntimeMode::Portable(root) => root.join("data").join("webview"),
        RuntimeMode::DevRepo(root) => local_app_data
            .map(|p| p.join("YouTubeShorts").join("webview"))
            .unwrap_or_else(|| root.join("data").join("webview")),
    }
}

pub fn resolve_webview_data_dir(mode: &RuntimeMode) -> PathBuf {
    let local_app_data = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    resolve_webview_data_dir_with(mode, local_app_data.as_deref())
}

pub fn append_startup_log(root: &Path, message: &str) {
    use std::io::Write;

    let _ = fs::create_dir_all(root);
    let log_path = root.join(STARTUP_LOG_FILE);
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    if let Ok(mut file) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
    {
        let _ = writeln!(file, "[{secs}] {message}");
    }
}

fn is_allowed_embedded_entry(rel_posix: &str) -> bool {
    (rel_posix.starts_with("backend/app/") && rel_posix.len() > "backend/app/".len())
        || rel_posix == "backend/pyproject.toml"
        || rel_posix == "data/default_configs.json"
}

fn path_to_posix(path: &Path) -> String {
    path.components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

/// Extracts `backend/app/`, `backend/pyproject.toml`, and `data/default_configs.json`
/// from `zip_bytes` into `root` whenever `.embedded-version` differs from `version`
/// or `backend/app/main.py` is missing.
///
/// Strictly preserves user data (`data/settings.json`, `data/custom_settings.json`,
/// `data/saved_llm_prompts.json`, `data/jobs/`, `data/profile/`, `backend/.venv/`).
pub fn extract_embedded_runtime(
    root: &Path,
    version: &str,
    zip_bytes: &[u8],
) -> Result<bool, String> {
    let version_path = root.join(EMBEDDED_VERSION_FILE);
    let current_marker = fs::read_to_string(&version_path).ok();
    let marker_matches = current_marker
        .as_deref()
        .map(str::trim)
        == Some(version.trim());

    if marker_matches && has_backend_entrypoint(root) {
        return Ok(false);
    }

    let cursor = Cursor::new(zip_bytes);
    let mut archive =
        ZipArchive::new(cursor).map_err(|e| format!("Invalid embedded runtime archive: {e}"))?;

    // Pass 1: validate entries and confirm backend/app/main.py is present before modifying disk.
    let mut has_main_py = false;
    for idx in 0..archive.len() {
        let entry = archive
            .by_index(idx)
            .map_err(|e| format!("Failed inspecting embedded entry #{idx}: {e}"))?;
        let enclosed = entry
            .enclosed_name()
            .ok_or_else(|| format!("Unsafe path in embedded archive: {}", entry.name()))?;
        let rel_posix = path_to_posix(&enclosed);
        if rel_posix == "backend/app/main.py" && !entry.is_dir() {
            has_main_py = true;
        }
    }

    if !has_main_py {
        return Err("Embedded runtime archive is missing backend/app/main.py".to_string());
    }

    // Replace backend/app cleanly so deleted modules do not linger across updates,
    // while leaving backend/.venv and all user data untouched.
    let target_backend_app = root.join("backend").join("app");
    if target_backend_app.exists() {
        fs::remove_dir_all(&target_backend_app).map_err(|e| {
            format!(
                "Failed replacing existing {}: {e}",
                target_backend_app.display()
            )
        })?;
    }

    // Pass 2: extract only allowlisted runtime files.
    for idx in 0..archive.len() {
        let mut entry = archive
            .by_index(idx)
            .map_err(|e| format!("Failed reading embedded entry #{idx}: {e}"))?;
        let enclosed = entry
            .enclosed_name()
            .ok_or_else(|| format!("Unsafe path in embedded archive: {}", entry.name()))?
            .to_path_buf();

        let rel_posix = path_to_posix(&enclosed);
        if !is_allowed_embedded_entry(&rel_posix) {
            continue;
        }

        let out_path = root.join(&enclosed);
        if entry.is_dir() {
            fs::create_dir_all(&out_path)
                .map_err(|e| format!("Failed creating {}: {e}", out_path.display()))?;
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed creating {}: {e}", parent.display()))?;
            }
            let mut out_file = fs::File::create(&out_path)
                .map_err(|e| format!("Failed creating {}: {e}", out_path.display()))?;
            std::io::copy(&mut entry, &mut out_file)
                .map_err(|e| format!("Failed extracting {}: {e}", out_path.display()))?;
        }
    }

    fs::create_dir_all(root.join("data"))
        .map_err(|e| format!("Failed ensuring data directory: {e}"))?;
    fs::write(&version_path, version.trim()).map_err(|e| {
        format!(
            "Failed writing embedded version marker {}: {e}",
            version_path.display()
        )
    })?;

    Ok(true)
}

pub fn ensure_embedded_runtime(root: &Path) -> Result<bool, String> {
    if is_dev_repo_root(root) {
        return Ok(false);
    }
    extract_embedded_runtime(root, env!("CARGO_PKG_VERSION"), EMBEDDED_RUNTIME_ZIP)
}

pub fn venv_python_path_for(root: &Path, is_windows: bool) -> PathBuf {
    let venv_dir = root.join("backend").join(".venv");
    if is_windows {
        venv_dir.join("Scripts").join("python.exe")
    } else {
        venv_dir.join("bin").join("python")
    }
}

pub fn venv_python_path(root: &Path) -> PathBuf {
    venv_python_path_for(root, cfg!(windows))
}

pub fn is_health_ok(health_url: &str, timeout: Duration) -> bool {
    let Ok(client) = Client::builder().timeout(timeout).build() else {
        return false;
    };
    match client.get(health_url).send() {
        Ok(resp) => resp.status().as_u16() == 200,
        Err(_) => false,
    }
}

fn configure_hidden(cmd: &mut Command) {
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        let _ = cmd;
    }
}

fn probe_python_version(exe: &str, prefix_args: &[&str]) -> Option<String> {
    let mut cmd = Command::new(exe);
    cmd.args(prefix_args)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_hidden(&mut cmd);

    let output = cmd.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let text = if stdout.trim().is_empty() {
        stderr.trim().to_string()
    } else {
        stdout.trim().to_string()
    };
    if text.starts_with("Python 3.") {
        Some(text)
    } else {
        None
    }
}

pub fn find_bootstrap_python() -> Result<(String, Vec<String>), String> {
    #[cfg(windows)]
    let candidates: &[(&str, &[&str])] = &[
        ("py", &["-3.12"]),
        ("python3.12", &[]),
        ("python", &[]),
        ("py", &["-3"]),
        ("python3", &[]),
    ];

    #[cfg(not(windows))]
    let candidates: &[(&str, &[&str])] = &[
        ("python3.12", &[]),
        ("python3", &[]),
        ("python", &[]),
    ];

    let mut fallback: Option<(String, Vec<String>)> = None;

    for &(exe, args) in candidates {
        if let Some(version) = probe_python_version(exe, args) {
            let owned_args = args.iter().map(|s| (*s).to_string()).collect::<Vec<_>>();
            if version.starts_with("Python 3.12.") {
                return Ok((exe.to_string(), owned_args));
            }
            if fallback.is_none() {
                fallback = Some((exe.to_string(), owned_args));
            }
        }
    }

    fallback.ok_or_else(|| {
        "No Python 3.12 (or compatible Python 3) interpreter found to create backend/.venv"
            .to_string()
    })
}

pub fn ensure_venv_bootstrapped(root: &Path) -> Result<PathBuf, String> {
    let venv_py = venv_python_path(root);
    if venv_py.is_file() {
        return Ok(venv_py);
    }

    let backend_dir = root.join("backend");
    let venv_dir = backend_dir.join(".venv");
    let (py_exe, py_args) = find_bootstrap_python()?;

    let mut venv_cmd = Command::new(&py_exe);
    venv_cmd
        .args(&py_args)
        .args(["-m", "venv"])
        .arg(&venv_dir)
        .current_dir(&backend_dir)
        .stdin(Stdio::null());
    configure_hidden(&mut venv_cmd);

    let venv_output = venv_cmd
        .output()
        .map_err(|e| format!("Failed to invoke `{py_exe} -m venv`: {e}"))?;
    if !venv_output.status.success() {
        let stderr = String::from_utf8_lossy(&venv_output.stderr);
        return Err(format!("Failed to create backend/.venv: {stderr}"));
    }

    if !venv_py.is_file() {
        return Err(format!(
            "Virtual environment created but python executable not found at {}",
            venv_py.display()
        ));
    }

    let mut pip_cmd = Command::new(&venv_py);
    pip_cmd
        .args(["-m", "pip", "install", "--disable-pip-version-check", "--upgrade"])
        .args(MINIMAL_SERVER_DEPS)
        .current_dir(&backend_dir)
        .stdin(Stdio::null());
    configure_hidden(&mut pip_cmd);

    let pip_output = pip_cmd
        .output()
        .map_err(|e| format!("Failed to invoke pip in backend/.venv: {e}"))?;
    if !pip_output.status.success() {
        let stderr = String::from_utf8_lossy(&pip_output.stderr);
        let stdout = String::from_utf8_lossy(&pip_output.stdout);
        return Err(format!(
            "Failed to install minimal backend server dependencies: {stderr}\n{stdout}"
        ));
    }

    Ok(venv_py)
}

pub fn wait_for_health_or_exit(
    health_url: &str,
    timeout: Duration,
    poll_interval: Duration,
    child: &mut Child,
) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    loop {
        if is_health_ok(health_url, Duration::from_millis(1000)) {
            return Ok(());
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                return Err(format!(
                    "Backend process exited prematurely with status {status}"
                ));
            }
            Ok(None) => {}
            Err(err) => {
                return Err(format!("Failed checking backend child status: {err}"));
            }
        }
        if Instant::now() >= deadline {
            return Err(format!(
                "Timed out waiting for backend health check at {health_url} after {}s",
                timeout.as_secs()
            ));
        }
        std::thread::sleep(poll_interval);
    }
}

pub fn start_or_attach_backend(root: &Path) -> Result<BackendProcess, String> {
    ensure_embedded_runtime(root)?;

    if is_health_ok(DEFAULT_HEALTH_URL, Duration::from_millis(1200)) {
        return Ok(BackendProcess::attached_existing());
    }

    let venv_py = ensure_venv_bootstrapped(root)?;
    let backend_dir = root.join("backend");
    let data_dir = root.join("data");

    let mut cmd = Command::new(&venv_py);
    cmd.args([
        "-m",
        "uvicorn",
        "app.main:app",
        "--host",
        BACKEND_HOST,
        "--port",
        BACKEND_PORT,
    ])
    .current_dir(&backend_dir)
    .env("YTS_PROJECT_ROOT", root)
    .env("YTS_DATA_DIR", &data_dir)
    .env("PYTHONUNBUFFERED", "1")
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null());
    configure_hidden(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn uvicorn backend: {e}"))?;

    if let Err(err) = wait_for_health_or_exit(
        DEFAULT_HEALTH_URL,
        Duration::from_secs(30),
        Duration::from_millis(250),
        &mut child,
    ) {
        let mut proc_guard = BackendProcess::from_child(child);
        proc_guard.shutdown();
        return Err(err);
    }

    Ok(BackendProcess::from_child(child))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use tempfile::TempDir;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    fn create_dev_repo_layout(root: &Path) {
        let app_dir = root.join("backend").join("app");
        let desktop_dir = root.join("desktop");
        fs::create_dir_all(&app_dir).unwrap();
        fs::create_dir_all(&desktop_dir).unwrap();
        fs::write(app_dir.join("main.py"), "app = object()\n").unwrap();
        fs::write(
            desktop_dir.join("Cargo.toml"),
            "[package]\nname = \"youtube-shorts-desktop\"\n",
        )
        .unwrap();
    }

    fn build_runtime_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
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
    fn test_resolve_runtime_mode_dev_target_vs_portable() {
        let tmp = TempDir::new().unwrap();
        create_dev_repo_layout(tmp.path());

        let target_debug = tmp.path().join("desktop").join("target").join("debug");
        let target_release = tmp.path().join("desktop").join("target").join("release");
        fs::create_dir_all(&target_debug).unwrap();
        fs::create_dir_all(&target_release).unwrap();

        assert_eq!(
            resolve_runtime_mode_from(Some(&target_debug), None),
            Some(RuntimeMode::DevRepo(tmp.path().to_path_buf()))
        );
        assert_eq!(
            resolve_runtime_mode_from(Some(&target_release), None),
            Some(RuntimeMode::DevRepo(tmp.path().to_path_buf()))
        );

        // Even inside the repo (e.g. dist-portable/), a binary NOT inside desktop/target/
        // runs in Portable mode using its own exe_dir.
        let dist_portable = tmp.path().join("dist-portable");
        fs::create_dir_all(&dist_portable).unwrap();
        assert_eq!(
            resolve_runtime_mode_from(Some(&dist_portable), None),
            Some(RuntimeMode::Portable(dist_portable))
        );

        // Standalone empty folder uses exe_dir as Portable root even before extraction.
        let empty_portable = TempDir::new().unwrap();
        assert_eq!(
            resolve_runtime_mode_from(Some(empty_portable.path()), Some(tmp.path())),
            Some(RuntimeMode::Portable(empty_portable.path().to_path_buf()))
        );
    }

    #[test]
    fn test_resolve_runtime_mode_cwd_fallback_when_no_exe_dir() {
        let tmp = TempDir::new().unwrap();
        create_dev_repo_layout(tmp.path());
        let nested_cwd = tmp.path().join("desktop");

        assert_eq!(
            resolve_runtime_mode_from(None, Some(&nested_cwd)),
            Some(RuntimeMode::DevRepo(tmp.path().to_path_buf()))
        );
    }

    #[test]
    fn test_extract_embedded_runtime_version_sync_and_preserves_user_data() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        // Pre-populate user state that must NEVER be touched or overwritten
        fs::create_dir_all(root.join("backend/.venv/Scripts")).unwrap();
        fs::create_dir_all(root.join("data/jobs/job_1")).unwrap();
        fs::create_dir_all(root.join("data/profile/marca-dagua")).unwrap();
        fs::write(root.join("backend/.venv/Scripts/python.exe"), b"user-venv").unwrap();
        fs::write(root.join("data/settings.json"), b"{\"base_dir\":\"D:/Videos\"}").unwrap();
        fs::write(root.join("data/custom_settings.json"), b"{\"custom\":1}").unwrap();
        fs::write(root.join("data/saved_llm_prompts.json"), b"[{\"name\":\"p1\"}]").unwrap();
        fs::write(root.join("data/jobs/job_1/job.json"), b"{\"id\":\"job_1\"}").unwrap();
        fs::write(root.join("data/profile/marca-dagua/watermark.png"), b"png").unwrap();

        let zip_v1 = build_runtime_zip(&[
            ("backend/app/main.py", b"print('v1')"),
            ("backend/app/old_only.py", b"old"),
            ("backend/pyproject.toml", b"version='0.1.0'"),
            ("data/default_configs.json", b"{\"v\":1}"),
            // Attempted poison entries must be ignored by the allowlist
            ("data/settings.json", b"{\"overwrite\":true}"),
            ("backend/.venv/Scripts/python.exe", b"poison"),
        ]);

        // Initial extraction on empty runtime
        assert!(extract_embedded_runtime(root, "0.1.0", &zip_v1).unwrap());
        assert_eq!(fs::read_to_string(root.join(EMBEDDED_VERSION_FILE)).unwrap(), "0.1.0");
        assert_eq!(fs::read(root.join("backend/app/main.py")).unwrap(), b"print('v1')");
        assert_eq!(fs::read(root.join("backend/app/old_only.py")).unwrap(), b"old");
        assert_eq!(fs::read(root.join("backend/pyproject.toml")).unwrap(), b"version='0.1.0'");
        assert_eq!(fs::read(root.join("data/default_configs.json")).unwrap(), b"{\"v\":1}");

        // Second run with same version is a no-op
        assert!(!extract_embedded_runtime(root, "0.1.0", &zip_v1).unwrap());

        // Missing backend/app/main.py forces re-extraction even when version matches
        fs::remove_file(root.join("backend/app/main.py")).unwrap();
        assert!(extract_embedded_runtime(root, "0.1.0", &zip_v1).unwrap());
        assert!(root.join("backend/app/main.py").is_file());

        // Version upgrade replaces backend/app cleanly and updates default_configs.json
        let zip_v2 = build_runtime_zip(&[
            ("backend/app/main.py", b"print('v2')"),
            ("backend/pyproject.toml", b"version='0.2.0'"),
            ("data/default_configs.json", b"{\"v\":2}"),
        ]);
        assert!(extract_embedded_runtime(root, "0.2.0", &zip_v2).unwrap());
        assert_eq!(fs::read_to_string(root.join(EMBEDDED_VERSION_FILE)).unwrap(), "0.2.0");
        assert_eq!(fs::read(root.join("backend/app/main.py")).unwrap(), b"print('v2')");
        assert!(!root.join("backend/app/old_only.py").exists());
        assert_eq!(fs::read(root.join("backend/pyproject.toml")).unwrap(), b"version='0.2.0'");
        assert_eq!(fs::read(root.join("data/default_configs.json")).unwrap(), b"{\"v\":2}");

        // User data and .venv strictly preserved
        assert_eq!(
            fs::read(root.join("backend/.venv/Scripts/python.exe")).unwrap(),
            b"user-venv"
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
            b"png"
        );
    }

    #[test]
    fn test_compiled_embedded_runtime_zip_contains_expected_files() {
        let mut archive = ZipArchive::new(Cursor::new(EMBEDDED_RUNTIME_ZIP)).unwrap();
        let mut names = Vec::new();
        for idx in 0..archive.len() {
            let entry = archive.by_index(idx).unwrap();
            let name = entry.name().to_string();
            assert!(!name.contains("__pycache__"), "unexpected pycache entry: {name}");
            assert!(!name.contains(".pytest_cache"), "unexpected pytest_cache entry: {name}");
            assert!(!name.ends_with(".pyc"), "unexpected .pyc entry: {name}");
            assert!(!name.ends_with(".pyo"), "unexpected .pyo entry: {name}");
            names.push(name);
        }

        assert!(names.iter().any(|n| n == "backend/app/main.py"));
        assert!(names.iter().any(|n| n == "backend/pyproject.toml"));
        assert!(names.iter().any(|n| n == "data/default_configs.json"));
    }

    #[test]
    fn test_venv_python_path_for_windows_and_posix() {
        let root = Path::new("portable");
        assert_eq!(
            venv_python_path_for(root, true),
            PathBuf::from("portable")
                .join("backend")
                .join(".venv")
                .join("Scripts")
                .join("python.exe")
        );
        assert_eq!(
            venv_python_path_for(root, false),
            PathBuf::from("portable")
                .join("backend")
                .join(".venv")
                .join("bin")
                .join("python")
        );
    }

    #[test]
    fn test_is_health_ok_against_mock_server() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let stop_clone = Arc::clone(&stop);

        let handle = std::thread::spawn(move || {
            let mut count = 0;
            for stream in listener.incoming() {
                if stop_clone.load(Ordering::Relaxed) {
                    break;
                }
                if let Ok(mut s) = stream {
                    let mut buf = [0u8; 512];
                    let _ = s.read(&mut buf);
                    let resp = if count == 0 {
                        "HTTP/1.1 200 OK\r\nContent-Length: 15\r\n\r\n{\"status\":\"ok\"}"
                    } else {
                        "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n"
                    };
                    let _ = s.write_all(resp.as_bytes());
                    count += 1;
                    if count >= 2 {
                        break;
                    }
                }
            }
        });

        let url = format!("http://{addr}/health");
        assert!(is_health_ok(&url, Duration::from_secs(2)));
        assert!(!is_health_ok(&url, Duration::from_secs(2)));

        stop.store(true, Ordering::Relaxed);
        let _ = handle.join();

        assert!(!is_health_ok(&url, Duration::from_millis(300)));
    }

    #[test]
    fn test_resolve_webview_data_dir_portable_and_dev_repo() {
        let portable_root = PathBuf::from("D:\\Portable\\YouTubeShorts");
        let dev_root = PathBuf::from("C:\\src\\youtube-shorts");
        let local_app_data = PathBuf::from("C:\\Users\\alice\\AppData\\Local");

        assert_eq!(
            resolve_webview_data_dir_with(
                &RuntimeMode::Portable(portable_root.clone()),
                Some(&local_app_data),
            ),
            portable_root.join("data").join("webview")
        );
        assert_eq!(
            resolve_webview_data_dir_with(
                &RuntimeMode::DevRepo(dev_root.clone()),
                Some(&local_app_data),
            ),
            local_app_data.join("YouTubeShorts").join("webview")
        );
        assert_eq!(
            resolve_webview_data_dir_with(&RuntimeMode::DevRepo(dev_root.clone()), None),
            dev_root.join("data").join("webview")
        );
    }

    #[test]
    fn test_append_startup_log_creates_and_appends() {
        let tmp = TempDir::new().unwrap();
        append_startup_log(tmp.path(), "first line");
        append_startup_log(tmp.path(), "second line");

        let log_text = fs::read_to_string(tmp.path().join(STARTUP_LOG_FILE)).unwrap();
        assert!(log_text.contains("first line"));
        assert!(log_text.contains("second line"));
    }
}
