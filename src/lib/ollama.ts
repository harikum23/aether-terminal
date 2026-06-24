import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Thin typed wrapper around the Rust Ollama commands + streaming events. */

export interface OllamaModel {
  name: string;
  size?: number;
  modifiedAt?: string;
}

export interface OllamaHealth {
  ok: boolean;
  modelCount: number;
  version?: string;
}

/** Done payload emitted on `ollama://done/{requestId}`. */
export interface OllamaDone {
  ok: boolean;
  evalCount?: number;
  totalDurationMs?: number;
}

export function listModels(baseUrl: string): Promise<OllamaModel[]> {
  return invoke("ollama_list_models", { baseUrl });
}

export function testConnection(baseUrl: string): Promise<OllamaHealth> {
  return invoke("ollama_test_connection", { baseUrl });
}

export function cancel(requestId: string): Promise<void> {
  return invoke("ollama_cancel", { requestId });
}

export interface GenerateArgs {
  baseUrl: string;
  model: string;
  prompt: string;
  system?: string;
  /** raw Ollama options blob (e.g. `{ temperature: 0.2 }`) */
  options?: Record<string, unknown>;
}

export interface GenerateHandlers {
  /** a streamed token delta */
  onToken: (token: string) => void;
  /** the stream finished cleanly */
  onDone: (info: OllamaDone) => void;
  /** the stream failed (connection refused, 404, parse error, …) */
  onError: (message: string) => void;
}

export interface GenerateHandle {
  requestId: string;
  /** trip the backend cancel flag and release listeners */
  cancel: () => void;
}

/**
 * Start a streaming generation. Listens to the three per-request channels,
 * unlistening ALL of them exactly once on done/error/cancel so repeated
 * palette triggers never leak listeners or double-render.
 */
export function generateStream(
  args: GenerateArgs,
  handlers: GenerateHandlers,
): GenerateHandle {
  const requestId = crypto.randomUUID();
  const unlisteners: UnlistenFn[] = [];
  let settled = false;

  const releaseAll = () => {
    for (const un of unlisteners) {
      try {
        un();
      } catch {
        /* listener already gone */
      }
    }
    unlisteners.length = 0;
  };

  /** Run a terminal handler once, then tear down every listener. */
  const settle = (fn: () => void) => {
    if (settled) return;
    settled = true;
    fn();
    releaseAll();
  };

  (async () => {
    try {
      unlisteners.push(
        await listen<string>(`ollama://token/${requestId}`, (e) => {
          if (!settled) handlers.onToken(e.payload);
        }),
      );
      unlisteners.push(
        await listen<OllamaDone>(`ollama://done/${requestId}`, (e) => {
          settle(() => handlers.onDone(e.payload));
        }),
      );
      unlisteners.push(
        await listen<string>(`ollama://error/${requestId}`, (e) => {
          settle(() => handlers.onError(e.payload));
        }),
      );

      // Listeners are wired before the request is dispatched, so no token is missed.
      if (settled) {
        releaseAll();
        return;
      }

      await invoke("ollama_generate", {
        requestId,
        baseUrl: args.baseUrl,
        model: args.model,
        prompt: args.prompt,
        system: args.system ?? null,
        options: args.options ?? null,
      });
    } catch (err) {
      settle(() => handlers.onError(err instanceof Error ? err.message : String(err)));
    }
  })();

  return {
    requestId,
    cancel: () => {
      void cancel(requestId);
      settle(() => {
        /* user-initiated stop: no handler, just release listeners */
      });
    },
  };
}
