#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use youtube_shorts_desktop::backend::{self, BackendProcess, RuntimeMode};
use youtube_shorts_desktop::updater::{self, UpdateOutcome, EXE_ASSET_NAME};

const APP_WINDOW_TITLE: &str = "YouTube Shorts";
const SINGLE_INSTANCE_MUTEX_NAME: &str = "Local\\YouTubeShortsPortableInstance";

struct BackendLifecycle {
    process: Option<BackendProcess>,
    shutting_down: bool,
}

struct BackendState {
    inner: Arc<Mutex<BackendLifecycle>>,
}

fn is_shutting_down(lifecycle: &Mutex<BackendLifecycle>) -> bool {
    lifecycle
        .lock()
        .map(|guard| guard.shutting_down)
        .unwrap_or(true)
}

fn shutdown_backend_lifecycle(lifecycle: &Mutex<BackendLifecycle>) {
    let proc_handle = if let Ok(mut guard) = lifecycle.lock() {
        guard.shutting_down = true;
        guard.process.take()
    } else {
        None
    };
    if let Some(mut handle) = proc_handle {
        handle.shutdown();
    }
}

#[cfg(windows)]
mod win32 {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr;

    pub type HANDLE = *mut core::ffi::c_void;
    pub type HWND = *mut core::ffi::c_void;
    pub type BOOL = i32;
    pub type DWORD = u32;
    pub type UINT = u32;

    const ERROR_ALREADY_EXISTS: DWORD = 183;
    const SW_SHOW: i32 = 5;
    const SW_RESTORE: i32 = 9;
    const MB_OK: UINT = 0x0000_0000;
    const MB_ICONERROR: UINT = 0x0000_0010;
    const MB_SETFOREGROUND: UINT = 0x0001_0000;

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateMutexW(
            lp_mutex_attributes: *mut core::ffi::c_void,
            b_initial_owner: BOOL,
            lp_name: *const u16,
        ) -> HANDLE;
        fn GetLastError() -> DWORD;
        fn CloseHandle(h_object: HANDLE) -> BOOL;
    }

    #[link(name = "user32")]
    extern "system" {
        fn FindWindowW(lp_class_name: *const u16, lp_window_name: *const u16) -> HWND;
        fn ShowWindow(h_wnd: HWND, n_cmd_show: i32) -> BOOL;
        fn IsIconic(h_wnd: HWND) -> BOOL;
        fn SetForegroundWindow(h_wnd: HWND) -> BOOL;
        fn MessageBoxW(
            h_wnd: HWND,
            lp_text: *const u16,
            lp_caption: *const u16,
            u_type: UINT,
        ) -> i32;
    }

    fn to_wide(s: &str) -> Vec<u16> {
        OsStr::new(s).encode_wide().chain(Some(0)).collect()
    }

    pub struct SingleInstanceGuard {
        handle: HANDLE,
    }

    impl Drop for SingleInstanceGuard {
        fn drop(&mut self) {
            if !self.handle.is_null() {
                unsafe {
                    CloseHandle(self.handle);
                }
                self.handle = ptr::null_mut();
            }
        }
    }

    pub fn acquire_single_instance(mutex_name: &str) -> Result<Option<SingleInstanceGuard>, String> {
        let name_w = to_wide(mutex_name);
        unsafe {
            let handle = CreateMutexW(ptr::null_mut(), 0, name_w.as_ptr());
            let last_err = GetLastError();
            if last_err == ERROR_ALREADY_EXISTS {
                if !handle.is_null() {
                    CloseHandle(handle);
                }
                return Ok(None);
            }
            if handle.is_null() {
                return Err(format!("CreateMutexW failed with Win32 error {last_err}"));
            }
            Ok(Some(SingleInstanceGuard { handle }))
        }
    }

    pub fn focus_existing_window(title: &str) -> bool {
        let title_w = to_wide(title);
        unsafe {
            let hwnd = FindWindowW(ptr::null(), title_w.as_ptr());
            if hwnd.is_null() {
                return false;
            }
            if IsIconic(hwnd) != 0 {
                ShowWindow(hwnd, SW_RESTORE);
            } else {
                ShowWindow(hwnd, SW_SHOW);
            }
            SetForegroundWindow(hwnd);
            true
        }
    }

    pub fn show_error_dialog(title: &str, message: &str) {
        let title_w = to_wide(title);
        let msg_w = to_wide(message);
        unsafe {
            MessageBoxW(
                ptr::null_mut(),
                msg_w.as_ptr(),
                title_w.as_ptr(),
                MB_OK | MB_ICONERROR | MB_SETFOREGROUND,
            );
        }
    }
}

