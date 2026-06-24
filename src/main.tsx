import ReactDOM from "react-dom/client";
import App from "./App";

// IBM Plex — Carbon Design System's typefaces (self-hosted via fontsource)
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";

import "./styles.css";

// NB: no <StrictMode>. Each terminal mount spawns a real PTY; StrictMode's
// dev double-invoke would spawn → kill → respawn every session on boot.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />,
);
