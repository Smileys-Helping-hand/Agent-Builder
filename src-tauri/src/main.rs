#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::net::{SocketAddr, TcpStream};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::api::process::{Command, CommandChild, CommandEvent};
use tauri::{Manager, RunEvent};

/// Origins the bundled dashboard is served from: Tauri 1 uses
/// https://tauri.localhost on Windows and tauri://localhost elsewhere.
const APP_ORIGINS: &str = "https://tauri.localhost,tauri://localhost";

/// The running API sidecar. Held so it can be killed when the app exits:
/// Tauri 1's CommandChild does not terminate its process when dropped, so
/// without an explicit kill, closing the window left the API running in the
/// background, still holding ports 4000/9464/35000.
struct ApiSidecar(Mutex<Option<CommandChild>>);

/// Start the bundled Node API as a sidecar and keep its output in the log.
///
/// Without this the packaged desktop app shipped a dashboard with no backend:
/// every request from the UI to http://localhost:4000 failed, because nothing
/// ever started the API process.
fn spawn_api_sidecar(app: &tauri::AppHandle) {
    // The API keeps its databases under ./data relative to its working
    // directory. An installed app's working directory (e.g. C:\Program Files\
    // Agent Builder) isn't writable by a normal user, so run the sidecar in the
    // per-user app data directory instead.
    let data_root = app
        .path_resolver()
        .app_data_dir()
        .unwrap_or_else(std::env::temp_dir);
    if let Err(error) = std::fs::create_dir_all(&data_root) {
        eprintln!(
            "[agent-builder] could not create app data directory {}: {error}",
            data_root.display()
        );
    }

    // The dashboard is served from Tauri's own origin rather than
    // http://localhost:3000, so the API has to allow it for CORS and Socket.io.
    let mut env = HashMap::new();
    env.insert("ALLOWED_ORIGINS".to_string(), APP_ORIGINS.to_string());
    env.insert("DASHBOARD_URL".to_string(), "https://tauri.localhost".to_string());
    // Tells the API to exit when this app does, even after a crash or force-quit
    // (see the stdin watchdog in src/server/server.ts).
    env.insert("AGENT_BUILDER_SIDECAR".to_string(), "1".to_string());

    let sidecar = match Command::new_sidecar("agent-builder-api") {
        Ok(command) => command.current_dir(data_root.clone()).envs(env),
        Err(error) => {
            eprintln!("[agent-builder] API sidecar not found: {error}");
            return;
        }
    };

    match sidecar.spawn() {
        Ok((mut rx, child)) => {
            println!("[agent-builder] API sidecar started in {}", data_root.display());
            if let Some(state) = app.try_state::<ApiSidecar>() {
                *state.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(child);
            }

            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => println!("[api] {line}"),
                        CommandEvent::Stderr(line) => eprintln!("[api] {line}"),
                        CommandEvent::Error(error) => eprintln!("[api] error: {error}"),
                        CommandEvent::Terminated(payload) => {
                            eprintln!("[api] exited with {:?}", payload.code);
                            break;
                        }
                        _ => {}
                    }
                }
            });
        }
        Err(error) => eprintln!("[agent-builder] failed to start API sidecar: {error}"),
    }
}

/// Show the window once the API accepts connections.
///
/// The window is hidden in tauri.conf.json because the dashboard fires its first
/// requests the instant it loads, and while the sidecar was still starting they
/// all failed with ERR_CONNECTION_REFUSED. The first-run setup wizard renders
/// nothing until its status request returns, so a fresh install showed a
/// dashboard with no way to create the first account until the user reloaded by
/// hand.
fn show_window_when_api_is_ready(handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        let port: u16 = std::env::var("PORT")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(4000);
        let address = SocketAddr::from(([127, 0, 0, 1], port));
        let deadline = Instant::now() + Duration::from_secs(60);
        while Instant::now() < deadline {
            if TcpStream::connect_timeout(&address, Duration::from_millis(500)).is_ok() {
                break;
            }
            std::thread::sleep(Duration::from_millis(250));
        }
        // Show it either way: a window whose panels report errors is better than
        // an app that never appears because its API failed to start.
        for window in handle.windows().values() {
            let _ = window.show();
            let _ = window.set_focus();
        }
    });
}

fn stop_api_sidecar(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<ApiSidecar>() {
        let child = state.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).take();
        if let Some(child) = child {
            if let Err(error) = child.kill() {
                eprintln!("[agent-builder] failed to stop API sidecar: {error}");
            }
        }
    }
}

fn main() {
    tauri::Builder::default()
        .manage(ApiSidecar(Mutex::new(None)))
        .setup(|app| {
            spawn_api_sidecar(&app.handle());
            show_window_when_api_is_ready(app.handle());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Agent Builder desktop application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                stop_api_sidecar(app);
            }
        });
}