#[cfg(not(windows))]
mod win32 {
    pub struct SingleInstanceGuard;

    pub fn acquire_single_instance(
        _mutex_name: &str,
    ) -> Result<Option<SingleInstanceGuard>, String> {
        Ok(Some(SingleInstanceGuard))
    }

    pub fn focus_existing_window(_title: &str) -> bool {
        false
    }

    pub fn show_error_dialog(_title: &str, _message: &str) {}
}

fn fallback_log_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf))
        .unwrap_or_else(std::env::temp_dir)
}

fn report_fatal_error(log_root: &Path, message: &str) {
    eprintln!("[desktop] Fatal: {message}");
    backend::append_startup_log(log_root, &format!("[fatal] {message}"));
    win32::show_error_dialog("YouTube Shorts - Startup Error", message);
}

fn spawn_background_startup(
    app_handle: tauri::AppHandle,
    window: tauri::WebviewWindow,
    runtime_mode: RuntimeMode,
    portable_root: PathBuf,
    lifecycle: Arc<Mutex<BackendLifecycle>>,
) {
    std::thread::spawn(move || {
        backend::append_startup_log(
            &portable_root,
            &format!("[desktop] Background startup started in {:?}", runtime_mode),
        );

        if matches!(runtime_mode, RuntimeMode::Portable(_)) {
            match updater::check_and_apply_startup_update(&portable_root, None) {
                Ok(UpdateOutcome::RestartScheduled {
                    version,
                    script_path,
                }) => {
                    let msg = format!(
                        "[updater] Update {version} downloaded; executing {} and exiting.",
                        script_path.display()
                    );
                    eprintln!("{msg}");
                    backend::append_startup_log(&portable_root, &msg);
                    shutdown_backend_lifecycle(&lifecycle);
                    app_handle.exit(0);
                    return;
                }
                Ok(UpdateOutcome::Disabled) => {}
                Ok(UpdateOutcome::UpToDate { current, latest }) => {
                    let msg = format!("[updater] Up to date (current={current}, latest={latest}).");
                    eprintln!("{msg}");
                    backend::append_startup_log(&portable_root, &msg);
                }
                Ok(UpdateOutcome::NoPortableAsset { latest }) => {
                    let msg = format!(
                        "[updater] Release {latest} has no {EXE_ASSET_NAME} asset; continuing."
                    );
                    eprintln!("{msg}");
                    backend::append_startup_log(&portable_root, &msg);
                }
                Err(err) => {
                    let msg = format!("[updater] Startup update check skipped due to error: {err}");
                    eprintln!("{msg}");
                    backend::append_startup_log(&portable_root, &msg);
                }
            }
        }

        if is_shutting_down(&lifecycle) {
            return;
        }

        if let Err(err) = backend::ensure_embedded_runtime(&portable_root) {
            if !is_shutting_down(&lifecycle) {
                report_fatal_error(
                    &portable_root,
                    &format!("Failed to prepare embedded runtime:\n{err}"),
                );
                shutdown_backend_lifecycle(&lifecycle);
                app_handle.exit(1);
            }
            return;
        }

        if is_shutting_down(&lifecycle) {
            return;
        }

        match backend::start_or_attach_backend(&portable_root) {
            Ok(proc_handle) => {
                let rejected = if let Ok(mut guard) = lifecycle.lock() {
                    if guard.shutting_down {
                        Some(proc_handle)
                    } else {
                        guard.process = Some(proc_handle);
                        None
                    }
                } else {
                    Some(proc_handle)
                };

                if let Some(mut handle) = rejected {
                    handle.shutdown();
                    return;
                }

                backend::append_startup_log(
                    &portable_root,
                    "[backend] FastAPI backend is ready; reloading main window.",
                );
                let _ = window.eval("window.location.reload();");
            }
            Err(err) => {
                if !is_shutting_down(&lifecycle) {
                    report_fatal_error(
                        &portable_root,
                        &format!("Failed to start Python FastAPI backend:\n{err}"),
                    );
                    shutdown_backend_lifecycle(&lifecycle);
                    app_handle.exit(1);
                }
            }
        }
    });
}

