# beamdash — Planning Transcript

## Project Overview

**beamdash** is a server management tool for [BeamMP](https://beammp.com) — the multiplayer mod for *BeamNG.drive*. It provides:
- `beamctl` CLI for creating/configuring/starting/stopping BeamMP server instances
- REST API (Python stdlib, no deps) for programmatic management on port 8999
- SPA web dashboard (vanilla JS, Bootstrap 5, Chart.js) for browser-based admin
- systemd-based deployment for running instances as managed services

## Architecture

```
beamctl  (bash, 681 lines)     — main CLI entry point, dispatches subcommands
lib/functions.sh  (86 lines)   — shell library (paths, validation, TOML reading)
lib/api.py  (335 lines)        — REST API server + web UI static file server
lib/web/{index.html,app.js,style.css}  — SPA frontend
conf/  — beamdash.conf, api.conf, ServerConfig.toml, systemd units
bin/BeamMP-Server  — pre-built x86-64 BeamMP binary
install.sh  — deploys to /opt/beamdash, creates beammp user, installs systemd units
examples/  — monaco.toml, west_coast.toml presets
```

### CLI Commands

| Command | Status |
|---|---|
| `create`, `destroy`, `start`, `stop`, `restart` | Done |
| `status`, `logs`, `config`, `set`, `get` | Done |
| `mod {pool,active,enable,disable,sync,scan}` | Done |
| `preset {save,load,list,delete}` | Done |
| `import`, `install`, `update`, `version` | Done |
| `api {start,stop,restart,status,key}` | Done |

### API Endpoints

| Method | Path | Auth | Action |
|---|---|---|---|
| GET | `/` | No | Serves SPA |
| GET | `/style.css`, `/app.js` | No | Static files |
| GET | `/instances` | Yes | List instances |
| GET | `/instances/<name>` | Yes | Instance status |
| GET | `/instances/<name>/config` | Yes | Raw TOML config |
| GET | `/instances/<name>/config/json` | Yes | Parsed JSON config |
| GET | `/instances/<name>/status` | Yes | Status output |
| GET | `/instances/<name>/logs` | Yes | Last 200 log lines |
| GET | `/instances/<name>/mods/pool` | Yes | Pool mods |
| GET | `/instances/<name>/mods/active` | Yes | Active mods |
| GET | `/instances/<name>/presets` | Yes | List presets |
| POST | `/instances/<name>/start\|stop\|restart` | Yes | Lifecycle |
| POST | `/instances/<name>/mods/{enable,disable,sync}` | Yes | Mod ops |
| POST | `/instances/<name>/presets/{save,load,delete}` | Yes | Preset ops |
| PUT | `/instances/<name>/config` | Yes | Update config |
| DELETE | `/instances/<name>` | Yes | Destroy instance |

## Bugs & Issues

### HIGH
- **Log viewer broken with API key auth** — `app.js:519` uses raw `fetch()` instead of `App.api()`, so `X-API-Key` is not sent → logs tab returns 401 when auth is enabled

### MEDIUM
- **No SIGTERM handler in API server** — `api.py` has no signal handler; systemd sends SIGTERM → unclean shutdown
- **Single-threaded HTTP server** — `HTTPServer` without `ThreadingMixIn`; concurrent requests block
- **Config parsing in CLI fragile** — `beamctl:262-270` value type detection incomplete; sed not line-anchored
- **`su -s /bin/bash` may fail** — non-standard `su` usage; `sudo -u` or `runuser` more portable

### LOW
- No `.gitignore` — 12MB binary tracked; potential key exposure
- No mod upload via web UI — users must manually SCP .zip files
- No instance creation/destruction from web UI — CLI-only
- API config loaded as class variable — changes require restart
- No `[server]` section mod support in CLI — only `[client]` mods
- Large log file inefficiency — reads entire file into memory
- `disabled` attribute bug in `app.js:343` — no-op code
- No uninstall functionality

## Roadmap

### Phase 1: Critical Fixes
- [ ] Fix log viewer auth (`app.js` → use `App.api()`)
- [ ] Add SIGTERM handler to `api.py` for clean shutdown
- [ ] Add `.gitignore` (binary, instances/, logs/, .env)

### Phase 2: Hardening
- [ ] Add `ThreadingMixIn` to API server for concurrency
- [ ] Fix `su` → `runuser`/`sudo -u` for portability
- [ ] Add `--json` flag to beamctl for machine-readable output
- [ ] Add healthcheck endpoint (`GET /health`, no auth)
- [ ] Optimize log reading (seek-from-end)

### Phase 3: Web UI Features
- [ ] Mod upload (drag-and-drop / file picker → API → pool)
- [ ] Instance creation from dashboard
- [ ] Instance destruction from dashboard (with confirmation)
- [ ] API key management from web UI

### Phase 4: Extended Features
- [ ] Server-side mod management (`[server]` manifest section)
- [ ] Rate limiting / abuse protection for API
- [ ] Expand integration tests (batch config, DELETE, log reading)
- [ ] Add unit tests for `functions.sh` and `parse_toml_config`

## Progress Log

- **2026-05-08**: Repo initialized and pushed to github.com/splippers/beamdash
- **2026-05-08**: Full repo audit complete — documented all bugs, features, and roadmap above
