import { invoke } from "@tauri-apps/api/core";

export interface ClaudeLaunch {
  /** command to type into the shell — bare `claude` once the global hook is in */
  command: string;
  endpoint: string;
  /** true when the bridge was installed into ~/.claude/settings.json globally */
  global: boolean;
  settingsPath?: string;
  warning?: string;
}

/** Ensure the Claude Code → Aether hook bridge is installed and get the launch
 * command. By default the bridge is merged into the user's global Claude
 * settings (idempotently, with a backup) so any `claude` session is monitored. */
export function setupClaudeMonitoring(): Promise<ClaudeLaunch> {
  return invoke<ClaudeLaunch>("setup_claude_monitoring");
}

/** Remove the bridge from ~/.claude/settings.json (user hooks left intact). */
export function uninstallGlobalHook(): Promise<{ changed: boolean }> {
  return invoke("uninstall_global_hook");
}
