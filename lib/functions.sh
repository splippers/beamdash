BEAMDASH_VERSION="1.1.0"
BEAMDASH_ROOT="${BEAMDASH_ROOT:-/opt/beamdash}"
BEAMMP_BIN="${BEAMDASH_ROOT}/bin/BeamMP-Server"
INSTANCES_DIR="${INSTANCES_DIR:-${BEAMDASH_ROOT}/instances}"
LOGS_DIR="${LOGS_DIR:-${BEAMDASH_ROOT}/logs}"
CONF_DIR="${CONF_DIR:-${BEAMDASH_ROOT}/conf}"
BEAMDASH_CONF="${CONF_DIR}/beamdash.conf"
API_CONF="${CONF_DIR}/api.conf"

require_root() {
    if [[ $EUID -ne 0 ]]; then
        echo "Error: This operation requires root privileges." >&2
        exit 1
    fi
}

instance_dir() { echo "${INSTANCES_DIR}/$1"; }
instance_conf() { echo "$(instance_dir "$1")/ServerConfig.toml"; }
instance_presets_dir() { echo "$(instance_dir "$1")/presets"; }
instance_preset_conf() { echo "$(instance_presets_dir "$1")/$2.toml"; }
instance_preset_mods() { echo "$(instance_presets_dir "$1")/$2-mods.toml"; }
instance_mods_manifest() { echo "$(instance_dir "$1")/mods.toml"; }
instance_resources_client() { echo "$(instance_dir "$1")/Resources/Client"; }
instance_resources_server() { echo "$(instance_dir "$1")/Resources/Server"; }
instance_log() { echo "${LOGS_DIR}/$1.log"; }
instance_pidfile() { echo "${LOGS_DIR}/$1.pid"; }

load_beamdash_conf() {
    [[ -f "$BEAMDASH_CONF" ]] && source "$BEAMDASH_CONF"
    DEFAULT_USER="${DEFAULT_USER:-beammp}"
    DEFAULT_GROUP="${DEFAULT_GROUP:-beammp}"
}

validate_instance() {
    local name="$1"
    [[ -z "$name" ]] && { echo "Error: instance name required." >&2; return 1; }
    [[ -d "$(instance_dir "$name")" ]] && return 0
    echo "Error: instance '$name' not found." >&2
    return 1
}

list_instances() {
    local instances=()
    for d in "$INSTANCES_DIR"/*/; do
        [[ -d "$d" ]] && instances+=("$(basename "$d")")
    done
    echo "${instances[@]}"
}

check_binary() {
    if [[ ! -x "$BEAMMP_BIN" ]]; then
        echo "Error: BeamMP binary not found at $BEAMMP_BIN" >&2
        return 1
    fi
    return 0
}

get_pid() {
    local pidfile="$(instance_pidfile "$1")"
    if [[ -f "$pidfile" ]]; then
        cat "$pidfile"
    fi
}

is_running() {
    local pid=$(get_pid "$1")
    [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

read_toml_val() {
    local file="$1" key="$2"
    grep -oP "^\s*${key}\s*=\s*\K.+" "$file" 2>/dev/null | head -1 | tr -d '"'
}

collect_mods_pool() {
    local pool_dir="$1"
    if [[ -d "$pool_dir" ]]; then
        ls "$pool_dir"/*.zip 2>/dev/null | while read f; do basename "$f"; done
    fi
}

# Hardlink a mod from pool to target, copy if cross-device
link_mod() {
    local src="$1" dst="$2"
    ln "$src" "$dst" 2>/dev/null || cp "$src" "$dst"
}
