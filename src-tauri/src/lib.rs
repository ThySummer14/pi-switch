use serde_json::Value;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::Manager;

fn project_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri must live under the project root")
        .to_path_buf()
}

fn node_binary() -> PathBuf {
    if let Some(path) = std::env::var_os("PI_SWITCH_NODE_BIN") {
        return PathBuf::from(path);
    }
    if let Some(home) = std::env::var_os("HOME") {
        let local = PathBuf::from(home).join(".local/bin/node");
        if local.exists() {
            return local;
        }
    }
    PathBuf::from("node")
}

fn run_bridge(app: tauri::AppHandle, action: String, payload: Value) -> Result<Value, String> {
    let root = project_root();
    let (bridge_path, core_dir, working_dir) = if cfg!(debug_assertions) {
        (root.join("desktop/bridge.mjs"), root.join("src"), root.clone())
    } else {
        let resources = app
            .path()
            .resource_dir()
            .map_err(|error| format!("failed to resolve application resources: {error}"))?;
        (
            resources.join("bridge.mjs"),
            resources.join("core"),
            resources,
        )
    };
    let mut child = Command::new(node_binary())
        .arg(bridge_path)
        .current_dir(working_dir)
        .env("PI_SWITCH_CORE_DIR", core_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("failed to start desktop bridge: {error}"))?;

    let request = serde_json::json!({ "action": action, "payload": payload });
    child
        .stdin
        .take()
        .ok_or_else(|| "desktop bridge stdin unavailable".to_string())?
        .write_all(request.to_string().as_bytes())
        .map_err(|error| format!("failed to send request to desktop bridge: {error}"))?;

    let output = child
        .wait_with_output()
        .map_err(|error| format!("desktop bridge failed: {error}"))?;
    let response: Value = serde_json::from_slice(&output.stdout).map_err(|error| {
        let stderr = String::from_utf8_lossy(&output.stderr);
        format!("desktop bridge returned invalid JSON: {error}; {stderr}")
    })?;
    if response.get("ok").and_then(Value::as_bool) == Some(true) {
        Ok(response.get("data").cloned().unwrap_or(Value::Null))
    } else {
        Err(response
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("desktop bridge failed")
            .to_string())
    }
}

#[tauri::command]
async fn bridge(app: tauri::AppHandle, action: String, payload: Value) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || run_bridge(app, action, payload))
        .await
        .map_err(|error| format!("desktop bridge task failed: {error}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![bridge])
        .run(tauri::generate_context!())
        .expect("error while running Pi Switch");
}
