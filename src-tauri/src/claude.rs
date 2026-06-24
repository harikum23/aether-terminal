use std::fs;
use std::path::PathBuf;

use serde_json::{json, Value};

use crate::ingest;

/// The hook bridge is embedded at compile time so the bundled app carries it.
const HOOK_SCRIPT: &str = include_str!("../../examples/claude_code_hook.py");

/// Claude Code lifecycle hooks we attach the bridge to.
const EVENTS: [&str; 4] = ["PreToolUse", "PostToolUse", "SubagentStop", "Stop"];

/// Stable substring identifying a hook command as ours, independent of the
/// absolute home path — so an entry left by an older/moved install is still
/// recognised (and refreshed) rather than duplicated.
const HOOK_MARKER: &str = ".aether/claude_hook.py";

fn aether_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let dir = PathBuf::from(home).join(".aether");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn claude_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let dir = PathBuf::from(home).join(".claude");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Write the hook script into `~/.aether/` and return
/// `(launch command, absolute hook path)`. The path doubles as the marker we
/// use to recognise our own entries when merging/removing global settings.
fn materialize_hook() -> Result<(String, String), String> {
    let dir = aether_dir()?;
    let hook_path = dir.join("claude_hook.py");
    fs::write(&hook_path, HOOK_SCRIPT).map_err(|e| e.to_string())?;
    let path = hook_path.to_string_lossy().into_owned();
    let cmd = format!("/usr/bin/env python3 {}", shell_quote(&path));
    Ok((cmd, path))
}

/// One settings "matcher group" that runs our hook command.
fn our_group(hook_cmd: &str) -> Value {
    json!({ "hooks": [ { "type": "command", "command": hook_cmd } ] })
}

/// Is this matcher group one WE installed? (any command references our script)
fn group_is_ours(group: &Value, marker: &str) -> bool {
    group
        .get("hooks")
        .and_then(|h| h.as_array())
        .map(|hooks| {
            hooks.iter().any(|hk| {
                hk.get("command")
                    .and_then(|c| c.as_str())
                    .is_some_and(|s| s.contains(marker))
            })
        })
        .unwrap_or(false)
}

/// Read `settings.json` as an object, tolerating missing/empty/garbage files.
fn read_settings(path: &PathBuf) -> Value {
    match fs::read_to_string(path) {
        Ok(s) if !s.trim().is_empty() => {
            let v: Value = serde_json::from_str(&s).unwrap_or_else(|_| json!({}));
            if v.is_object() {
                v
            } else {
                json!({})
            }
        }
        _ => json!({}),
    }
}

/// Merge our hook into every lifecycle event, replacing any stale copy of ours
/// (so re-running after an app update refreshes the path) while leaving the
/// user's own hooks untouched.
fn apply_hook(settings: &mut Value, hook_cmd: &str, marker: &str) {
    let group = our_group(hook_cmd);
    let obj = settings.as_object_mut().expect("settings is an object");
    let hooks = obj.entry("hooks").or_insert_with(|| json!({}));
    if !hooks.is_object() {
        *hooks = json!({});
    }
    let hooks = hooks.as_object_mut().unwrap();
    for ev in EVENTS {
        let arr = hooks.entry(ev).or_insert_with(|| json!([]));
        if !arr.is_array() {
            *arr = json!([]);
        }
        let a = arr.as_array_mut().unwrap();
        a.retain(|g| !group_is_ours(g, marker));
        a.push(group.clone());
    }
}

/// Remove only our hook entries, then prune any arrays/objects we emptied.
fn remove_hook(settings: &mut Value, marker: &str) {
    if let Some(hooks) = settings.get_mut("hooks").and_then(|h| h.as_object_mut()) {
        for ev in EVENTS {
            if let Some(a) = hooks.get_mut(ev).and_then(|x| x.as_array_mut()) {
                a.retain(|g| !group_is_ours(g, marker));
            }
        }
        let empties: Vec<String> = hooks
            .iter()
            .filter(|(_, v)| v.as_array().is_some_and(|a| a.is_empty()))
            .map(|(k, _)| k.clone())
            .collect();
        for k in empties {
            hooks.remove(&k);
        }
    }
    if settings
        .get("hooks")
        .and_then(|h| h.as_object())
        .is_some_and(|o| o.is_empty())
    {
        settings.as_object_mut().unwrap().remove("hooks");
    }
}

fn write_settings(path: &PathBuf, settings: &Value) -> Result<(), String> {
    let mut text = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    text.push('\n');
    fs::write(path, text).map_err(|e| e.to_string())
}

/// Install the bridge into `~/.claude/settings.json` so EVERY `claude` session
/// — including a hand-typed one in any terminal tab — is auto-detected. The
/// merge is idempotent and additive: existing user hooks are preserved, and a
/// one-time `settings.json.aether-bak` backup is kept for easy recovery.
#[tauri::command]
pub fn install_global_hook() -> Result<Value, String> {
    let (hook_cmd, marker) = materialize_hook()?;
    let dir = claude_dir()?;
    let settings_path = dir.join("settings.json");

    let mut settings = read_settings(&settings_path);
    let before = serde_json::to_string(&settings).unwrap_or_default();
    // ownership is matched by the stable HOOK_MARKER fragment, not the abs path
    apply_hook(&mut settings, &hook_cmd, HOOK_MARKER);
    let after = serde_json::to_string(&settings).unwrap_or_default();
    let changed = before != after;

    if changed {
        // back up the user's original settings once, before we ever touch them
        if settings_path.exists() {
            let bak = dir.join("settings.json.aether-bak");
            if !bak.exists() {
                let _ = fs::copy(&settings_path, &bak);
            }
        }
        write_settings(&settings_path, &settings)?;
    }

    Ok(json!({
        "settingsPath": settings_path.to_string_lossy(),
        "hookScript": marker,
        "endpoint": format!("http://127.0.0.1:{}/ingest", ingest::PORT),
        "changed": changed,
    }))
}

