mod claude;
mod ingest;
mod ollama;
mod pty;

use pty::PtyManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(PtyManager::default())
        .setup(|app| {
            ingest::start(app.handle().clone(), ingest::PORT);
            // Make every terminal auto-monitor Claude: install the hook into the
            // user's global settings so a hand-typed `claude` is detected too.
            claude::ensure_global_hook();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            pty::pty_cwd,
            ingest::ingest_info,
            ingest::ingest_status,
            claude::setup_claude_monitoring,
            claude::install_global_hook,
            claude::uninstall_global_hook,
            ollama::ollama_list_models,
            ollama::ollama_test_connection,
            ollama::ollama_generate,
            ollama::ollama_cancel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running aether");
}
