<p align="center">
  <img src="src-tauri/icons/icon.svg" width="112" height="112" alt="Pi Switch icon">
</p>

# pi-switch

A cc-switch equivalent for the [Pi coding agent](https://github.com/badlogic/pi-mono). Launch workflow profiles, switch providers and models, rotate keys, toggle MCP servers, audit skills, and validate subagents — from a Tauri desktop app, terminal UI, or the command line.

## Desktop app

The desktop app provides the same config-safe operations in a clean CC Switch-style interface. It reuses the CLI core, including file locks, backups, atomic writes, schema validation, and macOS Keychain handling.

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

The desktop bridge receives secrets through stdin, never command-line arguments, and does not return provider API keys to the webview.

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
| mcp | `~/.pi/agent/mcp.json`, `<cwd>/.pi/mcp.json` | yes (the `disabled` flag only) |
| mcp (shared layers) | `~/.config/mcp/mcp.json`, `<cwd>/.mcp.json` | never |
| skills | `settings.skills[]`, `settings.ccPlugins[]` | yes |
| agents | `~/.pi/agent/agents/*.md` | read only |
| import | `~/.cc-switch/cc-switch.db` | read only |

`pi-switch paths` prints this at runtime. Every file pi-switch rewrites is copied to `~/.pi/agent/pi-switch-backups/<name>.<timestamp>` first, and writes go through a temp file plus rename, so a crash cannot leave a truncated `models.json` (which stops Pi from starting).

Changes to `models.json` and `settings.json` take effect the next time Pi starts. MCP toggles need `/reload` inside Pi.

## Commands

```
pi-switch                          interactive switcher
pi-switch profiles                list startup profiles
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

```bash
pi-switch run code
pi-switch run novel
pi-switch run obsidian
pi-switch run novel -- --help       # forward Pi flags after --
pi-switch run novel --dry-run       # inspect without launching
```

The default `code` profile keeps the caller's current directory. Fixed workflow profiles move to their configured roots before Pi starts. `/mode` remains a lightweight in-session switch; it does not replace startup resource isolation.

`--json` works on `ls`, `test`, `import`, `mcp ls`, `skills ls`, `agents ls` and `doctor`. `test`, `doctor` and `agents` exit non-zero when they find an error, so they drop into a pre-commit hook or CI step as-is.

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

Import never overwrites: a name that already exists gets an `-<app_type>` or `-2` suffix, since the existing entry is usually the hand-tuned one. Imported models get conservative defaults — 200k context, 32k output, `reasoning: false`, zero cost — because a relay's real limits are unknown, and a relay that silently drops `thinking` returns empty text. Fix them with `pi-switch` on the models tab, or `sync` against the live endpoint.

Keys arrive in plaintext; `pi-switch key <provider>` moves them into the keychain.

## Tests

```bash
npm test
```

Covers agent frontmatter validation, cc-switch conversion, provider CRUD guardrails, key resolution, model diffing, and MCP layering. Config tests run against a temporary `PI_CODING_AGENT_DIR`, never the real one.
