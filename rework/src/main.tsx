import { render } from "preact";
import { App } from "./app.tsx";

// Phase 0: minimaler Mount-Punkt, damit `vite build` grün läuft.
// App-Shell (View-Switch, Header, Statuszeile) + SW-Registrierung folgen in Phase 3/4.
const root = document.getElementById("app");
if (root) {
  render(<App />, root);
}
