import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import PaneTree from "./components/PaneTree";
import TabBar, { type AppView } from "./components/TabBar";
import Sidebar from "./components/Sidebar";
import StatusBar from "./components/StatusBar";
import CommandPalette, { type Command } from "./components/CommandPalette";
import SettingsPanel from "./components/SettingsPanel";
import AiPanel from "./components/AiPanel";
import AiPromptModal from "./components/AiPromptModal";
import MissionControl from "./components/agents/MissionControl";
import ConnectionBanner from "./components/ConnectionBanner";
import { THEMES, themeById, chromeSurface, chromeLine } from "./lib/theme";
import { ACCENTS, accentById, accentGlow } from "./lib/accents";
import { type TypeSettings, TYPE_LIMITS } from "./lib/typography";
import { loadPrefs, savePrefs, type OllamaPrefs } from "./lib/prefs";
import * as termRegistry from "./lib/termRegistry";
import { useAiTask } from "./lib/useAiTask";
import {
  buildExplainPrompt,
  buildSummarizePrompt,
  buildSuggestPrompt,
  buildCommandPrompt,
  extractCommand,
  parseSuggestions,
} from "./lib/ollamaPrompts";
import * as pty from "./lib/pty";
import { useAgentStore, computeTotals, ensureBridge } from "./lib/agentStore";
import { seedMockStore } from "./lib/agentMock";
import { setupClaudeMonitoring } from "./lib/claude";
import { useIngestHealth } from "./lib/ingestHealth";
import {
  type TabGroup,
  makeGroup,
  nextColor,
  pruneGroups,
  moveTab,
  moveGroupBlock,
} from "./lib/tabGroups";
import GroupGrid from "./components/GroupGrid";
import {
  type PaneNode,
  type SplitDir,
  type Direction,
  makeLeaf,
  firstLeafId,
  leafIds,
  leafCount,
  splitLeaf,
  closeLeaf,
  setSizes,
  neighbor,
} from "./lib/panes";

/** A tab owns a tree of split panes plus which pane is focused. */
interface Tab {
  id: string;
  title: string;
  root: PaneNode;
  activePaneId: string;
  /** id of the sidebar group this tab belongs to, or null/undefined if loose */
  groupId?: string | null;
}

let tabSeq = 0;
function makeTab(opts?: { title?: string; initialCommand?: string }): Tab {
  tabSeq += 1;
  const leaf = makeLeaf({ title: opts?.title ?? `zsh ${tabSeq}`, initialCommand: opts?.initialCommand });
  return { id: crypto.randomUUID(), title: leaf.title, root: leaf, activePaneId: leaf.id };
}

const ARROW: Record<string, Direction> = {
  arrowleft: "left",
  arrowright: "right",
  arrowup: "up",
  arrowdown: "down",
};

/** Does the app (rather than the terminal) own this keystroke? */
function ownsShortcut(e: KeyboardEvent): boolean {
  if (!e.metaKey) return false;
  const k = e.key.toLowerCase();
  if (["t", "w", "k", "d", "i", "b"].includes(k)) return true;
  if (k >= "1" && k <= "9") return true;
  if (k === "=" || k === "-" || k === "+" || k === "0") return true;
  if (e.key === ",") return true; // open settings
  if (e.key === "\\") return true; // toggle terminal/agents view
  if (e.shiftKey && (e.key === "[" || e.key === "]")) return true;
  if (e.altKey && k in ARROW) return true; // pane navigation
  return false;
}

const MIN_FONT = TYPE_LIMITS.fontSize.min;
const MAX_FONT = TYPE_LIMITS.fontSize.max;

/** Which AI task the AiPanel is currently showing. */
type AiTaskKind = "explain" | "summarize" | "suggest" | "command";

const AI_TASK_TITLE: Record<AiTaskKind, string> = {
  explain: "Explain output",
  summarize: "Summarize output",
  suggest: "Suggest next command",
  command: "Generate command",
};