fn main() {
    let runtime_mode = match backend::resolve_runtime_mode() {
        Ok(mode) => mode,
        Err(err) => {
            let log_root = fallback_log_dir();
            report_fatal_error(&log_root, &err);
            std::process::exit(1);
        }
    };
    let portable_root = runtime_mode.root().to_path_buf();

    let _instance_guard = match win32::acquire_single_instance(SINGLE_INSTANCE_MUTEX_NAME) {
        Ok(Some(guard)) => Some(guard),
        Ok(None) => {
            win32::focus_existing_window(APP_WINDOW_TITLE);
            std::process::exit(0);
        }
        Err(err) => {
            backend::append_startup_log(
                &portable_root,
                &format!("[desktop] Warning: failed to acquire single-instance mutex: {err}"),
            );
            None
        }
    };

    let webview_dir = backend::resolve_webview_data_dir(&runtime_mode);
    if let Err(err) = std::fs::create_dir_all(&webview_dir) {
        report_fatal_error(
            &portable_root,
            &format!(
                "Failed to create WebView2 data directory {}:\n{err}",
                webview_dir.display()
            ),
        );
        std::process::exit(1);
    }

    let shared_lifecycle = Arc::new(Mutex::new(BackendLifecycle {
        process: None,
        shutting_down: false,
    }));

    let setup_runtime_mode = runtime_mode.clone();
    let setup_portable_root = portable_root.clone();
    let setup_webview_dir = webview_dir.clone();
    let setup_lifecycle = Arc::clone(&shared_lifecycle);

    let app = match tauri::Builder::default()
        .manage(BackendState {
            inner: Arc::clone(&shared_lifecycle),
        })
        .setup(move |app| {
            let window = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::App("index.html".into()),
            )
            .title(APP_WINDOW_TITLE)
            .inner_size(1280.0, 820.0)
            .resizable(true)
            .fullscreen(false)
            .data_directory(setup_webview_dir)
            .build()?;

            let _ = window.set_focus();

            spawn_background_startup(
                app.handle().clone(),
                window,
                setup_runtime_mode,
                setup_portable_root,
                setup_lifecycle,
            );

            Ok(())
        })
        .build(tauri::generate_context!())
    {
        Ok(app) => app,
        Err(err) => {
            report_fatal_error(
                &portable_root,
                &format!("Failed to initialize YouTube Shorts desktop application:\n{err}"),
            );
            std::process::exit(1);
        }
    };

    app.run(|app_handle, event| match event {
        RunEvent::WindowEvent {
            event: WindowEvent::CloseRequested { .. },
            ..
        } => {
            let state = app_handle.state::<BackendState>();
            shutdown_backend_lifecycle(&state.inner);
            app_handle.exit(0);
        }
        RunEvent::ExitRequested { .. } | RunEvent::Exit => {
            let state = app_handle.state::<BackendState>();
            shutdown_backend_lifecycle(&state.inner);
        }
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_backend_lifecycle_shutdown_marks_flag() {
        let lifecycle = Mutex::new(BackendLifecycle {
            process: None,
            shutting_down: false,
        });
        assert!(!is_shutting_down(&lifecycle));
        shutdown_backend_lifecycle(&lifecycle);
        assert!(is_shutting_down(&lifecycle));
    }

    #[cfg(windows)]
    #[test]
    fn test_single_instance_mutex_blocks_second_acquire_until_dropped() {
        let unique_name = format!(
            "Local\\YouTubeShortsTestMutex_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );

        let first = win32::acquire_single_instance(&unique_name).unwrap();
        assert!(first.is_some(), "first mutex acquisition should succeed");

        let second = win32::acquire_single_instance(&unique_name).unwrap();
        assert!(
            second.is_none(),
            "second mutex acquisition should report already running"
        );

        drop(first);

        let third = win32::acquire_single_instance(&unique_name).unwrap();
        assert!(
            third.is_some(),
            "mutex should be acquirable again after dropping guard"
        );
    }
}
