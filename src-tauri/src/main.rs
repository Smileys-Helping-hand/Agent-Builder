#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::api::process::{Command, CommandEvent};
use tauri::Manager;

/// Start the bundled Node API as a sidecar and keep its output in the log.
///
/// Without this the packaged desktop app shipped a dashboard with no backend:
/// every request from the UI to http://127.0.0.1:4000 failed, because nothing
/// ever started the API process.
fn spawn_api_sidecar(app: &tauri::AppHandle) {
    let sidecar = match Command::new_sidecar("agent-builder-api") {
        Ok(command) => command,
        Err(error) => {
            eprintln!("[agent-builder] API sidecar not found: {error}");
            return;
        }
    };

    match sidecar.spawn() {
        Ok((mut rx, child)) => {
            // Hold the child for the app's lifetime so it is terminated when
            // the window closes instead of outliving it.
            app.manage(child);

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

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            spawn_api_sidecar(&app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Agent Builder desktop application");
}
