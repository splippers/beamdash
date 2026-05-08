#!/usr/bin/env python3
"""
beamdash REST API + Web UI
- Serves the SPA dashboard at /
- Serves static files from lib/web/
- API endpoints at /instances/*, /status, etc.
"""
import os
import sys
import json
import subprocess
import http.server
import mimetypes
import logging
from pathlib import Path

BEAMDASH_ROOT = Path(os.environ.get("BEAMDASH_ROOT", "/opt/beamdash"))
API_CONF = Path(os.environ.get("API_CONF", "/etc/beamdash/api.conf"))
BEAMCTL = BEAMDASH_ROOT / "beamctl"
WEB_ROOT = BEAMDASH_ROOT / "lib" / "web"
LOGS_DIR = Path(os.environ.get("LOGS_DIR", BEAMDASH_ROOT / "logs"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s beamdash-api %(levelname)s %(message)s",
)
log = logging.getLogger("beamdash-api")


def load_config():
    config = {"HOST": "0.0.0.0", "PORT": 8999, "KEY": ""}
    if API_CONF.exists():
        with open(API_CONF) as f:
            for line in f:
                line = line.strip()
                if "=" in line and not line.startswith("#"):
                    k, v = line.split("=", 1)
                    config[k.strip()] = v.strip().strip('"')
    return config


def run_beamctl(*args):
    try:
        r = subprocess.run(
            [str(BEAMCTL), *args],
            capture_output=True, text=True, timeout=30,
            env={**os.environ, "BEAMDASH_ROOT": str(BEAMDASH_ROOT)},
        )
        return {"ok": r.returncode == 0, "stdout": r.stdout.strip(), "stderr": r.stderr.strip()}
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "command timed out"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def list_instances():
    d = Path(os.environ.get("INSTANCES_DIR", BEAMDASH_ROOT / "instances"))
    if not d.exists():
        return []
    return [p.name for p in d.iterdir() if p.is_dir()]


def read_log(name, max_lines=200):
    log_file = LOGS_DIR / f"{name}.log"
    if not log_file.exists():
        return "(no log file)"
    try:
        with open(log_file) as f:
            lines = f.readlines()
        return "".join(lines[-max_lines:])
    except Exception as e:
        return f"(error reading log: {e})"


MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
}