export default function App() {
  const initialPrefs = useMemo(() => loadPrefs(), []);
  const [tabs, setTabs] = useState<Tab[]>(() => [makeTab()]);
  const [activeId, setActiveId] = useState(() => tabs[0].id);
  const [groups, setGroups] = useState<TabGroup[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [themeId, setThemeId] = useState(initialPrefs.themeId);
  const [accentId, setAccentId] = useState(initialPrefs.accentId);
  const [type, setType] = useState<TypeSettings>(initialPrefs.type);
  const [ollama, setOllama] = useState<OllamaPrefs>(initialPrefs.ollama);
  const [broadcast, setBroadcast] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [view, setView] = useState<AppView>("terminal");
  // when set (and view==="terminal"), the stage shows that group's overview
  // grid instead of the live panes; clicking a card clears it back to null.
  const [gridGroupId, setGridGroupId] = useState<string | null>(null);
  const [claudeLaunchedAt, setClaudeLaunchedAt] = useState<number | null>(null);

  // AI panel + NL→command modal state
  const [aiTask, setAiTask] = useState<AiTaskKind | null>(null);
  const [aiEmpty, setAiEmpty] = useState<string | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const ai = useAiTask();
  // pane the current AI task is acting on (insert target)
  const aiPaneRef = useRef<string | null>(null);

  const theme = themeById(themeId);
  const accent = accentById(accentId);

  /**
   * Run a state change inside a same-document View Transition so theme / accent
   * / view swaps cross-fade instead of hard-flipping. Falls back to a plain call
   * when the API is unavailable or the user prefers reduced motion.
   */
  const withTransition = useCallback((fn: () => void) => {
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => unknown;
    };
    const reduce = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduce || typeof doc.startViewTransition !== "function") {
      fn();
      return;
    }
    doc.startViewTransition(fn);
  }, []);

  const switchTheme = useCallback(
    (id: string) => withTransition(() => setThemeId(id)),
    [withTransition],
  );
  const switchAccent = useCallback(
    (id: string) => withTransition(() => setAccentId(id)),
    [withTransition],
  );
  const switchView = useCallback(
    (v: AppView | ((p: AppView) => AppView)) =>
      withTransition(() => setView(v)),
    [withTransition],
  );

  /** Merge a typography patch and trigger a live terminal update. */
  const patchType = useCallback((patch: Partial<TypeSettings>) => {
    setType((t) => ({ ...t, ...patch }));
  }, []);

  const patchOllama = useCallback((patch: Partial<OllamaPrefs>) => {
    setOllama((o) => ({ ...o, ...patch }));
  }, []);

  // persist appearance + typography + AI config whenever they change
  useEffect(() => {
    savePrefs({ themeId, accentId, type, ollama });
  }, [themeId, accentId, type, ollama]);

  // platform detect → opaque fallback. macOS gets native vibrancy (translucent
  // chrome over the desktop); every other platform gets a solid opaque shell so
  // the glass still reads with nothing behind the window.
  useEffect(() => {
    const ua = navigator.userAgent;
    const platform =
      (navigator as Navigator & { userAgentData?: { platform?: string } })
        .userAgentData?.platform ?? navigator.platform ?? "";
    const isMac = /Mac|iPhone|iPad|iPod/.test(platform) || /Macintosh/.test(ua);
    const cls = document.documentElement.classList;
    cls.toggle("platform-macos", isMac);
    cls.toggle("no-vibrancy", !isMac);
  }, []);

  // start the agent-telemetry bridge at boot so no events are missed
  useEffect(() => ensureBridge(), []);
  const store = useAgentStore();
  const liveAgents = computeTotals(store).activeAgents;
  const health = useIngestHealth();

  // refs so the global key handler always sees fresh state
  const stateRef = useRef({ tabs, activeId });
  stateRef.current = { tabs, activeId };

  const activeTab = tabs.find((t) => t.id === activeId) ?? tabs[0];
  const activeGroup = activeTab.groupId
    ? groups.find((g) => g.id === activeTab.groupId) ?? null
    : null;
  const paneCount = tabs.reduce((n, t) => n + leafCount(t.root), 0);

  /** Patch one tab in place by id. */
  const patchTab = useCallback((tabId: string, fn: (t: Tab) => Tab) => {
    setTabs((ts) => ts.map((t) => (t.id === tabId ? fn(t) : t)));
  }, []);

  const newTab = useCallback((groupId?: string | null) => {
    const tab = makeTab();
    tab.groupId = groupId ?? null;
    setTabs((ts) => [...ts, tab]);
    setActiveId(tab.id);
  }, []);

  // drop any group whose last tab was closed or moved out
  useEffect(() => {
    setGroups((gs) => pruneGroups(tabs, gs));
  }, [tabs]);

  const renameTab = useCallback((id: string, name: string) => {
    setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, title: name } : t)));
  }, []);

  const renameGroup = useCallback((id: string, name: string) => {
    setGroups((gs) => gs.map((g) => (g.id === id ? { ...g, name } : g)));
  }, []);

  const cycleGroupColor = useCallback((id: string) => {
    setGroups((gs) =>
      gs.map((g) => (g.id === id ? { ...g, color: nextColor(g.color) } : g)),
    );
  }, []);

  const setGroupColor = useCallback((id: string, colorId: string) => {
    setGroups((gs) => gs.map((g) => (g.id === id ? { ...g, color: colorId } : g)));
  }, []);

  const toggleGroupCollapsed = useCallback((id: string) => {
    setGroups((gs) =>
      gs.map((g) => (g.id === id ? { ...g, collapsed: !g.collapsed } : g)),
    );
  }, []);

  const setAllGroupsCollapsed = useCallback((collapsed: boolean) => {
    setGroups((gs) => gs.map((g) => ({ ...g, collapsed })));
  }, []);

  const toggleGroupBroadcast = useCallback((id: string) => {
    setGroups((gs) =>
      gs.map((g) => (g.id === id ? { ...g, broadcasting: !g.broadcasting } : g)),
    );
  }, []);

  /** DnD: move a session before `beforeId` and (re)assign its group. */
  const moveTabTo = useCallback(
    (dragId: string, beforeId: string | null, groupId: string | null) => {
      setTabs((ts) => moveTab(ts, dragId, beforeId, groupId));
    },
    [],
  );

  /** DnD: relocate a whole group block before `beforeId`. */
  const moveGroupTo = useCallback((groupId: string, beforeId: string | null) => {
    setTabs((ts) => moveGroupBlock(ts, groupId, beforeId));
  }, []);

  /** Open a group's overview-card grid in the stage. */
  const openGroupGrid = useCallback((groupId: string) => {
    setView("terminal");
    setGridGroupId(groupId);
  }, []);

  /** Put `tabId` into `groupId` (null = ungroup). */
  const moveTabToGroup = useCallback((tabId: string, groupId: string | null) => {
    setTabs((ts) => ts.map((t) => (t.id === tabId ? { ...t, groupId } : t)));
  }, []);

  /** Create a fresh group and drop `tabId` into it. */
  const newGroupFromTab = useCallback((tabId: string) => {
    const group = makeGroup();
    setGroups((gs) => [...gs, group]);
    setTabs((ts) =>
      ts.map((t) => (t.id === tabId ? { ...t, groupId: group.id } : t)),
    );
  }, []);

  /** Disband a group but keep its tabs (they become loose). */
  const ungroup = useCallback((groupId: string) => {
    setTabs((ts) =>
      ts.map((t) => (t.groupId === groupId ? { ...t, groupId: null } : t)),
    );
  }, []);

  const launchClaude = useCallback(async () => {
    try {
      const { command } = await setupClaudeMonitoring();
      const tab = makeTab({ title: "claude ◇", initialCommand: command });
      setTabs((ts) => [...ts, tab]);
      setActiveId(tab.id);
      setClaudeLaunchedAt(Date.now());
      setView("terminal");
    } catch (err) {
      console.error("failed to set up Claude monitoring", err);
    }
  }, []);

  const closeTab = useCallback((id: string) => {
    setTabs((ts) => {
      const idx = ts.findIndex((t) => t.id === id);
      const next = ts.filter((t) => t.id !== id);
      if (next.length === 0) {
        const fresh = makeTab();
        setActiveId(fresh.id);
        return [fresh];
      }
      setActiveId((cur) => {
        if (cur !== id) return cur;
        const neighborTab = next[Math.min(idx, next.length - 1)];
        return neighborTab.id;
      });
      return next;
    });
  }, []);

  /** Close every tab in a group (and the group itself via prune). */
  const closeGroup = useCallback((groupId: string) => {
    setTabs((ts) => {
      const next = ts.filter((t) => t.groupId !== groupId);
      if (next.length === 0) {
        const fresh = makeTab();
        setActiveId(fresh.id);
        return [fresh];
      }
      setActiveId((cur) =>
        next.some((t) => t.id === cur) ? cur : next[next.length - 1].id,
      );
      return next;
    });
  }, []);

  const focusPane = useCallback((tabId: string, paneId: string) => {
    setActiveId(tabId);
    setTabs((ts) => ts.map((t) => (t.id === tabId ? { ...t, activePaneId: paneId } : t)));
  }, []);

  /** Split the focused pane of the active tab. */
  const splitActive = useCallback((dir: SplitDir) => {
    const { tabs: ts, activeId: cur } = stateRef.current;
    const tab = ts.find((t) => t.id === cur);
    if (!tab) return;
    const fresh = makeLeaf({ title: "zsh" });
    patchTab(tab.id, (t) => ({
      ...t,
      root: splitLeaf(t.root, t.activePaneId, dir, fresh),
      activePaneId: fresh.id,
    }));
  }, [patchTab]);

  /** Close the focused pane; if it was the tab's last pane, close the tab. */
  const closeActivePane = useCallback(() => {
    const { tabs: ts, activeId: cur } = stateRef.current;
    const tab = ts.find((t) => t.id === cur);
    if (!tab) return;
    const next = closeLeaf(tab.root, tab.activePaneId);
    if (next === null) {
      closeTab(tab.id);
      return;
    }
    const ids = leafIds(next);
    const fallback = ids.includes(tab.activePaneId) ? tab.activePaneId : firstLeafId(next);
    patchTab(tab.id, (t) => ({ ...t, root: next, activePaneId: fallback }));
  }, [closeTab, patchTab]);

  /** Move focus to the adjacent pane in a direction. */
  const navPane = useCallback((dir: Direction) => {
    const { tabs: ts, activeId: cur } = stateRef.current;
    const tab = ts.find((t) => t.id === cur);
    if (!tab) return;
    const target = neighbor(tab.root, tab.activePaneId, dir);
    if (target) patchTab(tab.id, (t) => ({ ...t, activePaneId: target }));
  }, [patchTab]);

  const cycleTab = useCallback((dir: 1 | -1) => {
    const { tabs: ts, activeId: cur } = stateRef.current;
    if (ts.length < 2) return;
    const idx = ts.findIndex((t) => t.id === cur);
    const nextIdx = (idx + dir + ts.length) % ts.length;
    setActiveId(ts[nextIdx].id);
  }, []);

  const bumpFont = useCallback((delta: number) => {
    setType((t) => ({
      ...t,
      fontSize: Math.max(MIN_FONT, Math.min(MAX_FONT, t.fontSize + delta)),
    }));
  }, []);
  const resetFont = useCallback(
    () => patchType({ fontSize: TYPE_LIMITS.fontSize.default }),
    [patchType],
  );

  /** Recent output text of the active pane, or "" if none available. */
  const recentOutput = useCallback((n: number): string => {
    const tab = stateRef.current.tabs.find((t) => t.id === stateRef.current.activeId);
    const paneId = tab?.activePaneId;
    if (!paneId) return "";
    return termRegistry.get(paneId)?.getRecentText(n) ?? "";
  }, []);

  /** Open the AI panel for an output-analysis task (explain/summarize/suggest). */
  const runOutputTask = useCallback(
    (kind: "explain" | "summarize" | "suggest") => {
      if (ollama.model === "") {
        setAiTask(kind);
        setAiEmpty("Pick a model in Settings → AI / Ollama");
        return;
      }
      const lines = kind === "summarize" ? 120 : kind === "suggest" ? 60 : 40;
      const output = recentOutput(lines);
      setAiTask(kind);
      if (output.trim() === "") {
        setAiEmpty("No recent output to analyze.");
        return;
      }
      setAiEmpty(null);
      const parts =
        kind === "explain"
          ? buildExplainPrompt(output)
          : kind === "summarize"
            ? buildSummarizePrompt(output)
            : buildSuggestPrompt(output);
      ai.start({
        baseUrl: ollama.baseUrl,
        model: ollama.model,
        system: parts.system,
        prompt: parts.prompt,
      });
    },
    [ollama.model, ollama.baseUrl, recentOutput, ai],
  );

  /** Open the NL→command flow (free-text modal first). */
  const startCommandTask = useCallback(() => {
    if (ollama.model === "") {
      setAiTask("command");
      setAiEmpty("Pick a model in Settings → AI / Ollama");
      return;
    }
    aiPaneRef.current = stateRef.current.tabs.find(
      (t) => t.id === stateRef.current.activeId,
    )?.activePaneId ?? null;
    setPromptOpen(true);
  }, [ollama.model]);

  /** The modal submitted a request — stream a single command. */
  const submitCommandRequest = useCallback(
    (request: string) => {
      setPromptOpen(false);
      const parts = buildCommandPrompt(request);
      setAiTask("command");
      setAiEmpty(null);
      ai.start({
        baseUrl: ollama.baseUrl,
        model: ollama.model,
        system: parts.system,
        prompt: parts.prompt,
        options: { temperature: 0.2 },
      });
    },
    [ollama.baseUrl, ollama.model, ai],
  );

  /** Insert text at the active pane (no `\r` → type-not-run). Optionally run it. */
  const insertCommand = useCallback((cmd: string, run: boolean) => {
    const paneId =
      aiPaneRef.current ??
      stateRef.current.tabs.find((t) => t.id === stateRef.current.activeId)
        ?.activePaneId ??
      null;
    if (!paneId || !cmd) return;
    void pty.write(paneId, run ? cmd + "\r" : cmd);
  }, []);

  const closeAiPanel = useCallback(() => {
    setAiTask(null);
    setAiEmpty(null);
    ai.reset();
  }, [ai]);

  // --- global shortcuts ---
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // palette toggle works even while open
      if (e.metaKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (e.metaKey && e.key === ",") {
        e.preventDefault();
        setSettingsOpen((o) => !o);
        return;
      }
      if (!ownsShortcut(e)) return;
      e.preventDefault();
      const k = e.key.toLowerCase();
      if (e.key === "\\") switchView((v) => (v === "terminal" ? "mission" : "terminal"));
      else if (e.altKey && k in ARROW) navPane(ARROW[k]);
      else if (k === "d") splitActive(e.shiftKey ? "column" : "row");
      else if (k === "i") setBroadcast((b) => !b);
      else if (k === "t") newTab();
      else if (k === "b") setSidebarOpen((o) => !o);
      else if (k === "w") closeActivePane();
      else if (k === "=" || k === "+") bumpFont(1);
      else if (k === "-") bumpFont(-1);
      else if (k === "0") resetFont();
      else if (e.shiftKey && e.key === "]") cycleTab(1);
      else if (e.shiftKey && e.key === "[") cycleTab(-1);
      else if (k >= "1" && k <= "9") {
        const n = Number(k) - 1;
        const t = stateRef.current.tabs[n];
        if (t) setActiveId(t.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newTab, closeActivePane, cycleTab, bumpFont, resetFont, splitActive, navPane, switchView]);

  // --- expose theme to CSS ---
  // accent (if any) overrides only the accent pair + glow; theme owns the rest
  const rootStyle = {
    "--accent": accent ? accent.accent : theme.accent,
    "--accent-2": accent ? accent.accent2 : theme.accent2,
    "--glow": accent ? accentGlow(accent) : theme.glow,
    "--bg": theme.bg,
    "--text": theme.ui.text,
    "--text-dim": theme.ui.textDim,
    "--chrome": chromeSurface(theme),
    "--chrome-line": chromeLine(theme),
  } as React.CSSProperties;

  const commands: Command[] = useMemo(() => {
    const cmds: Command[] = [
      { id: "settings", group: "View", title: "Open Settings…", hint: "⌘,", run: () => setSettingsOpen(true) },
      { id: "view-term", group: "View", title: "Show Terminal", hint: "⌘\\", run: () => switchView("terminal") },
      { id: "view-agents", group: "View", title: "Show Agent Mission Control", hint: "⌘\\", run: () => switchView("mission") },
      { id: "claude", group: "Agents", title: "Launch Claude Code (monitored)", run: () => { void launchClaude(); } },
      { id: "demo", group: "Agents", title: "Load demo agent run", run: () => { seedMockStore(); setView("mission"); } },
      { id: "split-v", group: "Pane", title: "Split right (vertical)", hint: "⌘D", run: () => splitActive("row") },
      { id: "split-h", group: "Pane", title: "Split down (horizontal)", hint: "⌘⇧D", run: () => splitActive("column") },
      { id: "close-pane", group: "Pane", title: "Close focused pane", hint: "⌘W", run: closeActivePane },
      {
        id: "broadcast",
        group: "Pane",
        title: broadcast ? "Stop broadcasting input" : "Broadcast input to all panes",
        hint: "⌘⌥I",
        run: () => setBroadcast((b) => !b),
      },
      { id: "new", group: "Tab", title: "New session", hint: "⌘T", run: newTab },
      { id: "close", group: "Tab", title: "Close tab", run: () => closeTab(stateRef.current.activeId) },
      { id: "next", group: "Tab", title: "Next session", hint: "⌘⇧]", run: () => cycleTab(1) },
      { id: "prev", group: "Tab", title: "Previous session", hint: "⌘⇧[", run: () => cycleTab(-1) },
      { id: "fplus", group: "View", title: "Increase font size", hint: "⌘+", run: () => bumpFont(1) },
      { id: "fminus", group: "View", title: "Decrease font size", hint: "⌘-", run: () => bumpFont(-1) },
      { id: "freset", group: "View", title: "Reset font size", hint: "⌘0", run: resetFont },
    ];
    groups.forEach((g) =>
      cmds.push({
        id: "grid-" + g.id,
        group: "View",
        title:
          groups.length > 1
            ? `View group “${g.name}” as grid`
            : "View group as grid",
        run: () => openGroupGrid(g.id),
      }),
    );
    if (ollama.enabled) {
      cmds.push(
        {
          id: "ai-command",
          group: "AI",
          title: "Generate command from description…",
          run: startCommandTask,
        },
        {
          id: "ai-explain",
          group: "AI",
          title: "Explain last output / error",
          run: () => runOutputTask("explain"),
        },
        {
          id: "ai-summarize",
          group: "AI",
          title: "Summarize output",
          run: () => runOutputTask("summarize"),
        },
        {
          id: "ai-suggest",
          group: "AI",
          title: "Suggest next command",
          run: () => runOutputTask("suggest"),
        },
      );
    }
    THEMES.forEach((t) =>
      cmds.push({
        id: "theme-" + t.id,
        group: "Theme",
        title: "Switch to " + t.name,
        run: () => switchTheme(t.id),
      }),
    );
    ACCENTS.forEach((a) =>
      cmds.push({
        id: "accent-" + a.id,
        group: "Accent",
        title: "Accent · " + a.name,
        swatch: a.accent,
        run: () => switchAccent(a.id),
      }),
    );
    return cmds;
  }, [newTab, closeTab, closeActivePane, cycleTab, bumpFont, resetFont, splitActive, broadcast, launchClaude, ollama.enabled, startCommandTask, runOutputTask, groups, openGroupGrid, switchView, switchTheme, switchAccent]);

  return (
    <div
      className="app"
      data-appearance={theme.appearance}
      style={rootStyle}
    >
      <div className="aurora" aria-hidden>
        <span className="aurora__blob aurora__blob--1" />
        <span className="aurora__blob aurora__blob--2" />
        <span className="aurora__blob aurora__blob--3" />
        <div className="grid-overlay" />
      </div>

      <TabBar
        theme={theme}
        view={view}
        liveAgents={liveAgents}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((o) => !o)}
        onViewChange={setView}
        onLaunchClaude={() => void launchClaude()}
      />

      <div className="workspace">
        {sidebarOpen && (
          <Sidebar
            tabs={tabs}
            groups={groups}
            activeId={activeId}
            onSelect={setActiveId}
            onClose={closeTab}
            onNew={() => newTab()}
            onNewInGroup={(gid) => newTab(gid)}
            onRenameTab={renameTab}
            onRenameGroup={renameGroup}
            onCycleGroupColor={cycleGroupColor}
            onSetGroupColor={setGroupColor}
            onToggleCollapse={toggleGroupCollapsed}
            onSetAllCollapsed={setAllGroupsCollapsed}
            onToggleGroupBroadcast={toggleGroupBroadcast}
            onNewGroupFromTab={newGroupFromTab}
            onMoveToGroup={moveTabToGroup}
            onUngroup={ungroup}
            onCloseGroup={closeGroup}
            onMoveTab={moveTabTo}
            onMoveGroup={moveGroupTo}
            onOpenGrid={openGroupGrid}
          />
        )}

        <div className="terminal-stage">
        {/* terminals stay mounted (PTYs keep running) even when viewing agents */}
        {tabs.map((tab) => {
          const showPanes = view === "terminal" && gridGroupId === null;
          const isActiveTab = tab.id === activeId && showPanes;
          // local (all-panes-of-this-tab) broadcast
          const local = broadcast && isActiveTab ? leafIds(tab.root) : [];
          // group broadcast: if the active tab's group is broadcasting, also
          // mirror to the first pane of every OTHER session in that group.
          const grp = activeGroup;
          const group =
            isActiveTab && grp?.broadcasting
              ? tabs
                  .filter((t) => t.groupId === grp.id && t.id !== tab.id)
                  .map((t) => firstLeafId(t.root))
              : [];
          const broadcastIds = [...new Set([...local, ...group])];
          return (
            <div
              key={tab.id}
              className={"term-layer" + (isActiveTab ? " term-layer--active" : "")}
            >
              <PaneTree
                node={tab.root}
                theme={theme}
                type={type}
                activePaneId={isActiveTab ? tab.activePaneId : null}
                broadcastIds={broadcastIds}
                ownsShortcut={ownsShortcut}
                onFocusPane={(paneId) => focusPane(tab.id, paneId)}
                onExitPane={() => {
                  /* leave the pane in place so the user can read the output;
                     ⌘W (closeActivePane) reclaims it */
                }}
                onResize={(splitId, sizes) =>
                  patchTab(tab.id, (t) => ({ ...t, root: setSizes(t.root, splitId, sizes) }))
                }
              />
            </div>
          );
        })}

        {broadcast && view === "terminal" && gridGroupId === null && (
          <div className="broadcast-flag" role="status">
            ⌥ broadcasting input to all panes · ⌘⌥I to stop
          </div>
        )}

        {!broadcast &&
          view === "terminal" &&
          gridGroupId === null &&
          activeGroup?.broadcasting && (
            <div className="broadcast-flag" role="status">
              ◇ broadcasting to group “{activeGroup.name}”
            </div>
          )}

        {view === "terminal" && gridGroupId !== null && (
          <GroupGrid
            group={groups.find((g) => g.id === gridGroupId) ?? null}
            tabs={tabs.filter((t) => t.groupId === gridGroupId)}
            onOpen={(id) => {
              setActiveId(id);
              setGridGroupId(null);
              setView("terminal");
            }}
            onClose={() => setGridGroupId(null)}
          />
        )}

        {view === "mission" && (
          <div className="mission-layer">
            <MissionControl />
            <div className="mission-banner-slot">
              <ConnectionBanner health={health} launchedAt={claudeLaunchedAt} />
            </div>
          </div>
        )}
        </div>
      </div>

      <StatusBar
        theme={theme}
        tabCount={tabs.length}
        paneCount={paneCount}
        focusedTabPanes={leafCount(activeTab.root)}
        fontSize={type.fontSize}
        shell="zsh"
        health={health}
        broadcast={broadcast}
      />

      <CommandPalette
        open={paletteOpen}
        commands={commands}
        onClose={() => setPaletteOpen(false)}
      />

      <SettingsPanel
        open={settingsOpen}
        theme={theme}
        type={type}
        ollama={ollama}
        accentId={accentId}
        onClose={() => setSettingsOpen(false)}
        onSelectTheme={switchTheme}
        onSelectAccent={switchAccent}
        onPatchType={patchType}
        onPatchOllama={patchOllama}
      />

      <AiPromptModal
        open={promptOpen}
        onClose={() => setPromptOpen(false)}
        onSubmit={submitCommandRequest}
      />

      {aiTask && (
        <AiPanel
          open
          title={AI_TASK_TITLE[aiTask]}
          model={ollama.model || undefined}
          status={ai.status}
          text={ai.text}
          error={ai.error}
          emptyMessage={aiEmpty}
          onClose={closeAiPanel}
          onStop={ai.cancel}
          onRetry={() => {
            if (aiTask === "command") {
              setPromptOpen(true);
            } else {
              runOutputTask(aiTask);
            }
          }}
          actions={
            aiTask === "command" && ai.status === "done" ? (
              (() => {
                const cmd = extractCommand(ai.text);
                if (!cmd) return null;
                return (
                  <div className="ai-actions">
                    <code className="ai-actions__cmd">{cmd}</code>
                    <div className="ai-actions__btns">
                      <button
                        type="button"
                        className="ai-btn"
                        onClick={() => {
                          insertCommand(cmd, false);
                          closeAiPanel();
                        }}
                      >
                        Insert
                      </button>
                      <button
                        type="button"
                        className="ai-btn ai-btn--primary"
                        onClick={() => {
                          insertCommand(cmd, true);
                          closeAiPanel();
                        }}
                      >
                        Insert &amp; Run
                      </button>
                    </div>
                  </div>
                );
              })()
            ) : aiTask === "suggest" && ai.status === "done" ? (
              <ul className="ai-suggest">
                {parseSuggestions(ai.text).map((s, i) => (
                  <li key={i} className="ai-suggest__item">
                    <button
                      type="button"
                      className="ai-suggest__cmd"
                      onClick={() => {
                        insertCommand(s.command, false);
                        closeAiPanel();
                      }}
                      title="Insert into the terminal"
                    >
                      {s.command}
                    </button>
                    {s.reason && (
                      <span className="ai-suggest__reason">{s.reason}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