/// Remove the bridge from `~/.claude/settings.json`, leaving user hooks intact.
#[tauri::command]
pub fn uninstall_global_hook() -> Result<Value, String> {
    let dir = claude_dir()?;
    let settings_path = dir.join("settings.json");
    if !settings_path.exists() {
        return Ok(json!({ "changed": false }));
    }
    let mut settings = read_settings(&settings_path);
    let before = serde_json::to_string(&settings).unwrap_or_default();
    remove_hook(&mut settings, HOOK_MARKER);
    let after = serde_json::to_string(&settings).unwrap_or_default();
    let changed = before != after;
    if changed {
        write_settings(&settings_path, &settings)?;
    }
    Ok(json!({ "changed": changed }))
}

/// Best-effort install used at app startup; never blocks launch.
pub fn ensure_global_hook() {
    if let Err(e) = install_global_hook() {
        eprintln!("aether: could not install global Claude hook: {e}");
    }
}

/// Return a ready-to-run launch command for a monitored Claude Code session.
///
/// With the global hook installed, a bare `claude` is already monitored, so the
/// command is just `claude`. If the global install can't be written, we fall
/// back to the non-invasive per-session `--settings` layer.
#[tauri::command]
pub fn setup_claude_monitoring() -> Result<Value, String> {
    let endpoint = format!("http://127.0.0.1:{}/ingest", ingest::PORT);

    match install_global_hook() {
        Ok(info) => Ok(json!({
            "command": "claude",
            "endpoint": endpoint,
            "global": true,
            "settingsPath": info.get("settingsPath").cloned().unwrap_or(Value::Null),
        })),
        Err(global_err) => {
            // Fallback: merge a session-only settings layer via `--settings`.
            let (hook_cmd, _) = materialize_hook()?;
            let mut settings = json!({ "hooks": {} });
            apply_hook(&mut settings, &hook_cmd, "claude_hook.py");
            let settings_path = aether_dir()?.join("claude-hooks.settings.json");
            write_settings(&settings_path, &settings)?;
            let command = format!(
                "AETHER_ENDPOINT={} claude --settings {}",
                endpoint,
                shell_quote(&settings_path.to_string_lossy()),
            );
            Ok(json!({
                "command": command,
                "endpoint": endpoint,
                "global": false,
                "settingsPath": settings_path.to_string_lossy(),
                "warning": format!("global install failed: {global_err}"),
            }))
        }
    }
}

/// Minimal POSIX single-quote escaping for embedding a path in a shell command.
fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const CMD: &str = "/usr/bin/env python3 '/home/u/.aether/claude_hook.py'";
    const MARKER: &str = HOOK_MARKER;

    fn count_our_groups(settings: &Value, ev: &str) -> usize {
        settings["hooks"][ev]
            .as_array()
            .map(|a| a.iter().filter(|g| group_is_ours(g, MARKER)).count())
            .unwrap_or(0)
    }

    #[test]
    fn install_is_idempotent() {
        let mut s = json!({});
        apply_hook(&mut s, CMD, MARKER);
        let once = s.clone();
        apply_hook(&mut s, CMD, MARKER); // simulate a second app launch
        assert_eq!(s, once, "re-applying must not duplicate entries");
        for ev in EVENTS {
            assert_eq!(count_our_groups(&s, ev), 1, "exactly one entry per event");
        }
    }

    #[test]
    fn preserves_user_hooks_and_other_settings() {
        let mut s = json!({
            "model": "opus",
            "hooks": {
                "PreToolUse": [
                    { "hooks": [{ "type": "command", "command": "my-own-linter" }] }
                ]
            }
        });
        apply_hook(&mut s, CMD, MARKER);
        // user's unrelated setting survives
        assert_eq!(s["model"], json!("opus"));
        // user's own PreToolUse hook survives alongside ours
        let pre = s["hooks"]["PreToolUse"].as_array().unwrap();
        assert!(pre.iter().any(|g| g["hooks"][0]["command"] == json!("my-own-linter")));
        assert_eq!(count_our_groups(&s, "PreToolUse"), 1);
    }

    #[test]
    fn uninstall_removes_only_ours() {
        let mut s = json!({
            "hooks": {
                "PreToolUse": [
                    { "hooks": [{ "type": "command", "command": "my-own-linter" }] }
                ]
            }
        });
        apply_hook(&mut s, CMD, MARKER);
        remove_hook(&mut s, MARKER);
        // ours gone everywhere
        for ev in EVENTS {
            assert_eq!(count_our_groups(&s, ev), 0);
        }
        // user's hook remains; empty arrays we created are pruned
        assert_eq!(
            s["hooks"]["PreToolUse"][0]["hooks"][0]["command"],
            json!("my-own-linter")
        );
        assert!(s["hooks"].get("Stop").is_none(), "empty Stop array pruned");
    }

    #[test]
    fn stale_entry_is_refreshed_not_duplicated() {
        // an older install used a different path; ours should replace it
        let stale = "/old/path/.aether/claude_hook.py";
        let mut s = json!({});
        apply_hook(&mut s, &format!("/usr/bin/env python3 '{stale}'"), stale);
        apply_hook(&mut s, CMD, MARKER);
        assert_eq!(count_our_groups(&s, "Stop"), 1);
        // the stale one is gone
        let arr = s["hooks"]["Stop"].as_array().unwrap();
        assert!(!arr.iter().any(|g| group_is_ours(g, stale)));
    }
}
