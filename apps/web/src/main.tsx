import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

function App() {
  return (
    <main className="shell">
      <section className="card" aria-labelledby="title">
        <p className="eyebrow">Hjerterum</p>
        <h1 id="title">Ny platform under opbygning</h1>
        <p>
          Denne kodebase er den nye portable platform for Hjerterums website,
          medlemsområde, events og bookinger. Den er endnu ikke publiceret.
        </p>
      </section>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing root element");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
