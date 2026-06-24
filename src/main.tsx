import ReactDOM from "react-dom/client";
import App from "./App";

// IBM Plex — Carbon Design System's typefaces (self-hosted via fontsource).
// Import every weight the typography controls can select (300/400/500) AND the
// bold weights they derive (weight + 200 → up to 700), so macOS renders real
// glyphs instead of synthesizing fake bold/thin — which looks mushy, not solid.
import "@fontsource/ibm-plex-mono/300.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource/ibm-plex-mono/700.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";

import "./styles.css";

// NB: no <StrictMode>. Each terminal mount spawns a real PTY; StrictMode's
// dev double-invoke would spawn → kill → respawn every session on boot.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />,
);
