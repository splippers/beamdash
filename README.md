# beamdash

> Server management dashboard for [BeamMP](https://beammp.com) — the multiplayer mod for BeamNG.drive

**beamdash** gives you a unified CLI, REST API, and web dashboard to create, configure, monitor, and manage BeamMP game server instances — whether you're running one server or fifty.

## Features

- **CLI** — Full lifecycle management via `beamctl`: create, start, stop, restart, destroy instances; manage mods, presets, and configs
- **Web Dashboard** — Browser-based admin with live status, config editor, mod manager, preset manager, and color-coded log viewer
- **REST API** — JSON API for programmatic control; powers the dashboard and is fully usable on its own
- **systemd Integration** — Each instance runs as a managed systemd service with auto-restart and proper PID tracking
- **Mod Management** — Pool-based mod workflow: upload mods once, enable/disable per-instance via manifest, sync with hardlinks
- **Presets** — Save and load named server configurations (map, mods, settings) for quick swaps
- **Import** — Import existing BeamMP server directories, including legacy INI configs
- **No Dependencies** — The API uses only Python stdlib. Frontend loads from CDN (Bootstrap, Chart.js). Zero package installs.

## Quick Start

```bash
# Install system-wide (to /opt/beamdash)
sudo ./install.sh

# Or run from the repo directory
sudo ./beamctl create myserver
sudo ./beamctl start myserver
sudo ./beamctl status

# Start the web dashboard
sudo ./beamctl api start
# Open http://<your-host>:8999
```

## Commands

### Instance Lifecycle

```
beamctl create <name>            Create a new server instance
beamctl destroy <name>           Delete an instance (with confirmation)
beamctl start <name>             Start an instance
beamctl stop <name>              Stop an instance (SIGTERM → SIGKILL)
beamctl restart <name>           Restart an instance
beamctl status [name]            Show instance status(es)
beamctl logs <name>              Tail instance logs
```

### Configuration

```
beamctl config <name>            Show full TOML config
beamctl get <name> <key>         Get a single config value
beamctl set <name> <key>=<val>   Set a config value (string, number, or bool)
```

### Mods

```
beamctl mod pool                 List mods in the shared pool
beamctl mod active <name>        List mods enabled on an instance
beamctl mod enable <name> <mod>  Enable a mod on an instance
beamctl mod disable <name> <mod> Disable a mod on an instance
beamctl mod sync <name>          Sync enabled mods from manifest
beamctl mod scan <name>          Rebuild manifest from active mods
```

### Presets

```
beamctl preset save <name> <preset>     Save instance config as a preset
beamctl preset load <name> <preset>     Load a preset (restarts instance)
beamctl preset list <name>              List presets for an instance
beamctl preset delete <name> <preset>   Delete a preset
```

### Administration

```
beamctl import <source> <name>   Import an existing server directory
beamctl update                   Download latest BeamMP-Server binary
beamctl version                  Show versions
beamctl install                  Install system-wide
beamctl api start|stop|restart|status|key   Manage the API daemon
```

## Web Dashboard

Start the API server and open `http://<host>:8999`:

```
beamctl api start
```

Configure the API key in `/etc/beamdash/api.conf` (or skip for open access):

```ini
KEY="your-secret-key"
HOST="0.0.0.0"
PORT=8999
```

### Dashboard Features

| Tab | Description |
|---|---|
| **Dashboard** | Instance overview grid with start/stop/manage + stats chart |
| **Overview** | Server info, status badge, key settings |
| **Config** | Form-based config editor (all TOML settings) |
| **Mods** | Pool browser + active mod list + enable/disable/sync |
| **Presets** | Save, load, and delete named presets |
| **Logs** | Color-coded live log viewer with auto-refresh |

## API

The REST API is a thin wrapper around `beamctl`. All endpoints (except static files and `/`) require `X-API-Key` header matching the configured key.

```
GET    /                                     Web UI
GET    /instances                            List instances
GET    /instances/<name>                     Instance details
GET    /instances/<name>/config              Raw TOML config
GET    /instances/<name>/config/json         Parsed JSON config
GET    /instances/<name>/status              Status output
GET    /instances/<name>/logs                Last 200 log lines
GET    /instances/<name>/mods/pool           Pool mods
GET    /instances/<name>/mods/active         Active mods
GET    /instances/<name>/presets             Listed presets
POST   /instances/<name>/start               Start instance
POST   /instances/<name>/stop                Stop instance
POST   /instances/<name>/restart             Restart instance
POST   /instances/<name>/mods/enable         Enable mod
POST   /instances/<name>/mods/disable        Disable mod
POST   /instances/<name>/mods/sync           Sync mods
POST   /instances/<name>/presets/save        Save preset
POST   /instances/<name>/presets/load        Load preset
POST   /instances/<name>/presets/delete      Delete preset
PUT    /instances/<name>/config              Update config
DELETE /instances/<name>                     Destroy instance
```

## Deployment Model

```
/opt/beamdash/            # Installation root
  beamctl                 # CLI binary (symlinked to /usr/local/bin)
  bin/BeamMP-Server       # BeamMP server binary
  conf/                   # Config templates + systemd units
  instances/<name>/       # Per-instance data (config, mods, logs)
  lib/api.py              # API server
  lib/web/                # Frontend SPA
  logs/                   # PID files + instance logs
  examples/               # Preset examples
```

Instances run as systemd templated services:

```bash
systemctl enable beammp@myserver
systemctl start beammp@myserver
systemctl enable beammp-api
systemctl start beammp-api
```

## Configuration

**Global** (`/etc/beamdash/beamdash.conf`):

```ini
DEFAULT_USER=beammp
DEFAULT_GROUP=beammp
```

**Per-instance** (`instances/<name>/ServerConfig.toml`):

```toml
[General]
Port = 30814
MaxPlayers = 10
MaxCars = 8
Map = "/levels/gridmap_v2/info.json"
AuthKey = "CHANGE_ME"
```

Override paths via environment variables: `BEAMDASH_ROOT`, `INSTANCES_DIR`, `LOGS_DIR`, `CONF_DIR`.

## Development

```bash
git clone https://github.com/splippers/beamdash
cd beamdash

# Run integration tests (requires root for instance start/stop)
sudo ./test_integration.sh

# Start the API server directly for testing
python3 lib/api.py
```

No build step required. The entire project is shell scripts, Python stdlib, and vanilla JS. Edit and re-run.

## License

MIT
