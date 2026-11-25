use reqwest::blocking::Client;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub const DEFAULT_HEALTH_URL: &str = "http://127.0.0.1:8000/health";
pub const BACKEND_HOST: &str = "127.0.0.1";
pub const BACKEND_PORT: &str = "8000";

pub const MINIMAL_SERVER_DEPS: &[&str] = &[
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.30.0",
    "pydantic>=2.8.0",
    "python-multipart>=0.0.9",
    "httpx>=0.27.0",
    "numpy>=1.26.0",
    "scipy>=1.13.0",
];

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

pub fn resolve_portable_root_from(
    exe_dir: Option<&Path>,
    current_dir: Option<&Path>,
) -> Option<PathBuf> {
    if let Some(dir) = exe_dir {
        if has_backend_entrypoint(dir) {
            return Some(dir.to_path_buf());
        }
        for ancestor in dir.ancestors().skip(1) {
            if has_backend_entrypoint(ancestor) {
                return Some(ancestor.to_path_buf());
            }
        }
    }

    if let Some(cwd) = current_dir {
        for ancestor in cwd.ancestors() {
            if has_backend_entrypoint(ancestor) {
                return Some(ancestor.to_path_buf());
            }
        }
    }

    None
}

pub fn resolve_portable_root() -> Result<PathBuf, String> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf));
    let cwd = std::env::current_dir().ok();

    resolve_portable_root_from(exe_dir.as_deref(), cwd.as_deref()).ok_or_else(|| {
        "Unable to locate portable root directory containing backend/app/main.py".to_string()
    })
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

    fn create_backend_entrypoint(root: &Path) {
        let app_dir = root.join("backend").join("app");
        std::fs::create_dir_all(&app_dir).unwrap();
        std::fs::write(app_dir.join("main.py"), "app = object()\n").unwrap();
    }

    #[test]
    fn test_resolve_portable_root_from_exe_dir() {
        let tmp = TempDir::new().unwrap();
        create_backend_entrypoint(tmp.path());

        let resolved = resolve_portable_root_from(Some(tmp.path()), None);
        assert_eq!(resolved.as_deref(), Some(tmp.path()));
    }

    #[test]
    fn test_resolve_portable_root_from_dev_ancestor() {
        let tmp = TempDir::new().unwrap();
        create_backend_entrypoint(tmp.path());
        let target_debug = tmp.path().join("desktop").join("target").join("debug");
        std::fs::create_dir_all(&target_debug).unwrap();

        let resolved = resolve_portable_root_from(Some(&target_debug), None);
        assert_eq!(resolved.as_deref(), Some(tmp.path()));
    }

    #[test]
    fn test_resolve_portable_root_from_cwd_fallback() {
        let tmp = TempDir::new().unwrap();
        create_backend_entrypoint(tmp.path());
        let unrelated_exe_dir = TempDir::new().unwrap();
        let nested_cwd = tmp.path().join("desktop");
        std::fs::create_dir_all(&nested_cwd).unwrap();

        let resolved =
            resolve_portable_root_from(Some(unrelated_exe_dir.path()), Some(&nested_cwd));
        assert_eq!(resolved.as_deref(), Some(tmp.path()));
    }

    #[test]
    fn test_resolve_portable_root_returns_none_when_missing() {
        let tmp = TempDir::new().unwrap();
        assert_eq!(
            resolve_portable_root_from(Some(tmp.path()), Some(tmp.path())),
            None
        );
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

        // Closed port must return false
        assert!(!is_health_ok(&url, Duration::from_millis(300)));
    }
}
