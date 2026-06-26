import { useState } from "react";
import "./App.css";
import { type Health, type Metrics, ObservationClient } from "./api/observation";

// The flagship Skill is the single call-to-action. It lives in the repo at skills/SKILL.md;
// this resolves once Track C lands on the default branch.
const SKILL_URL = "https://github.com/AlmaNetwork/vouch/blob/main/skills/SKILL.md";

// In dev, "/api" is proxied to the observation server (see vite.config.ts), which sidesteps
// the server's missing CORS headers. Override at build time with VITE_NODE_URL.
const DEFAULT_NODE = import.meta.env.VITE_NODE_URL ?? "/api";

type Probe = { status: "idle" } | { status: "loading" } | { status: "ok"; health: Health; metrics: Metrics } | { status: "error"; message: string };

export function App() {
  const [nodeUrl, setNodeUrl] = useState(DEFAULT_NODE);
  const [probe, setProbe] = useState<Probe>({ status: "idle" });

  async function connect() {
    setProbe({ status: "loading" });
    try {
      const client = new ObservationClient(nodeUrl);
      const [health, metrics] = await Promise.all([client.health(), client.metrics()]);
      setProbe({ status: "ok", health, metrics });
    } catch (err) {
      setProbe({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <main className="page">
      <section className="hero">
        <h1>vouch</h1>
        <p className="tagline">
          A testbed for <strong>ALMA</strong> — a protocol for portable identity and trust
          between self-governing communities. Villages set their own rules of trust; agents
          earn, trade, and carry their identity across borders as villages recognize one another.
        </p>
        <a className="cta" href={SKILL_URL} target="_blank" rel="noreferrer">
          Work with a node → read the Skill
        </a>
      </section>

      <section className="watch">
        <h2>Watch a node</h2>
        <p className="muted">
          Point at a running observation server. The reference server runs locally on{" "}
          <code>:8787</code> (<code>bun examples/observe.ts</code>); in dev this page proxies{" "}
          <code>/api</code> to it.
        </p>
        <div className="row">
          <input
            aria-label="node URL"
            value={nodeUrl}
            onChange={(e) => setNodeUrl(e.target.value)}
            spellCheck={false}
          />
          <button type="button" onClick={connect} disabled={probe.status === "loading"}>
            {probe.status === "loading" ? "Connecting…" : "Connect"}
          </button>
        </div>

        {probe.status === "error" && <p className="error">{probe.message}</p>}

        {probe.status === "ok" && (
          <div className="metrics">
            <div className="badge">tick {probe.health.tick}</div>
            <Stat label="regions" value={`${probe.metrics.regions.recognized}/${probe.metrics.regions.total} recognized`} />
            <Stat label="agents" value={`${probe.metrics.agents.residents} residents · ${probe.metrics.agents.treasuries} treasury`} />
            <Stat label="currency" value={String(probe.metrics.agents.totalCurrency)} />
            <Stat label="gini" value={probe.metrics.agents.currencyGini.toFixed(3)} />
            <Stat label="log" value={`${probe.metrics.log.length} events · ${probe.metrics.log.digest}`} />
          </div>
        )}
      </section>

      <footer>
        <a href="https://github.com/AlmaNetwork/vouch" target="_blank" rel="noreferrer">repo</a>
        <a href={SKILL_URL} target="_blank" rel="noreferrer">skill</a>
        <a href="https://github.com/AlmaNetwork/vouch/blob/main/openapi/read.yaml" target="_blank" rel="noreferrer">read API</a>
        <a href="https://github.com/AlmaNetwork/vouch/blob/main/docs/quickstart.md" target="_blank" rel="noreferrer">quickstart</a>
      </footer>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}
