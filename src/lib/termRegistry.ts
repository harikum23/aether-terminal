/**
 * Module-level registry mapping a pane id to a small accessor for its terminal.
 *
 * xterm instances are private to `Terminal.tsx`; this lets App-level features
 * (the AI tasks) read recent output from the active pane without threading
 * refs through the pane tree. Each terminal registers on mount and unregisters
 * on cleanup.
 */

export interface TermAccessor {
  /** Recent visible+scrollback text for this pane (trimmed, tail-capped). */
  getRecentText: (maxLines: number) => string;
}

const registry = new Map<string, TermAccessor>();

export function register(paneId: string, accessor: TermAccessor): void {
  registry.set(paneId, accessor);
}

export function unregister(paneId: string): void {
  registry.delete(paneId);
}

export function get(paneId: string): TermAccessor | undefined {
  return registry.get(paneId);
}
