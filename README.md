<p align="center">
  <img src="src-tauri/icons/icon.svg" width="112" height="112" alt="Pi Switch icon">
</p>

# pi-switch

A cc-switch equivalent for the [Pi coding agent](https://github.com/badlogic/pi-mono). Launch workflow profiles, switch providers and models, rotate keys, toggle MCP servers, audit skills, and validate subagents — from a Tauri desktop app, terminal UI, or the command line.

## Desktop app

The desktop app provides the same config-safe operations in a clean CC Switch-style interface. It reuses the CLI core, including file locks, backups, atomic writes, schema validation, and macOS Keychain handling.

The Provider form includes credential-free templates for common OpenAI-compatible, Anthropic, DeepSeek, OpenCode Zen, and Volcengine Agent Plan endpoints. Templates only prefill public endpoint/API/model fields; API keys are always entered separately and existing Provider names cannot be overwritten by an add operation.

The **Provider template catalog** action can refresh those public defaults from this repository's fixed HTTPS catalog. Remote documents are versioned and strictly limited to the template id, label, description, Provider name, base URL, API type, and model id. Unknown fields, credential fields, redirects, non-HTTPS endpoints, unsupported API types, oversized responses, and invalid cache fingerprints are rejected. A successful sync writes only `~/.pi/agent/pi-switch-provider-catalog.json`; it never changes `models.json`, and the UI can discard the cache to return to the templates bundled with the app.

Requirements: Node.js 22 or newer, Rust, and the Tauri v2 system prerequisites. Node.js remains required when running the packaged app because its local bridge executes the existing JavaScript core.

```bash
npm install
npm run desktop          # start the desktop app in development mode
npm run build:desktop    # create the macOS app and DMG
npm run open:desktop     # open the built app
```

The macOS application is written to:

```text
src-tauri/target/release/bundle/macos/Pi Switch.app
```

Provider names may contain Unicode letters, numbers, spaces, `.`, `_` and `-`; they must not start or end with spaces or contain `/`.

The desktop bridge receives secrets through stdin, never command-line arguments, and does not return provider API keys to the webview.

The Providers page also has a configuration menu for a safe backup workflow. **Export** downloads a JSON file containing provider/model metadata but no API key, token, header, or password. **Restore** checks that file first, shows how many Providers/models will change, preserves the existing key reference for same-named Providers, and writes through the normal lock/backup/schema-validation path. New Providers are intentionally restored without credentials and can be keyed afterwards.

cc-switch does not know about Pi: it manages `claude`, `codex`, `gemini`, `openclaw` and friends, all of which keep their config somewhere other than `~/.pi/agent`. pi-switch covers Pi's own files, and imports from cc-switch's database read-only so existing relay setups do not need re-entering.

```
pi-switch   providers  models  mcp  skills  agents   botcf/claude-opus-5
──────────────────────────────────────────────────────────────────────────────
    provider      model (default)     api                 key              health
  ○ ark           1 model             openai-completions  env:ARK_API_KEY  ✓ 319ms
  ○ deepseek      2 models            openai-completions  env:DEEPSEEK…    ✓ 210ms
› ● botcf         claude-opus-5       anthropic-messages  cmd:security     ✗ 2 missing id
──────────────────────────────────────────────────────────────────────────────
enter use · m models · t test · T thinking · s sync · a e x add edit del · y key · i import
```

## Install

Node 22 or newer (it uses `node:sqlite` to read cc-switch's database). No dependencies.

```bash
npm link            # from this directory, or
ln -s "$PWD/bin/pi-switch.mjs" ~/.local/bin/pi-switch
```

Run `pi-switch` with no arguments for the UI.

## What it manages

| Tab | File | Written? |
|---|---|---|
| providers, models | `~/.pi/agent/models.json` | yes |
| default provider/model | `~/.pi/agent/settings.json` | yes |
| startup profiles | `~/.pi/agent/profiles.json` | no |
| Provider template cache | `~/.pi/agent/pi-switch-provider-catalog.json` | yes, explicit desktop sync only |
| mcp | `~/.pi/agent/mcp.json`, `<cwd>/.pi/mcp.json` | yes (the `disabled` flag only) |
| mcp (shared layers) | `~/.config/mcp/mcp.json`, `<cwd>/.mcp.json` | never |
| skills | `settings.skills[]`, `settings.ccPlugins[]` | yes |
| agents | `~/.pi/agent/agents/*.md` | read only |
| import | `~/.cc-switch/cc-switch.db` | read only |

`pi-switch paths` prints this at runtime. Every file pi-switch rewrites is copied to `~/.pi/agent/pi-switch-backups/<name>.<timestamp>` first, and writes go through a temp file plus rename, so a crash cannot leave a truncated `models.json` (which stops Pi from starting).

Changes to `models.json` and `settings.json` take effect the next time Pi starts. MCP toggles need `/reload` inside Pi.

Model entries can record `source` and Pi's `cost` fields. The desktop editor shows context window, output limit, reasoning, input modalities, source, and per-million-token USD rates; unknown pricing stays at zero rather than being guessed.

Model capabilities and context windows are kept separate from their evidence. A model list that only returns ids does not prove that a model is text-only or non-reasoning: unknown image support fails open to `input: ["text", "image"]`, while unknown reasoning remains off and is shown as **待确认**. Context windows use provider fields first, then the curated model registry; unknown rows use a clearly marked 200k fallback. Explicit server metadata wins, and manual edits are marked so the repair action will never overwrite them. The Models page's **修复已知能力** action repairs known model-family mismatches such as legacy `grok-4.5` rows that were saved as text-only with `reasoning: false`, and repairs known context windows when the row still uses the fallback. CC Switch/Codex catalog imports treat `input_modalities: ["text"]` and template reasoning fields as unverified hints; image/true hints are retained without locking them, so a stale catalog cannot permanently disable a capability.

For Qwen 3.8 Max Preview on an Anthropic-compatible Token Plan endpoint, Pi Switch records `thinkingLevelMap.off = null`. Pi then clamps an inherited `off` session to a supported thinking level instead of sending the endpoint's rejected `enable_thinking: false` value.

For Kimi K2/K3 models on OpenAI-compatible endpoints, Pi Switch records `compat.supportsDeveloperRole = false`: those endpoints accept `system` but reject the `developer` role Pi otherwise uses for reasoning models. A matching endpoint error is diagnosed with a repair hint instead of a raw JSON wall.

## Commands

```
pi-switch                          interactive switcher
pi-switch profiles                list startup profiles
pi-switch resolve-profile <name>  print a machine-readable launch contract
pi-switch run [profile]           launch Pi with a pinned workflow mode
pi-switch ls                       providers and the active default
pi-switch use <provider> [model]   set the default
pi-switch test [provider]          probe endpoints, compare model lists
pi-switch key <provider>           rotate a key (read from stdin)
pi-switch add --name … --url … --model … [--api …] (--key … | key via stdin) [--keychain]
pi-switch rm <provider>
pi-switch sync <provider> [--all]  add models the endpoint offers
pi-switch import [--all]           import from cc-switch
pi-switch mcp [ls|enable|disable]  MCP servers across all layers
pi-switch skills [ls|add|rm|prune]
pi-switch agents [ls]              list and validate subagents
pi-switch doctor [--probe]         check everything
pi-switch paths
```

## Startup profiles

Profiles live in `~/.pi/agent/profiles.json`. A profile selects the working directory and passes `--mode-start` to Pi; project `.pi/settings.json` files decide which inherited package resources remain loaded.

The novel profile sets `retryStallTimeoutMs: 300000`. `pi-switch` applies it both as the parent Pi CLI flag and as `PI_RETRY_STALL_TIMEOUT_MS`, which subagents inherit. Long high-thinking writing can remain silent for more than the retry extension's 90-second default; the five-minute value avoids aborting healthy reasoning without weakening code or Obsidian startup behavior.

```bash
pi-switch run code
pi-switch run novel
pi-switch run obsidian
pi-switch run novel -- --help       # forward Pi flags after --
pi-switch run novel --dry-run       # inspect without launching
```

The default `code` profile keeps the caller's current directory when launched from the CLI. A non-fixed profile may also define `desktopCwd`; the desktop launch button uses that directory because a packaged app's process cwd is its internal `Contents/Resources` folder, not a user project. When `desktopCwd` is absent, the desktop falls back to the user's home directory. Fixed workflow profiles continue to use `cwd`. A profile cannot define both `cwd` and `desktopCwd`. `/mode` remains a lightweight in-session switch; it does not replace startup resource isolation.

`pi-switch resolve-profile <name>` prints the launch contract a host would need to start that profile itself: the canonical working directory, Pi executable and version, trust decision, argv, environment, and a hash of the project resource manifest. `--cwd <path>` lets a caller request a specific workspace; fixed profiles reject a cwd outside their configured root. `--json` makes the contract machine-readable.

`--json` works on `ls`, `test`, `import`, `profiles`, `resolve-profile`, `mcp ls`, `skills ls`, `agents ls` and `doctor`. `test`, `doctor` and `agents` exit non-zero when they find an error, so they drop into a pre-commit hook or CI step as-is.

`settings.skills` exclusion patterns are shown as neutral `exclude` rows. A zero match on an exclusion is expected and is not a broken Skill path; missing concrete paths remain errors.

## Keys

`pi-switch key <provider>` reads the secret from stdin and, on macOS, stores it in the login keychain, leaving `models.json` holding only a lookup command:

```bash
printf %s "$NEW_KEY" | pi-switch key botcf
# models.json: "apiKey": "!/usr/bin/security find-generic-password -a you -s pi-botcf -w"
```

Rotating again touches only the keychain. Pass `--plaintext` to write the literal key into `models.json` instead; `doctor` flags providers in that state.

`pi-switch ls` shows how each key resolves — `env:NAME`, `cmd:…`, or `inline (plaintext)` — and reports unresolvable ones as errors rather than letting Pi fail at request time.

`pi-switch add` requires a key from `--key` or stdin. On macOS, add `--keychain` to store it in the login keychain; otherwise the new provider keeps it in plaintext in `models.json`.

## What doctor checks

The checks target the failure modes that produce no error message anywhere:

- A `models.json` document that fails Pi's schema validation, which makes Pi load zero custom providers.
- `defaultProvider` naming a provider that is not in `models.json` — Pi refuses to start.
- `defaultModel` not defined under the selected provider.
- An `apiKey` that cannot resolve: unset env var, failing keychain lookup.
- A model id configured but not offered by the endpoint — the `model_not_found` at request time. A dated variant (`claude-haiku-4-5` vs `claude-haiku-4-5-20251001`) is reported as an alias, not an error.
- `settings.skills` paths that no longer exist. Pi loads skills from explicit paths, so a stale one is a silent no-op.
- Agent frontmatter problems (below).
- Agent `.md` files in a subdirectory of `agents/`. The subagents loader does `readdirSync().filter(f => f.endsWith(".md"))` — no recursion — so nested files never load. `agents/cc-plugins/` is called out separately: that directory is owned by `@asermax/pi-cc-plugins` and gets `rm -rf`'d when its refcount hits zero, so hand-written files there are lost.
- MCP `env` entries referencing variables that are unset in the current shell.
- Local package patches registered in `~/.pi/agent/maintenance-checks.json`. Each entry is restricted to an absolute `.mjs` file and is invoked only as `node <script> --check`; exit `1` names the repair command, while exit `2` stops automatic repair for upstream review. Script output is never included in findings.

`--probe` adds the network round trip.

## Agent validation

`pi-switch agents` reads each file the way `@tintinweb/pi-subagents` does and reports where the two disagree:

| Written | Problem |
|---|---|
| `tools:` as a YAML list | `parseToolsField` does `String(val).split(",")` — a list stringifies into garbage tool names |
| `displayName:`, `promptMode:` | the loader reads snake_case only; camelCase keys are dropped silently |
| `model: sonnet` | a Claude Code alias; Pi resolves against `models.json` |
| `tools: read, websearch` | `websearch` is not a built-in (`read bash edit write grep find ls`); extension tools need `ext:` |
| `thinking: turbo` | not one of `off minimal low medium high xhigh max` |
| no body | the agent gets no system prompt |

## Importing from cc-switch

```bash
pi-switch import          # preview
pi-switch import --all    # write
```

Claude Code rows map onto `anthropic-messages`, with the `[1M]` suffix stripped from model ids and a trailing `/v1` removed from the base URL (Pi's client appends `/v1/messages` itself). Codex rows are read out of their TOML blob; `wire_api` picks between `openai-responses` and `openai-completions`. OpenClaw rows are already in Pi's shape.

Import never overwrites: a name that already exists gets an `-<app_type>` or `-2` suffix, since the existing entry is usually the hand-tuned one. The macOS desktop import stores imported keys in Keychain by default; turning that option off deliberately keeps them inline and shows a warning. Imported models use the context window declared by the provider/catalog when available, then a curated model registry (for example `kimi-k3` 1M, `deepseek-v4-pro` 1M, `grok-4.5` 500k and `step-3.7-flash` 256k); only unknown models use a visibly marked 200k fallback. Model-name or server capability evidence determines `input`/`reasoning`; unknown evidence is retained as **待确认** instead of being presented as a verified `false`.

Keys arrive in plaintext; `pi-switch key <provider>` moves them into the keychain.

## Tests

```bash
npm test
```

Covers agent frontmatter validation, cc-switch conversion, provider CRUD guardrails, key resolution, model diffing, and MCP layering. Config tests run against a temporary `PI_CODING_AGENT_DIR`, never the real one.
