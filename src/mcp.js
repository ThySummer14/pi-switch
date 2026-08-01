/**
 * mcp.js — list MCP servers across pi's config layers and manage pi-owned overrides.
 *
 * pi-mcp-adapter resolves servers from six files, later ones overriding earlier.
 * pi-switch writes the `disabled` flag only, and only into pi-owned layers, so a
 * shared config (~/.config/mcp/mcp.json) is never rewritten and credentials are
 * never copied between files.
 */

import { join } from "node:path";
import { HOME, paths } from "./paths.js";
import { readJson, updateJson } from "./store.js";

/** Config layers in precedence order (lowest first). */
export function layers(cwd = process.cwd()) {
  return [
    { id: "shared-global", file: paths.sharedMcp, owner: "shared", writable: false },
    { id: "agents-global", file: join(HOME, ".agents", "mcp.json"), owner: "shared", writable: false },
    { id: "pi-global", file: paths.piMcp, owner: "pi", writable: true },
    { id: "project", file: join(cwd, ".mcp.json"), owner: "shared", writable: false },
    { id: "pi-project", file: join(cwd, ".pi", "mcp.json"), owner: "pi", writable: true },
  ];
}

/**
 * Merge all layers into one server list.
 * Returns [{ name, command, disabled, definedIn[], effectiveLayer, disabledBy }].
 */
export function listServers(cwd = process.cwd()) {
  const merged = new Map();
  for (const layer of layers(cwd)) {
    const data = readJson(layer.file, null);
    const servers = data?.mcpServers;
    if (!servers || typeof servers !== "object") continue;
    for (const [name, spec] of Object.entries(servers)) {
      if (typeof spec !== "object" || spec === null) continue;
      const prev = merged.get(name);
      merged.set(name, {
        name,
        spec: { ...(prev?.spec || {}), ...spec },
        definedIn: [...(prev?.definedIn || []), layer.id],
        effectiveLayer: layer.id,
        disabled: spec.disabled === true ? true : spec.disabled === false ? false : (prev?.disabled ?? false),
        disabledBy: spec.disabled === true ? layer.id : spec.disabled === false ? null : (prev?.disabledBy ?? null),
      });
    }
  }
  return [...merged.values()].map(s => ({
    name: s.name,
    command: describeCommand(s.spec),
    url: typeof s.spec.url === "string" ? s.spec.url : null,
    commandName: typeof s.spec.command === "string" ? s.spec.command : null,
    args: Array.isArray(s.spec.args) ? s.spec.args.map(String) : [],
    env: s.spec.env || {},
    envKeys: Object.keys(s.spec.env || {}).sort(),
    lifecycle: s.spec.lifecycle ?? "eager",
    disabled: s.disabled,
    disabledBy: s.disabledBy,
    definedIn: s.definedIn,
    effectiveLayer: s.effectiveLayer,
    canEdit: true,
    canDelete: s.definedIn.some(id => id === "pi-global" || id === "pi-project"),
  }));
}

/** One-line summary of how a server is launched. */
function describeCommand(spec) {
  if (spec.url) return spec.url;
  const argv = [spec.command, ...(spec.args || [])].filter(Boolean);
  return argv.join(" ") || "(no command)";
}

/**
 * Toggle a server by writing `disabled` into a pi-owned layer.
 * scope "global" → ~/.pi/agent/mcp.json, "project" → <cwd>/.pi/mcp.json.
 */
export function setDisabled(name, disabled, { scope = "global", cwd = process.cwd() } = {}) {
  const servers = listServers(cwd);
  if (!servers.some(s => s.name === name)) {
    throw new Error(`MCP server "${name}" is not defined in any config layer`);
  }
  const file = scope === "project" ? join(cwd, ".pi", "mcp.json") : paths.piMcp;
  updateJson(file, data => {
    if (!data.mcpServers || typeof data.mcpServers !== "object") data.mcpServers = {};

    if (disabled) {
      data.mcpServers[name] = { ...(data.mcpServers[name] || {}), disabled: true };
    } else if (data.mcpServers[name]) {
      // Drop our own flag; only re-assert false when a lower layer still disables it.
      delete data.mcpServers[name].disabled;
      if (disabledByLowerLayer(name, file, cwd)) data.mcpServers[name].disabled = false;
      if (Object.keys(data.mcpServers[name]).length === 0) delete data.mcpServers[name];
    } else if (disabledByLowerLayer(name, file, cwd)) {
      data.mcpServers[name] = { disabled: false };
    }
  }, { mcpServers: {} });
  return { file, name, disabled };
}

