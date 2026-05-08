#!/usr/bin/env bash
# beamdash integration test suite
# Run from project root: ./test_integration.sh
set -euo pipefail

BEAMDASH_ROOT="$(cd "$(dirname "$0")" && pwd)"
BEAMCTL="${BEAMDASH_ROOT}/beamctl"
TESTS_RUN=0 TESTS_PASSED=0 TESTS_FAILED=0

TEST_INSTANCE="testint-$(date +%s)"

pass() { echo "  PASS: $1"; TESTS_PASSED=$((TESTS_PASSED + 1)); }
fail() { echo "  FAIL: $1"; TESTS_FAILED=$((TESTS_FAILED + 1)); }
check() {
    TESTS_RUN=$((TESTS_RUN + 1))
    local desc="$1" expected="$2"; shift 2
    local output
    output=$("$@" 2>&1 || true)
    if echo "$output" | grep -qF "$expected"; then
        pass "$desc"
    else
        fail "$desc"
        echo "    Expected to contain: $expected"
        echo "    Got: $output"
    fi
}

cleanup() {
    rm -rf "${BEAMDASH_ROOT}/instances/$TEST_INSTANCE" "${BEAMDASH_ROOT}/logs/$TEST_INSTANCE."{log,pid}
    rm -rf /tmp/beamdash-test
}
trap cleanup EXIT

echo "=== beamdash Integration Tests ==="
echo "Test instance: $TEST_INSTANCE"
echo ""

# ----- CLI Tests -----

echo "--- CLI: create ---"
check "create instance" "created" \
    ${BEAMCTL} create "$TEST_INSTANCE"
check "create duplicate fails" "already exists" \
    ${BEAMCTL} create "$TEST_INSTANCE"

echo ""
echo "--- CLI: config ---"
check "config show" "gridmap_v2" \
    ${BEAMCTL} config "$TEST_INSTANCE"
check "set string" "Set Map = " \
    ${BEAMCTL} set "$TEST_INSTANCE" 'Map="/levels/monaco/info.json"'
check "get" "/levels/monaco/info.json" \
    ${BEAMCTL} get "$TEST_INSTANCE" "Map"
check "set numeric" "Set MaxPlayers = " \
    ${BEAMCTL} set "$TEST_INSTANCE" "MaxPlayers=16"
check "set bool" "Set Debug = " \
    ${BEAMCTL} set "$TEST_INSTANCE" "Debug=true"

echo ""
echo "--- CLI: mod management ---"
mkdir -p "${BEAMDASH_ROOT}/instances/$TEST_INSTANCE/mods"
dd if=/dev/urandom bs=1024 count=1 of="${BEAMDASH_ROOT}/instances/$TEST_INSTANCE/mods/test-mod.zip" 2>/dev/null
check "mod pool" "test-mod.zip" \
    ${BEAMCTL} mod pool "$TEST_INSTANCE"
check "mod enable" "Added" \
    ${BEAMCTL} mod enable "$TEST_INSTANCE" "test-mod.zip"
check "mod enable duplicate" "already in manifest" \
    ${BEAMCTL} mod enable "$TEST_INSTANCE" "test-mod.zip"
check "mod sync" "Linked 1 mods" \
    ${BEAMCTL} mod sync "$TEST_INSTANCE"
check "mod active" "test-mod.zip" \
    ${BEAMCTL} mod active "$TEST_INSTANCE"
check "mod disable" "Removed" \
    ${BEAMCTL} mod disable "$TEST_INSTANCE" "test-mod.zip"
check "mod sync (remove)" "Linked 0 mods" \
    ${BEAMCTL} mod sync "$TEST_INSTANCE"

echo ""
echo "--- CLI: presets ---"
check "preset save" "Saved preset" \
    ${BEAMCTL} preset "$TEST_INSTANCE" save "test-preset"
check "preset list" "test-preset" \
    ${BEAMCTL} preset "$TEST_INSTANCE" list
check "preset load" "Loaded config" \
    ${BEAMCTL} preset "$TEST_INSTANCE" load "test-preset"
check "preset delete" "Deleted preset" \
    ${BEAMCTL} preset "$TEST_INSTANCE" delete "test-preset"

echo ""
echo "--- CLI: lifecycle ---"
check "status stopped" "stopped" \
    ${BEAMCTL} status "$TEST_INSTANCE"
check "list" "$TEST_INSTANCE" \
    ${BEAMCTL} list

echo ""
echo "--- CLI: destroy ---"
check "destroy" "destroyed" \
    bash -c "echo y | ${BEAMCTL} destroy '$TEST_INSTANCE'"
check "destroy gone" "not found" \
    ${BEAMCTL} status "$TEST_INSTANCE"

echo ""
echo "--- CLI: version ---"
check "version" "beamdash v" \
    ${BEAMCTL} version

# ----- API Tests -----
echo ""
echo "--- API: startup ---"

