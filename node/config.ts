// Track C — the single node configuration layer (task C8).
//
// One typed schema read from environment variables, with local-safe defaults and ZERO
// hardcoded cloud values. AWS (or any host) becomes "different values for the same keys"
// once that account exists — never a code change here (see deploy/DEPLOY.md).
//
// Hand-rolled (no zod import) so this entrypoint needs no dependencies of its own and
// resolves purely against the already-installed vouch-core / vouch-world. A later move to
// zod is a drop-in once `node/` becomes a real package.
//
// NOTE: keys whose OWNER is Track B (write bind port, durable store path, notary custody)
// are pass-through here — Track C's config is a SUPERSET that forwards them, it does not
// define their semantics. See deploy/B-CONTRACT.md.

export interface NodeConfig {
  /** world RNG seed — determinism anchor (§2-7). */
  readonly seed: string;
  /** read-only observation server bind port. */
  readonly readPort: number;
  /** write node bind port (Track B's surface; a stub on this build). */
  readonly writePort: number;
  /** genesis regions to seed (comma-separated env). */
  readonly seedRegions: readonly string[];
  /** how many ticks to run before serving (the read world is finite on this build). */
  readonly simTicks: number;
  /** notary key source — `seed://<hex>` | `env://<VAR>` | `file://<path>` (all resolve to a 32-byte seed today). */
  readonly notaryKeySource: string;
  /** durable append-store path — RESERVED (Track B); the log is in-memory on this build. */
  readonly durableStorePath: string;
  /** allowed CORS origins for the read server — [] = none, ["*"] = any. */
  readonly corsOrigins: readonly string[];
  /** URL of the write node, for clients/FE — informational. */
  readonly writeNodeUrl: string;
}

const DEFAULTS = {
  VOUCH_SEED: "vouch-node",
  READ_PORT: "8787",
  WRITE_PORT: "8788",
  SEED_REGIONS: "umi",
  SIM_TICKS: "8",
  NOTARY_KEY_SOURCE: "seed://09",
  DURABLE_STORE_PATH: "",
  CORS_ORIGINS: "",
  WRITE_NODE_URL: "",
} as const;

type Env = Record<string, string | undefined>;

function str(env: Env, key: keyof typeof DEFAULTS): string {
  const v = env[key];
  return v === undefined || v === "" ? DEFAULTS[key] : v;
}

function int(env: Env, key: keyof typeof DEFAULTS, { min = 0 }: { min?: number } = {}): number {
  const raw = str(env, key);
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) {
    throw new Error(`config: ${key}="${raw}" must be an integer >= ${min}`);
  }
  return n;
}

function list(env: Env, key: keyof typeof DEFAULTS): string[] {
  return str(env, key)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Load and validate the node config from the environment (defaults are local-safe). */
export function loadConfig(env: Env = process.env): NodeConfig {
  const seedRegions = list(env, "SEED_REGIONS");
  if (seedRegions.length === 0) throw new Error("config: SEED_REGIONS must name at least one region");
  for (const r of seedRegions) {
    if (!/^[a-z0-9]+$/.test(r)) throw new Error(`config: SEED_REGIONS region "${r}" must be lowercase alphanumeric`);
  }

  const notaryKeySource = str(env, "NOTARY_KEY_SOURCE");
  if (!/^(seed|env|file):\/\//.test(notaryKeySource)) {
    throw new Error(`config: NOTARY_KEY_SOURCE="${notaryKeySource}" must use a seed:// , env:// or file:// scheme`);
  }

  const readPort = int(env, "READ_PORT", { min: 1 });
  const writePort = int(env, "WRITE_PORT", { min: 1 });
  if (readPort === writePort) throw new Error(`config: READ_PORT and WRITE_PORT must differ (both ${readPort})`);

  return {
    seed: str(env, "VOUCH_SEED"),
    readPort,
    writePort,
    seedRegions,
    simTicks: int(env, "SIM_TICKS", { min: 0 }),
    notaryKeySource,
    durableStorePath: str(env, "DURABLE_STORE_PATH"),
    corsOrigins: list(env, "CORS_ORIGINS"),
    writeNodeUrl: str(env, "WRITE_NODE_URL"),
  };
}

/** Pretty one-line summary for boot logs (no secrets — only the key SOURCE, never material). */
export function describeConfig(c: NodeConfig): string {
  return [
    `seed=${c.seed}`,
    `read=:${c.readPort}`,
    `write=:${c.writePort}`,
    `regions=[${c.seedRegions.join(",")}]`,
    `ticks=${c.simTicks}`,
    `notary=${c.notaryKeySource.split("://")[0]}://…`,
    `cors=${c.corsOrigins.length ? c.corsOrigins.join("|") : "none"}`,
  ].join(" ");
}