function writableFile(scope, cwd) {
  if (scope === "project") return join(cwd, ".pi", "mcp.json");
  if (scope === "global") return paths.piMcp;
  throw new Error(`unknown MCP scope "${scope}"`);
}

function normalizeName(name) {
  const value = typeof name === "string" ? name.trim() : "";
  if (!value) throw new Error("MCP name is required");
  if (value.includes("\0")) throw new Error("MCP name contains an invalid character");
  return value;
}

function normalizeArgs(args) {
  if (args === undefined) return undefined;
  if (!Array.isArray(args) || args.some(value => typeof value !== "string")) {
    throw new Error("MCP args must be an array of strings");
  }
  return args;
}

function normalizeEnv(env) {
  if (env === undefined) return undefined;
  if (!env || typeof env !== "object" || Array.isArray(env)) {
    throw new Error("MCP env must be an object");
  }
  const result = {};
  for (const [key, value] of Object.entries(env)) {
    if (!key.trim() || typeof value !== "string") throw new Error("MCP env keys and values must be strings");
    result[key] = value;
  }
  return result;
}

function validateEffectiveSpec(spec, name) {
  const hasUrl = typeof spec.url === "string" && spec.url.trim();
  const hasCommand = typeof spec.command === "string" && spec.command.trim();
  if (!hasUrl && !hasCommand) throw new Error(`MCP "${name}" needs a command or URL`);
  if (hasUrl && hasCommand) throw new Error(`MCP "${name}" cannot define both command and URL`);
  if (spec.lifecycle !== undefined && !["eager", "lazy"].includes(spec.lifecycle)) {
    throw new Error("MCP lifecycle must be eager or lazy");
  }
}

/** Add or update a service in a Pi-owned layer without copying lower-layer secrets. */
export function upsertServer(name, patch = {}, { scope = "global", cwd = process.cwd() } = {}) {
  const id = normalizeName(name);
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("MCP spec must be an object");
  const servers = listServers(cwd);
  const existing = servers.find(server => server.name === id);
  const next = {
    ...(existing ? {
      ...(existing.url ? { url: existing.url } : { command: existing.commandName, args: existing.args }),
      lifecycle: existing.lifecycle,
    } : {}),
    ...patch,
  };
  if (patch.url) {
    delete next.command;
    delete next.args;
  }
  if (patch.command) delete next.url;
  next.args = normalizeArgs(next.args);
  next.env = normalizeEnv(next.env);
  validateEffectiveSpec(next, id);

  const file = writableFile(scope, cwd);
  updateJson(file, data => {
    if (!data.mcpServers || typeof data.mcpServers !== "object") data.mcpServers = {};
    const current = data.mcpServers[id] && typeof data.mcpServers[id] === "object" ? { ...data.mcpServers[id] } : {};
    const entry = { ...current };
    for (const key of ["command", "args", "url", "env", "lifecycle", "disabled"]) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        if (patch[key] === undefined || patch[key] === null || patch[key] === "") delete entry[key];
        else entry[key] = patch[key];
      }
    }
    if (patch.url) {
      delete entry.command;
      delete entry.args;
    }
    if (patch.command) delete entry.url;
    data.mcpServers[id] = entry;
  }, { mcpServers: {} });
  return { file, name: id, scope, action: existing ? "updated" : "added", envKeys: Object.keys(next.env || {}).sort() };
}

/** Remove only a Pi-owned definition/override; shared config remains untouched. */
export function deleteServer(name, { scope = "global", cwd = process.cwd() } = {}) {
  const id = normalizeName(name);
  const file = writableFile(scope, cwd);
  const local = readJson(file, null)?.mcpServers?.[id];
  if (!local || typeof local !== "object") {
    const row = listServers(cwd).find(server => server.name === id);
    if (!row) throw new Error(`MCP server "${id}" is not defined in any config layer`);
    throw new Error(`MCP server "${id}" is defined in a shared layer; shared config is read-only`);
  }
  updateJson(file, data => {
    if (data.mcpServers && typeof data.mcpServers === "object") {
      delete data.mcpServers[id];
      if (Object.keys(data.mcpServers).length === 0) delete data.mcpServers;
    }
  }, { mcpServers: {} });
  return { file, name: id, scope, action: "deleted" };
}

/** True when any layer below `file` sets disabled: true for `name`. */
function disabledByLowerLayer(name, file, cwd) {
  let seen = false;
  for (const layer of layers(cwd)) {
    if (layer.file === file) break;
    const spec = readJson(layer.file, null)?.mcpServers?.[name];
    if (spec && typeof spec === "object" && "disabled" in spec) seen = spec.disabled === true;
  }
  return seen;
}
