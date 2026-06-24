import { useCallback, useEffect, useRef, useState } from "react";

import {
  generateStream,
  type GenerateArgs,
  type GenerateHandle,
} from "./ollama";

export type AiTaskStatus = "idle" | "streaming" | "done" | "error";

export interface AiTaskState {
  status: AiTaskStatus;
  /** accumulated streamed text so far */
  text: string;
  /** error message when `status === "error"` */
  error: string | null;
}

export interface UseAiTask extends AiTaskState {
  /** begin a fresh generation, replacing any in-flight one */
  start: (args: GenerateArgs) => void;
  /** stop an in-flight generation (keeps whatever text streamed so far) */
  cancel: () => void;
  /** clear back to idle (e.g. when the panel closes) */
  reset: () => void;
}

/**
 * Drives one streaming Ollama generation as React state. Owns the listener
 * lifecycle via `generateStream` and tears it down on unmount, cancel, or a
 * subsequent `start`.
 */
export function useAiTask(): UseAiTask {
  const [state, setState] = useState<AiTaskState>({
    status: "idle",
    text: "",
    error: null,
  });
  const handleRef = useRef<GenerateHandle | null>(null);

  const stop = useCallback(() => {
    handleRef.current?.cancel();
    handleRef.current = null;
  }, []);

  const start = useCallback(
    (args: GenerateArgs) => {
      stop(); // release any prior in-flight stream first
      setState({ status: "streaming", text: "", error: null });
      handleRef.current = generateStream(args, {
        onToken: (token) =>
          setState((s) => ({ ...s, text: s.text + token })),
        onDone: () => {
          handleRef.current = null;
          setState((s) => ({ ...s, status: "done" }));
        },
        onError: (message) => {
          handleRef.current = null;
          setState((s) => ({ ...s, status: "error", error: message }));
        },
      });
    },
    [stop],
  );

  const cancel = useCallback(() => {
    stop();
    setState((s) =>
      s.status === "streaming" ? { ...s, status: "idle" } : s,
    );
  }, [stop]);

  const reset = useCallback(() => {
    stop();
    setState({ status: "idle", text: "", error: null });
  }, [stop]);

  // release listeners if the host component unmounts mid-stream
  useEffect(() => () => stop(), [stop]);

  return { ...state, start, cancel, reset };
}
