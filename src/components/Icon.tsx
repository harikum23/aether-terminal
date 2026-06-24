/**
 * Cohesive inline-SVG icon set (lucide-style, hand-rolled — no dependency).
 * 1.5px stroke, currentColor, 24px viewBox so they theme + scale automatically.
 * Sizing/coloring is controlled by the consumer via font-size/color or `size`.
 */
import type { ReactElement, SVGProps } from "react";

export type IconName =
  | "terminal"
  | "agents"
  | "sidebar"
  | "spark"
  | "diamond"
  | "plus"
  | "close"
  | "chevron"
  | "grid"
  | "search"
  | "settings"
  | "theme"
  | "palette"
  | "tab"
  | "ai"
  | "broadcast"
  | "view"
  | "swatch"
  | "folder"
  | "save"
  | "clock"
  | "layers";

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  /** pixel size; defaults to 1em so it follows font-size */
  size?: number | string;
}

/* Each path set is drawn on a 24×24 grid, stroked. */
const PATHS: Record<IconName, ReactElement> = {
  terminal: (
    <>
      <path d="M5 7l4 4-4 4" />
      <path d="M12 16h7" />
    </>
  ),
  agents: (
    <>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  diamond: <path d="M12 3l8 9-8 9-8-9 8-9z" />,
  sidebar: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </>
  ),
  spark: (
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M12 8.5L12 8.5M9 9l6 6M15 9l-6 6" />
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </>
  ),
  theme: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 0 0 18" fill="currentColor" stroke="none" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2 0-1.2 1-2 2-2h1.5A3.5 3.5 0 0 0 21 13.5C21 7.7 17 3 12 3z" />
      <circle cx="8" cy="10" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="7.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="16" cy="10" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  tab: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 9h7l2-3" />
    </>
  ),
  ai: (
    <>
      <path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3z" />
      <path d="M18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9L18 15z" />
    </>
  ),
  broadcast: (
    <>
      <circle cx="12" cy="12" r="2.4" />
      <path d="M7.5 7.5a6 6 0 0 0 0 9M16.5 7.5a6 6 0 0 1 0 9M4.7 4.7a10 10 0 0 0 0 14.6M19.3 4.7a10 10 0 0 1 0 14.6" />
    </>
  ),
  view: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  swatch: <circle cx="12" cy="12" r="8" fill="currentColor" stroke="none" />,
  folder: (
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h6a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
  ),
  save: (
    <>
      <path d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
      <path d="M8 4v5h7V4M8 21v-7h8v7" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3l9 5-9 5-9-5 9-5z" />
      <path d="M3 13l9 5 9-5" />
    </>
  ),
};

export default function Icon({ name, size = "1em", ...rest }: IconProps) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
