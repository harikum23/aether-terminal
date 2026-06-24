use std::collections::HashMap;
use std::io::{Read, Write};
use std::thread;

use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use tauri::{Emitter, State};

/// A single live PTY session: the master side (for resize), a writer (for
/// stdin) and the spawned child process (for kill).
struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    /// OS pid of the shell, used to look up the session's working directory
    /// when a project snapshot is saved. `None` if the platform didn't report one.
    pid: Option<u32>,
}

/// Holds every open terminal keyed by a frontend-supplied id.
#[derive(Default)]
pub struct PtyManager {
    sessions: Mutex<HashMap<String, PtySession>>,
}

fn default_shell() -> String {
    if cfg!(windows) {
        std::env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".into())
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into())
    }
}

/// Spawn a shell attached to a freshly opened PTY and stream its output back to
/// the webview via `pty://output/{id}` events.
#[tauri::command]
pub fn pty_spawn(
    app: tauri::AppHandle,
    state: State<'_, PtyManager>,
    id: String,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
) -> Result<(), String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let shell = default_shell();
    let mut cmd = CommandBuilder::new(&shell);
    // Login shell so the user's full environment (PATH, aliases) is loaded.
    if !cfg!(windows) {
        cmd.arg("-l");
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "Aether");
    // Every shell knows where to report agent telemetry, so a hand-typed
    // `claude` (or any AAP-aware tool) in any tab is auto-detected — the
    // Claude Code hook reads AETHER_ENDPOINT and POSTs lifecycle events here.
    cmd.env(
        "AETHER_ENDPOINT",
        format!("http://127.0.0.1:{}/ingest", crate::ingest::PORT),
    );

    let start_dir = cwd
        .filter(|p| !p.is_empty())
        .or_else(|| std::env::var("HOME").ok());
    if let Some(dir) = start_dir {
        cmd.cwd(dir);
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| e.to_string())?;
    let pid = child.process_id();

    // The slave handle must be dropped so the kernel reports EOF when the
    // child exits, otherwise the reader thread blocks forever.
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let output_event = format!("pty://output/{id}");
    let exit_event = format!("pty://exit/{id}");
    let app_for_thread = app.clone();

    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    // Send raw bytes; the frontend reassembles them so partial
                    // UTF-8 / escape sequences survive chunk boundaries.
                    let _ = app_for_thread.emit(&output_event, buf[..n].to_vec());
                }
                Err(_) => break,
            }
        }
        let _ = app_for_thread.emit(&exit_event, ());
    });

    state.sessions.lock().insert(
        id,
        PtySession {
            master: pair.master,
            writer,
            child,
            pid,
        },
    );

    Ok(())
}

/// Best-effort current working directory of a session's shell. Used when
/// saving a project so each pane can be reopened where it was left. Returns
/// `None` rather than erroring when the directory can't be determined.
#[tauri::command]
pub fn pty_cwd(state: State<'_, PtyManager>, id: String) -> Result<Option<String>, String> {
    let pid = {
        let sessions = state.sessions.lock();
        match sessions.get(&id) {
            Some(s) => s.pid,
            None => return Ok(None),
        }
    };
    Ok(pid.and_then(cwd_of_pid))
}

/// Resolve a pid's working directory. Implementation is per-platform; any
/// failure (missing tool, permission, dead process) collapses to `None`.
#[cfg(target_os = "linux")]
fn cwd_of_pid(pid: u32) -> Option<String> {
    std::fs::read_link(format!("/proc/{pid}/cwd"))
        .ok()
        .and_then(|p| p.to_str().map(str::to_owned))
}

#[cfg(target_os = "macos")]
fn cwd_of_pid(pid: u32) -> Option<String> {
    // macOS has no /proc; `lsof` reports the cwd file descriptor. `-Fn` emits
    // machine-readable records where the cwd path is the field prefixed with 'n'.
    let out = std::process::Command::new("/usr/sbin/lsof")
        .args(["-a", "-p", &pid.to_string(), "-d", "cwd", "-Fn"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .find_map(|line| line.strip_prefix('n').map(str::to_owned))
        .filter(|p| !p.is_empty())
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn cwd_of_pid(_pid: u32) -> Option<String> {
    None
}

/// Forward keystrokes / pasted text to the shell.
#[tauri::command]
pub fn pty_write(state: State<'_, PtyManager>, id: String, data: String) -> Result<(), String> {
    let mut sessions = state.sessions.lock();
    let session = sessions
        .get_mut(&id)
        .ok_or_else(|| format!("no pty session: {id}"))?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
    session.writer.flush().map_err(|e| e.to_string())?;
    Ok(())
}

/// Resize the PTY when the terminal viewport changes.
#[tauri::command]
pub fn pty_resize(
    state: State<'_, PtyManager>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state.sessions.lock();
    let session = sessions
        .get(&id)
        .ok_or_else(|| format!("no pty session: {id}"))?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Kill the shell and drop the session.
#[tauri::command]
pub fn pty_kill(state: State<'_, PtyManager>, id: String) -> Result<(), String> {
    if let Some(mut session) = state.sessions.lock().remove(&id) {
        let _ = session.child.kill();
    }
    Ok(())
}
