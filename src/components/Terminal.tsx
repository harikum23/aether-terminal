import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { WebglAddon } from "@xterm/addon-webgl";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import "@xterm/xterm/css/xterm.css";

import type { AetherTheme } from "../lib/theme";
import { fontStackById, type TypeSettings } from "../lib/typography";
import * as pty from "../lib/pty";
import * as termRegistry from "../lib/termRegistry";

interface TermProps {
  id: string;
  theme: AetherTheme;
  type: TypeSettings;
  active: boolean;
  /** typed into the shell once the PTY is ready (e.g. launch Claude Code) */
  initialCommand?: string;
  /** lets the parent own app-level shortcuts (Cmd+T, Cmd+K, …) */
  ownsShortcut: (e: KeyboardEvent) => boolean;
  /** other panes in this tab — keystrokes echo to them while broadcasting */
  broadcastIds?: string[];
  /** raise focus to the parent so it can mark this pane active */
  onFocusPane?: () => void;
  /** the shell exited */
  onExit?: () => void;
}

export default function Terminal({
  id,
  theme,
  type,
  active,
  initialCommand,
  ownsShortcut,
  broadcastIds,
  onFocusPane,
  onExit,
}: TermProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  // Keep the latest shortcut predicate without re-running the mount effect.
  const ownsRef = useRef(ownsShortcut);
  ownsRef.current = ownsShortcut;

  // Keep broadcast targets / callbacks fresh without remounting the PTY.
  const broadcastRef = useRef<string[]>(broadcastIds ?? []);
  broadcastRef.current = broadcastIds ?? [];
  const onFocusRef = useRef(onFocusPane);
  onFocusRef.current = onFocusPane;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  // --- mount: build the terminal + wire the PTY (runs once per tab) ---
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new XTerm({
      fontFamily: fontStackById(type.fontFamily),
      fontSize: type.fontSize,
      fontWeight: type.fontWeight,
      fontWeightBold: Math.min(900, type.fontWeight + 200),
      letterSpacing: type.letterSpacing,
      lineHeight: type.lineHeight,
      cursorBlink: type.cursorBlink,
      cursorStyle: type.cursorStyle,
      cursorInactiveStyle: "outline",
      scrollback: 10000,
      allowTransparency: true,
      allowProposedApi: true,
      macOptionIsMeta: true,
      theme: theme.xterm,
    });

    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(
      new WebLinksAddon((_e, uri) => {
        void openExternal(uri);
      }),
    );

    term.open(host);

    // GPU renderer — fall back silently to the DOM renderer if unavailable.
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      /* DOM renderer is fine */
    }

    // Let app-level chords (Cmd+T/K/W…) bubble to the window handler.
    term.attachCustomKeyEventHandler((e) => !ownsRef.current(e));

    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    // Expose recent output to App-level AI features (read-only accessor).
    termRegistry.register(id, {
      getRecentText: (maxLines: number) => {
        const buf = term.buffer.active;
        const end = buf.length; // exclusive
        const start = Math.max(0, end - maxLines);
        const lines: string[] = [];
        for (let i = start; i < end; i++) {
          lines.push(buf.getLine(i)?.translateToString(true) ?? "");
        }
        // trim blank edges
        while (lines.length && lines[0].trim() === "") lines.shift();
        while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
        const joined = lines.join("\n");
        // char-cap the tail (~8000) — recent output is what matters
        return joined.length > 8000 ? joined.slice(joined.length - 8000) : joined;
      },
    });

    let unlistenOutput: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;
    let disposed = false;

    (async () => {
      unlistenOutput = await pty.onOutput(id, (bytes) => term.write(bytes));
      unlistenExit = await pty.onExit(id, () => {
        term.writeln("\r\n\x1b[2m[ process exited — ⌘W to close ]\x1b[0m");
        onExitRef.current?.();
      });
      if (disposed) {
        unlistenOutput?.();
        unlistenExit?.();
        return;
      }
      await pty.spawn(id, term.cols, term.rows, undefined);
      if (initialCommand) {
        // let the login shell finish printing its prompt before we type
        setTimeout(() => {
          if (!disposed) void pty.write(id, initialCommand + "\r");
        }, 400);
      }
    })();

    const dataSub = term.onData((data) => {
      void pty.write(id, data);
      // broadcast-input: mirror keystrokes to every other pane in the tab
      for (const target of broadcastRef.current) void pty.write(target, data);
    });
    const resizeSub = term.onResize(({ cols, rows }) =>
      void pty.resize(id, cols, rows),
    );

    // Raise focus to the parent so split-pane focus tracks the real cursor.
    const focusSub = term.textarea
      ? (() => {
          const h = () => onFocusRef.current?.();
          term.textarea!.addEventListener("focus", h);
          return () => term.textarea?.removeEventListener("focus", h);
        })()
      : undefined;

    // rAF-coalesced refit: a ResizeObserver can fire many times during a drag
    // or window resize; fitting mid-layout yields wrong dims and a jumpy
    // scrollback. Collapse a burst into a single fit on the next frame.
    let rafId = 0;
    const scheduleFit = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        try {
          fit.fit();
        } catch {
          /* element not measurable yet */
        }
      });
    };
    const ro = new ResizeObserver(scheduleFit);
    ro.observe(host);

    return () => {
      disposed = true;
      termRegistry.unregister(id);
      if (rafId) cancelAnimationFrame(rafId);
      ro.disconnect();
      dataSub.dispose();
      resizeSub.dispose();
      focusSub?.();
      unlistenOutput?.();
      unlistenExit?.();
      void pty.kill(id);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // --- live theme changes ---
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = theme.xterm;
    // The WebGL renderer caches glyphs (with their colors) in a texture atlas.
    // Swapping the theme alone leaves already-painted text drawn in the OLD
    // colors — which can render it invisible against the new background. Clear
    // the atlas and force a full repaint so every cell adopts the new palette.
    try {
      term.clearTextureAtlas();
      term.refresh(0, term.rows - 1);
    } catch {
      /* DOM renderer repaints on its own */
    }
  }, [theme]);

  // --- live typography changes ---
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontFamily = fontStackById(type.fontFamily);
    term.options.fontSize = type.fontSize;
    term.options.fontWeight = type.fontWeight;
    term.options.fontWeightBold = Math.min(900, type.fontWeight + 200);
    term.options.letterSpacing = type.letterSpacing;
    term.options.lineHeight = type.lineHeight;
    term.options.cursorStyle = type.cursorStyle;
    term.options.cursorBlink = type.cursorBlink;
    try {
      fitRef.current?.fit();
    } catch {
      /* ignore */
    }
  }, [type]);

  // --- focus + refit when this tab becomes active ---
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => {
      const term = termRef.current;
      try {
        fitRef.current?.fit();
      } catch {
        /* ignore */
      }
      // The WebGL renderer only draws on data/resize events, so a session that
      // was hidden can surface a stale/garbled GPU frame on switch. Force a full
      // viewport repaint so the newly-visible terminal always paints cleanly.
      try {
        if (term) term.refresh(0, term.rows - 1);
      } catch {
        /* DOM renderer repaints on its own */
      }
      term?.focus();
    }, 30);
    return () => clearTimeout(t);
  }, [active]);

  return <div className="term-host" ref={hostRef} />;
}
