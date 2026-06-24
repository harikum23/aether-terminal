import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Thin typed wrapper around the Rust PTY commands + events. */

export function spawn(
  id: string,
  cols: number,
  rows: number,
  cwd?: string,
): Promise<void> {
  return invoke("pty_spawn", { id, cols, rows, cwd });
}

export function write(id: string, data: string): Promise<void> {
  return invoke("pty_write", { id, data });
}

export function resize(id: string, cols: number, rows: number): Promise<void> {
  return invoke("pty_resize", { id, cols, rows });
}

export function kill(id: string): Promise<void> {
  return invoke("pty_kill", { id });
}

/** Best-effort current working directory of a session's shell (null if unknown). */
export function cwd(id: string): Promise<string | null> {
  return invoke<string | null>("pty_cwd", { id });
}

export function onOutput(
  id: string,
  cb: (bytes: Uint8Array) => void,
): Promise<UnlistenFn> {
  return listen<number[]>(`pty://output/${id}`, (e) => {
    cb(new Uint8Array(e.payload));
  });
}

export function onExit(id: string, cb: () => void): Promise<UnlistenFn> {
  return listen(`pty://exit/${id}`, () => cb());
}
