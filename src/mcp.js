/**
 * mcp.js — list MCP servers across pi's config layers and toggle them.
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
    env: s.spec.env || {},
    lifecycle: s.spec.lifecycle ?? "eager",
    disabled: s.disabled,
    disabledBy: s.disabledBy,
    definedIn: s.definedIn,
    effectiveLayer: s.effectiveLayer,
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
