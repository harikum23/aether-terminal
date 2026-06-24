import type { AetherTheme } from "../lib/theme";
import Icon from "./Icon";

export interface TabInfo {
  id: string;
  title: string;
  /** if set, this command is typed into the shell once the PTY is ready */
  initialCommand?: string;
}

export type AppView = "terminal" | "mission";

interface TabBarProps {
  theme: AetherTheme;
  view: AppView;
  liveAgents: number;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onViewChange: (view: AppView) => void;
  onLaunchClaude: () => void;
}

export default function TabBar({
  view,
  liveAgents,
  sidebarOpen,
  onToggleSidebar,
  onViewChange,
  onLaunchClaude,
}: TabBarProps) {
  return (
    <div className="tabbar" data-tauri-drag-region>
      {/* spacer reserves room for the macOS traffic lights */}
      <div className="traffic-spacer" data-tauri-drag-region />

      <button
        className={"sidebar-toggle" + (sidebarOpen ? " is-on" : "")}
        onClick={onToggleSidebar}
        title="Toggle sidebar (⌘B)"
        aria-pressed={sidebarOpen}
      >
        <Icon name="sidebar" />
      </button>

      <div className="view-switch" role="tablist" aria-label="View">
        <button
          role="tab"
          aria-selected={view === "terminal"}
          className={"view-switch__btn" + (view === "terminal" ? " is-active" : "")}
          onClick={() => onViewChange("terminal")}
        >
          <Icon name="terminal" className="view-switch__glyph" />Terminal
        </button>
        <button
          role="tab"
          aria-selected={view === "mission"}
          className={"view-switch__btn" + (view === "mission" ? " is-active" : "")}
          onClick={() => onViewChange("mission")}
        >
          <Icon name="agents" className="view-switch__glyph" />Agents
          {liveAgents > 0 && (
            <span className="view-switch__badge">{liveAgents}</span>
          )}
        </button>
      </div>

      <div className="tabbar__spacer" data-tauri-drag-region />

      <button
        className="launch-claude"
        onClick={onLaunchClaude}
        title="Launch a monitored Claude Code session"
      >
        <Icon name="spark" className="launch-claude__spark" />
        Launch Claude
      </button>

      <div className="brand" data-tauri-drag-region>
        <Icon name="diamond" className="brand__glyph" />
        <span className="brand__name">AETHER</span>
      </div>
    </div>
  );
}
