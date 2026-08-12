# Changelog

All notable changes to pi-switch are documented here. Versions follow
[Semantic Versioning](https://semver.org/).

## [0.4.0] - 2026-08-13

First tagged release. The 0.3.x line covered the TUI core, the Tauri desktop
app, cc-switch import, and the doctor checks; this release rounds off the
desktop launch story and broadens provider support.

### Added

- `pi-switch resolve-profile <name> --json [--cwd <path>]` — a machine-readable
  launch contract (profile, mode, canonical cwd, Pi executable + version,
  trust decision, argv, environment, resource manifest hash) for desktop hosts
  and integrations to launch Pi exactly like `pi-switch run` would.
- Provider names may now contain spaces (`OpenAI API`). Leading/trailing
  whitespace and `/` are still rejected.
- OpenCode Zen provider preset (`https://opencode.ai/zen/v1`, free
  `deepseek-v4-flash-free` model) in the bundled templates and the remote
  template catalog.
- Context-window registry entry for `deepseek-v4-flash-free`.
- Provider error diagnosis for two silent failure modes:
  - OpenAI-compatible endpoints that reject the `developer` message role
    (Kimi-family endpoints) — Pi Switch now marks those models with
    `compat.supportsDeveloperRole = false` so Pi sends `system` instead.
  - OpenCode Zen misconfiguration where the Base URL points at the website
    instead of the API endpoint (HTML 404 responses).
- Continuous integration: `.github/workflows/ci.yml` runs the full test suite
  on Node 22 across Ubuntu and macOS.

### Changed

- `resolvePiExecutable` resolves the `pi` binary with `where` on Windows and
  `which` elsewhere; `isWithin` path checks use the platform separator.
- `catalog/provider-presets.json` `updatedAt` bumped to 2026-08-13.

### Fixed

- `resolveProfile` validates a requested cwd against a fixed profile root
  before honoring it, so a desktop host cannot silently launch a fixed
  profile outside its configured directory.
