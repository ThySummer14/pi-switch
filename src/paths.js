/**
 * paths.js — every file pi-switch is allowed to touch, resolved in one place.
 *
 * Pi's agent dir follows $PI_CODING_AGENT_DIR, defaulting to ~/.pi/agent.
 * cc-switch's SQLite DB is opened read-only and never written.
 */

import { homedir } from "node:os";
import { join } from "node:path";

export const HOME = homedir();

/** Pi's global agent dir. Honours $PI_CODING_AGENT_DIR the same way pi does. */
export function agentDir() {
  return process.env.PI_CODING_AGENT_DIR || join(HOME, ".pi", "agent");
}

export const paths = {
  get agentDir() {
    return agentDir();
  },
  /** Provider + model catalog. The file pi-switch mutates most. */
  get models() {
    return join(agentDir(), "models.json");
  },
  /** defaultProvider / defaultModel / skills[] / packages[] live here. */
  get settings() {
    return join(agentDir(), "settings.json");
  },
  /** Named startup profiles used by `pi-switch run`. */
  get profiles() {
    return join(agentDir(), "profiles.json");
  },
  /** Declarative registry of local package-maintenance check scripts. */
  get maintenanceChecks() {
    return join(agentDir(), "maintenance-checks.json");
  },
  /** Cached copy of the credential-free official Provider template catalog. */
  get providerCatalog() {
    return join(agentDir(), "pi-switch-provider-catalog.json");
  },
  /** Pi-owned global MCP override layer (precedence 4 of 6). */
  get piMcp() {
    return join(agentDir(), "mcp.json");
  },
  /** Shared tool-agnostic MCP config (precedence 1 of 6) — where the real servers are. */
  get sharedMcp() {
    return join(HOME, ".config", "mcp", "mcp.json");
  },
  /** Global subagents. Files MUST sit directly here — the loader does not recurse. */
  get agents() {
    return join(agentDir(), "agents");
  },
  /** cc-plugins owns this dir and rm -rf's it on refcount zero. Never write into it. */
  get ccPluginsAgents() {
    return join(agentDir(), "agents", "cc-plugins");
  },
  /** cc-switch database — read-only source for provider import. */
  get ccSwitchDb() {
    return join(HOME, ".cc-switch", "cc-switch.db");
  },
  /** Where pi-switch keeps timestamped backups of anything it rewrites. */
  get backups() {
    return join(agentDir(), "pi-switch-backups");
  },
};

/** Collapse $HOME to ~ for display. */
export function tildify(p) {
  return p.startsWith(HOME) ? "~" + p.slice(HOME.length) : p;
}

/** Expand a leading ~ so settings.skills entries can be stat'ed. */
export function untildify(p) {
  if (p === "~") return HOME;
  return p.startsWith("~/") ? join(HOME, p.slice(2)) : p;
}