class APIHandler(http.server.BaseHTTPRequestHandler):
    config = load_config()

    def log_message(self, fmt, *args):
        log.info("%s - %s", self.client_address[0], fmt % args)

    def _auth(self):
        key = self.headers.get("X-API-Key", "")
        if self.config["KEY"] and key != self.config["KEY"]:
            self._json(401, {"ok": False, "error": "invalid API key"})
            return False
        return True

    def _json(self, status, data):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def _ok(self, data):
        self._json(200, data)

    def _error(self, status, msg):
        self._json(status, {"ok": False, "error": msg})

    def _serve_file(self, fpath):
        fpath = Path(fpath)
        if not fpath.is_file():
            self._error(404, "not found")
            return
        ext = fpath.suffix.lower()
        ctype = MIME_TYPES.get(ext, mimetypes.guess_type(str(fpath))[0] or "application/octet-stream")
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        with open(fpath, "rb") as f:
            self.wfile.write(f.read())

    def _try_serve_static(self, path):
        """Try to serve a file from WEB_ROOT. Returns True if served."""
        if not path:
            self._serve_file(WEB_ROOT / "index.html")
            return True
        # Normalize path to prevent directory traversal
        rel = Path(path).relative_to("/") if path.startswith("/") else Path(path)
        full = (WEB_ROOT / rel).resolve()
        if str(full).startswith(str(WEB_ROOT.resolve())) and full.is_file():
            self._serve_file(full)
            return True
        return False

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-API-Key")
        self.end_headers()

    def do_GET(self):
        raw_path = self.path.split("?")[0].rstrip("/")
        path = raw_path.lstrip("/")

        # Serve SPA entry point at root
        if not path:
            self._serve_file(WEB_ROOT / "index.html")
            return

        # Serve static files (CSS, JS, etc.) — no auth
        if self._try_serve_static(path):
            return

        # API routes require auth
        if not self._auth():
            return

        parts = path.split("/")

        if parts[0] == "instances":
            if len(parts) == 1:
                self._ok({"ok": True, "instances": list_instances()})
            elif len(parts) >= 2:
                name = parts[1]
                if parts[2:] == ["config"]:
                    r = run_beamctl("config", name)
                    self._ok({"ok": r["ok"], "instance": name, "config": r.get("stdout", ""), "error": r.get("stderr", "")})
                elif parts[2:] == ["config", "json"]:
                    r = run_beamctl("config", name)
                    config_text = r.get("stdout", "")
                    parsed = parse_toml_config(config_text)
                    self._ok({"ok": r["ok"], "instance": name, "config": parsed, "error": r.get("stderr", "")})
                elif parts[2:] == ["status"]:
                    r = run_beamctl("status", name)
                    self._ok({"ok": r["ok"], "instance": name, "output": r.get("stdout", ""), "error": r.get("stderr", "")})
                elif parts[2:] == ["logs"]:
                    self._ok({"ok": True, "instance": name, "stdout": read_log(name)})
                elif parts[2:] == ["mods", "pool"]:
                    r = run_beamctl("mod", "pool", name)
                    self._ok({"ok": r["ok"], "instance": name, "mods": split_lines(r.get("stdout", ""))})
                elif parts[2:] == ["mods", "active"]:
                    r = run_beamctl("mod", "active", name)
                    self._ok({"ok": r["ok"], "instance": name, "mods": split_lines(r.get("stdout", ""))})
                elif parts[2:] == ["presets"]:
                    r = run_beamctl("preset", name, "list")
                    self._ok({"ok": r["ok"], "instance": name, "presets": split_lines(r.get("stdout", ""))})
                elif parts[2:] == []:
                    r = run_beamctl("status", name)
                    self._ok({"ok": r["ok"], "instance": name, "output": r.get("stdout", ""), "error": r.get("stderr", "")})
                else:
                    self._error(404, "unknown endpoint")
            return

        self._error(404, f"not found: {raw_path}")

    def do_POST(self):
        if not self._auth():
            return

        path = self.path.split("?")[0].rstrip("/").lstrip("/")
        parts = path.split("/")
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length)) if length else {}

        if len(parts) >= 3 and parts[2] == "start":
            self._ok(run_beamctl("start", parts[1]))
        elif len(parts) >= 3 and parts[2] == "stop":
            self._ok(run_beamctl("stop", parts[1]))
        elif len(parts) >= 3 and parts[2] == "restart":
            self._ok(run_beamctl("restart", parts[1]))
        elif len(parts) >= 4 and parts[2] == "presets" and parts[3] == "load":
            preset = body.get("preset", "")
            self._ok(run_beamctl("preset", parts[1], "load", preset))
        elif len(parts) >= 4 and parts[2] == "presets" and parts[3] == "save":
            preset = body.get("preset", "")
            self._ok(run_beamctl("preset", parts[1], "save", preset))
        elif len(parts) >= 4 and parts[2] == "mods" and parts[3] == "enable":
            mod = body.get("mod", "")
            self._ok(run_beamctl("mod", "enable", parts[1], mod))
        elif len(parts) >= 4 and parts[2] == "mods" and parts[3] == "disable":
            mod = body.get("mod", "")
            self._ok(run_beamctl("mod", "disable", parts[1], mod))
        elif len(parts) >= 4 and parts[2] == "mods" and parts[3] == "sync":
            self._ok(run_beamctl("mod", "sync", parts[1]))
        elif len(parts) >= 5 and parts[2] == "presets" and parts[3] == "delete":
            preset = body.get("preset", "")
            self._ok(run_beamctl("preset", parts[1], "delete", preset))
        else:
            self._error(404, f"not found: {self.path}")

    def do_PUT(self):
        if not self._auth():
            return

        path = self.path.split("?")[0].rstrip("/").lstrip("/")
        parts = path.split("/")
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length)) if length else {}

        if len(parts) >= 3 and parts[2:] == ["config"]:
            name = parts[1]
            settings = body.get("settings", {})
            if body.get("key") and body.get("value"):
                settings[body["key"]] = body["value"]
            if not settings:
                self._error(400, "provide {\"key\": ..., \"value\": ...} or {\"settings\": {...}}")
                return
            results = []
            for k, v in settings.items():
                r = run_beamctl("set", name, f"{k}={v}")
                results.append({"key": k, "value": v, "ok": r["ok"], "error": r.get("stderr", "")})
            self._ok({"ok": all(r["ok"] for r in results), "instance": name, "results": results})
        else:
            self._error(404, f"not found: {self.path}")

    def do_DELETE(self):
        if not self._auth():
            return

        path = self.path.split("?")[0].rstrip("/").lstrip("/")
        parts = path.split("/")
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length)) if length else {}

        if len(parts) == 2 and parts[0] == "instances" and parts[1]:
            name = parts[1]
            if body.get("confirm") is not True:
                self._error(400, "must set confirm: true to destroy instance")
                return
            r = run_beamctl("destroy", name)
            self._ok({"ok": r["ok"], "instance": name, "output": r.get("stdout", ""), "error": r.get("stderr", "")})
        elif len(parts) >= 4 and parts[2] == "presets" and parts[3] == "delete":
            preset = body.get("preset", "")
            self._ok(run_beamctl("preset", parts[1], "delete", preset))
        else:
            self._error(404, f"not found: {self.path}")


def parse_toml_config(text):
    """Parse simple TOML key-value pairs into a structured dict."""
    result = {"Misc": {}, "General": {}}
    section = "General"
    for line in text.split("\n"):
        line = line.strip()
        if line.startswith("[") and line.endswith("]"):
            section = line.strip("[]").strip()
            if section not in result:
                result[section] = {}
        elif "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            k = k.strip()
            v = v.strip().strip('"')
            if section not in result:
                result[section] = {}
            result[section][k] = v
    return result


def split_lines(text):
    return [l.strip() for l in text.split("\n")
            if l.strip()
            and not l.strip().startswith("Instances")
            and not l.strip().startswith("Presets")
            and not l.strip().startswith("Mods")
            and not l.strip().startswith("Active")
            and not l.strip().startswith("Syncing")
            and "---" not in l]


def main():
    config = load_config()
    log.info("beamdash API + Web UI starting on %s:%s", config["HOST"], config["PORT"])
    if config["KEY"]:
        log.info("API key authentication enabled")
    else:
        log.warning("No API key configured! Set KEY in %s", API_CONF)

    server = http.server.HTTPServer(
        (config["HOST"], int(config["PORT"])), APIHandler
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()
        log.info("shutdown")


if __name__ == "__main__":
    main()
