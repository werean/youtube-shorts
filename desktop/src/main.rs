#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::{Arc, Mutex};
use tauri::Manager;
use youtube_shorts_desktop::backend::{self, BackendProcess};
use youtube_shorts_desktop::updater::{self, UpdateOutcome};

struct BackendState(Arc<Mutex<Option<BackendProcess>>>);

fn main() {
    let portable_root = match backend::resolve_portable_root() {
        Ok(root) => root,
        Err(err) => {
            eprintln!("[desktop] Fatal: {err}");
            std::process::exit(1);
        }
    };

    match updater::check_and_apply_startup_update(&portable_root, None) {
        Ok(UpdateOutcome::RestartScheduled {
            version,
            script_path,
        }) => {
            eprintln!(
                "[updater] Update {version} staged; executing {} and exiting.",
                script_path.display()
            );
            std::process::exit(0);
        }
        Ok(UpdateOutcome::Disabled) => {}
        Ok(UpdateOutcome::UpToDate { current, latest }) => {
            eprintln!("[updater] Up to date (current={current}, latest={latest}).");
        }
        Ok(UpdateOutcome::NoPortableAsset { latest }) => {
            eprintln!("[updater] Release {latest} has no portable zip asset; continuing.");
        }
        Err(err) => {
            eprintln!("[updater] Startup update check skipped due to error: {err}");
        }
    }

    let backend_proc = match backend::start_or_attach_backend(&portable_root) {
        Ok(proc_handle) => proc_handle,
        Err(err) => {
            eprintln!("[backend] Failed to start Python FastAPI backend: {err}");
            std::process::exit(1);
        }
    };

    let shared_backend = Arc::new(Mutex::new(Some(backend_proc)));

    let app = tauri::Builder::default()
        .manage(BackendState(shared_backend))
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building YouTube Shorts desktop application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            let state = app_handle.state::<BackendState>();
            let proc_handle = state.0.lock().ok().and_then(|mut guard| guard.take());
            if let Some(mut handle) = proc_handle {
                handle.shutdown();
            }
        }
    });
}