API_PORT=18999
API_KEY="test-api-key-12345"

mkdir -p /tmp/beamdash-test
cat > /tmp/beamdash-test/api.conf <<EOF
KEY="${API_KEY}"
HOST="127.0.0.1"
PORT=${API_PORT}
EOF

# Start API with test config
export API_CONF="/tmp/beamdash-test/api.conf"

# Recreate instance for API tests
${BEAMCTL} create "$TEST_INSTANCE" > /dev/null 2>&1
dd if=/dev/urandom bs=1024 count=1 of="${BEAMDASH_ROOT}/instances/$TEST_INSTANCE/mods/api-mod.zip" 2>/dev/null

# Start API
export BEAMDASH_ROOT
python3 "${BEAMDASH_ROOT}/lib/api.py" &
API_PID=$!
sleep 1

CURL="curl -s http://127.0.0.1:${API_PORT}"
CURL_AUTH="curl -s -H 'X-API-Key: ${API_KEY}' http://127.0.0.1:${API_PORT}"

cleanup_api() {
    kill $API_PID 2>/dev/null || true
    wait $API_PID 2>/dev/null || true
}
# Add to cleanup chain
_orig_cleanup=$(declare -f cleanup)
cleanup() { cleanup_api; eval "$_orig_cleanup"; }
trap cleanup EXIT

echo ""
echo "--- API: GET endpoints ---"
check "GET / (SPA)" "beamdash" \
    bash -c "${CURL_AUTH}/"

check "GET /instances" "$TEST_INSTANCE" \
    bash -c "${CURL_AUTH}/instances"

check "GET /instances/<name>" "$TEST_INSTANCE" \
    bash -c "${CURL_AUTH}/instances/${TEST_INSTANCE}"

check "GET /instances/<name>/config" "gridmap_v2" \
    bash -c "${CURL_AUTH}/instances/${TEST_INSTANCE}/config"

check "GET /instances/<name>/mods/pool" "api-mod.zip" \
    bash -c "${CURL_AUTH}/instances/${TEST_INSTANCE}/mods/pool"

check "GET /instances/<name>/mods/active (empty)" "No mods" \
    bash -c "${CURL_AUTH}/instances/${TEST_INSTANCE}/mods/active"

check "GET /instances/<name>/presets" "No presets" \
    bash -c "${CURL_AUTH}/instances/${TEST_INSTANCE}/presets"

echo ""
echo "--- API: POST endpoints ---"
check "POST enable mod" "\"ok\": true" \
    bash -c "${CURL_AUTH}/instances/${TEST_INSTANCE}/mods/enable -X POST -H 'Content-Type: application/json' -d '{\"mod\": \"api-mod.zip\"}'"

check "POST mod sync" "\"ok\": true" \
    bash -c "${CURL_AUTH}/instances/${TEST_INSTANCE}/mods/sync -X POST -H 'Content-Type: application/json' -d '{}'"

check "GET mods active (after sync)" "api-mod.zip" \
    bash -c "${CURL_AUTH}/instances/${TEST_INSTANCE}/mods/active"

check "POST preset save" "\"ok\": true" \
    bash -c "${CURL_AUTH}/instances/${TEST_INSTANCE}/presets/save -X POST -H 'Content-Type: application/json' -d '{\"preset\": \"api-test\"}'"

echo ""
echo "--- API: PUT endpoint ---"
check "PUT config single" "\"ok\": true" \
    bash -c "${CURL_AUTH}/instances/${TEST_INSTANCE}/config -X PUT -H 'Content-Type: application/json' -d '{\"key\": \"MaxPlayers\", \"value\": \"20\"}'"

check "PUT config batch" "\"ok\": true" \
    bash -c "${CURL_AUTH}/instances/${TEST_INSTANCE}/config -X PUT -H 'Content-Type: application/json' -d '{\"settings\": {\"MaxCars\": \"4\", \"Description\": \"API test server\"}}'"

check "GET config (verify PUT)" "API test server" \
    bash -c "${CURL_AUTH}/instances/${TEST_INSTANCE}/config"

check "POST preset load" "preset applied" \
    bash -c "${CURL_AUTH}/instances/${TEST_INSTANCE}/presets/load -X POST -H 'Content-Type: application/json' -d '{\"preset\": \"api-test\"}'"

echo ""
echo "--- API: DELETE endpoint ---"
check "DELETE without confirm fails" "confirm" \
    bash -c "${CURL_AUTH}/instances/${TEST_INSTANCE} -X DELETE"

echo ""
echo "--- API: auth required ---"
check "no auth key rejected" "invalid API key" \
    bash -c "${CURL}/instances"

echo ""
echo "=== Results ==="
echo "  Total:  $TESTS_RUN"
echo "  Passed: $TESTS_PASSED"
echo "  Failed: $TESTS_FAILED"

[[ $TESTS_FAILED -eq 0 ]]
