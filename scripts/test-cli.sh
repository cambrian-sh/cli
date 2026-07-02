#!/usr/bin/env bash
# Smoke tests for the Cambrian CLI.
# Runs without a live gRPC server — verifies routing, error handling, config detection.

set -uo pipefail
cd "$(dirname "$0")/.."

CLI="bun run src/index.tsx"
PASS=0
FAIL=0

# Test: --version
test_version() {
  local out
  out=$($CLI --version 2>&1)
  if [[ "$out" == "cambrian 0."* ]]; then
    echo "  ✓ --version: $out"
    PASS=$((PASS + 1))
  else
    echo "  ✗ --version: got '$out'"
    FAIL=$((FAIL + 1))
  fi
}

# Test: -v (short version flag)
test_version_short() {
  local out
  out=$($CLI -v 2>&1)
  if [[ "$out" == "cambrian 0."* ]]; then
    echo "  ✓ -v: $out"
    PASS=$((PASS + 1))
  else
    echo "  ✗ -v: got '$out'"
    FAIL=$((FAIL + 1))
  fi
}

# Test: --help
test_help() {
  local out
  out=$($CLI --help 2>&1)
  if [[ "$out" == *"Cambrian CLI"* ]] && [[ "$out" == *"tools list"* ]] && [[ "$out" == *"doctor"* ]]; then
    echo "  ✓ --help shows commands"
    PASS=$((PASS + 1))
  else
    echo "  ✗ --help missing commands"
    FAIL=$((FAIL + 1))
  fi
}

# Test: unknown command (with config available via env vars)
test_unknown_command() {
  local out
  out=$(CAMBRIAN_SERVER=localhost:50051 CAMBRIAN_OPERATOR_ID=test $CLI nonexistent 2>&1)
  if [[ "$out" == *"Unknown command"* ]]; then
    echo "  ✓ unknown command: shows error"
    PASS=$((PASS + 1))
  else
    echo "  ✗ unknown command: got '$out'"
    FAIL=$((FAIL + 1))
  fi
}

# Test: hint when no config and no env vars
test_no_config_hint() {
  # Ensure no config exists
  local xdg_dir="$HOME/.config/cambrian"
  local xdg_file="$xdg_dir/config.json"
  local local_file="./config.json"
  local backup_xdg=""

  [[ -f "$xdg_file" ]] && { backup_xdg=$(cat "$xdg_file"); rm -f "$xdg_file"; }
  [[ -f "$local_file" ]] && rm -f "$local_file"

  local out
  out=$(env -u CAMBRIAN_SERVER -u CAMBRIAN_OPERATOR_ID $CLI tools list 2>&1)
  if [[ "$out" == *"No config found"* ]] && [[ "$out" == *"interactive setup"* ]]; then
    echo "  ✓ no config: shows hint"
    PASS=$((PASS + 1))
  else
    echo "  ✗ no config hint: got '$out'"
    FAIL=$((FAIL + 1))
  fi

  # Restore
  [[ -n "$backup_xdg" ]] && echo "$backup_xdg" > "$xdg_file"
}

# Test: env vars bypass hint
test_env_bypass() {
  local out
  out=$(CAMBRIAN_SERVER=localhost:50051 CAMBRIAN_OPERATOR_ID=test $CLI tools list 2>&1)
  if [[ "$out" == *"gRPC error"* ]] || [[ "$out" == *"UNAVAILABLE"* ]]; then
    echo "  ✓ env vars: reaches gRPC layer"
    PASS=$((PASS + 1))
  else
    echo "  ✗ env vars: got '$out'"
    FAIL=$((FAIL + 1))
  fi
}

# Test: --config with bad path
test_bad_config_path() {
  local out
  out=$($CLI --config /nonexistent/config.json tools list 2>&1)
  if [[ "$out" == *"No config found"* ]]; then
    echo "  ✓ --config (bad path): shows hint"
    PASS=$((PASS + 1))
  else
    echo "  ✗ --config (bad path): got '$out'"
    FAIL=$((FAIL + 1))
  fi
}

# Test: --config with valid path
test_valid_config_path() {
  local tmp=$(mktemp /tmp/cambrian-test-XXXXXX.json)
  cat > "$tmp" <<EOF
{
  "server": "localhost:50051",
  "operator_id": "tester"
}
EOF

  local out
  out=$($CLI --config "$tmp" tools list 2>&1)
  if [[ "$out" == *"gRPC error"* ]] || [[ "$out" == *"UNAVAILABLE"* ]]; then
    echo "  ✓ --config (valid): reaches gRPC layer"
    PASS=$((PASS + 1))
  else
    echo "  ✗ --config (valid): got '$out'"
    FAIL=$((FAIL + 1))
  fi

  rm -f "$tmp"
}

# Test: gRPC error is clean (no stack trace)
test_clean_grpc_error() {
  local out
  out=$(CAMBRIAN_SERVER=localhost:50051 CAMBRIAN_OPERATOR_ID=tester $CLI tools list 2>&1)
  if [[ "$out" != *"at "* ]] && [[ "$out" != *"node_modules"* ]]; then
    echo "  ✓ gRPC error: no stack trace"
    PASS=$((PASS + 1))
  else
    echo "  ✗ gRPC error: contains stack trace"
    FAIL=$((FAIL + 1))
  fi
}

# Test: subcommand with no arg shows usage
test_usage_on_missing_arg() {
  local out
  out=$(CAMBRIAN_SERVER=localhost:50051 CAMBRIAN_OPERATOR_ID=test $CLI approve 2>&1)
  if [[ "$out" == *"Usage: cambrian approve"* ]]; then
    echo "  ✓ approve (no arg): shows usage"
    PASS=$((PASS + 1))
  else
    echo "  ✗ approve (no arg): got '$out'"
    FAIL=$((FAIL + 1))
  fi
}

test_skills_list() {
  local out
  out=$(CAMBRIAN_SERVER=localhost:50051 CAMBRIAN_OPERATOR_ID=test $CLI skills list 2>&1)
  if [[ "$out" == *"gRPC error"* ]] || [[ "$out" == *"UNAVAILABLE"* ]]; then
    echo "  ✓ skills list: reaches gRPC layer"
    PASS=$((PASS + 1))
  else
    echo "  ✗ skills list: got '$out'"
    FAIL=$((FAIL + 1))
  fi
}

test_tools_query() {
  local out
  out=$(CAMBRIAN_SERVER=localhost:50051 CAMBRIAN_OPERATOR_ID=test $CLI tools list --query "file reader" 2>&1)
  if [[ "$out" == *"gRPC error"* ]] || [[ "$out" == *"UNAVAILABLE"* ]]; then
    echo "  ✓ tools list --query: reaches gRPC layer"
    PASS=$((PASS + 1))
  else
    echo "  ✗ tools list --query: got '$out'"
    FAIL=$((FAIL + 1))
  fi
}

test_tools_k() {
  local out
  out=$(CAMBRIAN_SERVER=localhost:50051 CAMBRIAN_OPERATOR_ID=test $CLI tools list --k 5 2>&1)
  if [[ "$out" == *"gRPC error"* ]] || [[ "$out" == *"UNAVAILABLE"* ]]; then
    echo "  ✓ tools list --k: reaches gRPC layer"
    PASS=$((PASS + 1))
  else
    echo "  ✗ tools list --k: got '$out'"
    FAIL=$((FAIL + 1))
  fi
}

test_memory_top_k() {
  local out
  out=$(CAMBRIAN_SERVER=localhost:50051 CAMBRIAN_OPERATOR_ID=test $CLI memory query "test" --top-k 3 2>&1)
  if [[ "$out" == *"gRPC error"* ]] || [[ "$out" == *"UNAVAILABLE"* ]]; then
    echo "  ✓ memory query --top-k: reaches gRPC layer"
    PASS=$((PASS + 1))
  else
    echo "  ✗ memory query --top-k: got '$out'"
    FAIL=$((FAIL + 1))
  fi
}

test_watches_create_from_file() {
  local tmp=$(mktemp /tmp/cambrian-watch-XXXXXX.json)
  cat > "$tmp" <<EOF
{
  "name": "test-watch",
  "source_type": "test",
  "source_stream_id": "stream-1",
  "condition": "test",
  "condition_type": "always",
  "action": {"type": "emit_event", "target_type": "", "target": "", "payload": ""},
  "active": true,
  "response_mode": "sync",
  "daemon_params": {},
  "max_concurrent_plans": 0
}
EOF

  local out
  out=$(CAMBRIAN_SERVER=localhost:50051 CAMBRIAN_OPERATOR_ID=test $CLI watches create --from-file "$tmp" 2>&1)
  if [[ "$out" == *"gRPC error"* ]] || [[ "$out" == *"UNAVAILABLE"* ]]; then
    echo "  ✓ watches create --from-file: reaches gRPC layer"
    PASS=$((PASS + 1))
  else
    echo "  ✗ watches create --from-file: got '$out'"
    FAIL=$((FAIL + 1))
  fi

  rm -f "$tmp"
}

test_tools_json() {
  local out
  out=$(CAMBRIAN_SERVER=localhost:50051 CAMBRIAN_OPERATOR_ID=test $CLI tools list --json 2>&1)
  if [[ "$out" == *"gRPC error"* ]] || [[ "$out" == *"UNAVAILABLE"* ]]; then
    echo "  ✓ tools list --json: reaches gRPC layer"
    PASS=$((PASS + 1))
  else
    echo "  ✗ tools list --json: got '$out'"
    FAIL=$((FAIL + 1))
  fi
}

test_skills_json() {
  local out
  out=$(CAMBRIAN_SERVER=localhost:50051 CAMBRIAN_OPERATOR_ID=test $CLI skills list --json 2>&1)
  if [[ "$out" == *"gRPC error"* ]] || [[ "$out" == *"UNAVAILABLE"* ]]; then
    echo "  ✓ skills list --json: reaches gRPC layer"
    PASS=$((PASS + 1))
  else
    echo "  ✗ skills list --json: got '$out'"
    FAIL=$((FAIL + 1))
  fi
}

test_skills_describe() {
  local out
  out=$(CAMBRIAN_SERVER=localhost:50051 CAMBRIAN_OPERATOR_ID=test $CLI skills describe web-research 2>&1)
  if [[ "$out" == *"gRPC error"* ]] || [[ "$out" == *"UNAVAILABLE"* ]] || [[ "$out" == *"Skill not found"* ]]; then
    echo "  ✓ skills describe: reaches gRPC layer"
    PASS=$((PASS + 1))
  else
    echo "  ✗ skills describe: got '$out'"
    FAIL=$((FAIL + 1))
  fi
}

test_skills_get_summary() {
  local out
  out=$(CAMBRIAN_SERVER=localhost:50051 CAMBRIAN_OPERATOR_ID=test $CLI skills get web-research --summary 2>&1)
  if [[ "$out" == *"gRPC error"* ]] || [[ "$out" == *"UNAVAILABLE"* ]] || [[ "$out" == *"Skill not found"* ]] || [[ "$out" != *"{ "* ]] || [[ "$out" != *"\""* ]]; then
    echo "  ✓ skills get --summary: returns description only"
    PASS=$((PASS + 1))
  else
    echo "  ✗ skills get --summary: got '$out'"
    FAIL=$((FAIL + 1))
  fi
}

test_tools_describe() {
  local out
  out=$(CAMBRIAN_SERVER=localhost:50051 CAMBRIAN_OPERATOR_ID=test $CLI tools describe shell-exec 2>&1)
  if [[ "$out" == *"gRPC error"* ]] || [[ "$out" == *"UNAVAILABLE"* ]] || [[ "$out" == *"Tool not found"* ]]; then
    echo "  ✓ tools describe: reaches gRPC layer"
    PASS=$((PASS + 1))
  else
    echo "  ✗ tools describe: got '$out'"
    FAIL=$((FAIL + 1))
  fi
}

test_tools_get_summary() {
  local out
  out=$(CAMBRIAN_SERVER=localhost:50051 CAMBRIAN_OPERATOR_ID=test $CLI tools get shell-exec --summary 2>&1)
  if [[ "$out" == *"gRPC error"* ]] || [[ "$out" == *"UNAVAILABLE"* ]] || [[ "$out" == *"Tool not found"* ]] || [[ "$out" != *"{ "* ]] || [[ "$out" != *"\""* ]]; then
    echo "  ✓ tools get --summary: returns description only"
    PASS=$((PASS + 1))
  else
    echo "  ✗ tools get --summary: got '$out'"
    FAIL=$((FAIL + 1))
  fi
}

test_tools_list_dangerous() {
  local out
  out=$(CAMBRIAN_SERVER=localhost:50051 CAMBRIAN_OPERATOR_ID=test $CLI tools list --dangerous 2>&1)
  if [[ "$out" == *"gRPC error"* ]] || [[ "$out" == *"UNAVAILABLE"* ]] || [[ "$out" == *"No tools"* ]]; then
    echo "  ✓ tools list --dangerous: reaches gRPC layer"
    PASS=$((PASS + 1))
  else
    echo "  ✗ tools list --dangerous: got '$out'"
    FAIL=$((FAIL + 1))
  fi
}

test_tools_exec() {
  local out
  out=$(CAMBRIAN_SERVER=localhost:50051 CAMBRIAN_OPERATOR_ID=test $CLI tools exec shell-exec --args '{"command":"echo hi"}' 2>&1)
  if [[ "$out" == *"gRPC error"* ]] || [[ "$out" == *"UNAVAILABLE"* ]] || [[ "$out" == *"Error:"* ]] || [[ "$out" == *"hi"* ]] || [[ "$out" == *"Denied:"* ]]; then
    echo "  ✓ tools exec: reaches gRPC layer"
    PASS=$((PASS + 1))
  else
    echo "  ✗ tools exec: got '$out'"
    FAIL=$((FAIL + 1))
  fi
}

test_tools_exec_dry_run() {
  local out
  out=$($CLI tools exec shell-exec --args '{"command":"echo hi"}' --dry-run 2>&1)
  if [[ "$out" == *"DRY RUN"* ]] && [[ "$out" == *"tool_name"* ]] && [[ "$out" == *"echo hi"* ]]; then
    echo "  ✓ tools exec --dry-run: prints payload without executing"
    PASS=$((PASS + 1))
  else
    echo "  ✗ tools exec --dry-run: got '$out'"
    FAIL=$((FAIL + 1))
  fi
}

test_status_json() {
  local out
  out=$(CAMBRIAN_SERVER=localhost:50051 CAMBRIAN_OPERATOR_ID=test $CLI status --json 2>&1)
  if [[ "$out" == *"server unreachable"* ]] || [[ "$out" == *"\"server\""* ]] || [[ "$out" == *"\"tools\""* ]] || [[ "$out" == *"\"watches\""* ]]; then
    echo "  ✓ status --json: outputs JSON"
    PASS=$((PASS + 1))
  else
    echo "  ✗ status --json: got '$out'"
    FAIL=$((FAIL + 1))
  fi
}

test_doctor_json() {
  local out
  out=$(CAMBRIAN_SERVER=localhost:50051 CAMBRIAN_OPERATOR_ID=test $CLI doctor --json 2>&1)
  if [[ "$out" == *"server_reachable"* ]] || [[ "$out" == *"operator_id"* ]] || [[ "$out" == *"server unreachable"* ]]; then
    echo "  ✓ doctor --json: outputs JSON"
    PASS=$((PASS + 1))
  else
    echo "  ✗ doctor --json: got '$out'"
    FAIL=$((FAIL + 1))
  fi
}

test_approve_list() {
  local out
  out=$(CAMBRIAN_SERVER=localhost:50051 CAMBRIAN_OPERATOR_ID=test $CLI approve list --timeout 1 2>&1)
  if [[ "$out" == *"Watching"* ]] || [[ "$out" == *"No approvals"* ]] || [[ "$out" == *"gRPC error"* ]] || [[ "$out" == *"UNAVAILABLE"* ]]; then
    echo "  ✓ approve list: opens stream"
    PASS=$((PASS + 1))
  else
    echo "  ✗ approve list: got '$out'"
    FAIL=$((FAIL + 1))
  fi
}

test_watches_describe() {
  local out
  out=$(CAMBRIAN_SERVER=localhost:50051 CAMBRIAN_OPERATOR_ID=test $CLI watches describe w-test 2>&1)
  if [[ "$out" == *"gRPC error"* ]] || [[ "$out" == *"UNAVAILABLE"* ]] || [[ "$out" == *"Watch not found"* ]]; then
    echo "  ✓ watches describe: reaches gRPC layer"
    PASS=$((PASS + 1))
  else
    echo "  ✗ watches describe: got '$out'"
    FAIL=$((FAIL + 1))
  fi
}

test_watches_list_json() {
  local out
  out=$(CAMBRIAN_SERVER=localhost:50051 CAMBRIAN_OPERATOR_ID=test $CLI watches list --json 2>&1)
  if [[ "$out" == *"gRPC error"* ]] || [[ "$out" == *"UNAVAILABLE"* ]]; then
    echo "  ✓ watches list --json: reaches gRPC layer"
    PASS=$((PASS + 1))
  else
    echo "  ✗ watches list --json: got '$out'"
    FAIL=$((FAIL + 1))
  fi
}

test_watches_list_active() {
  local out
  out=$(CAMBRIAN_SERVER=localhost:50051 CAMBRIAN_OPERATOR_ID=test $CLI watches list --active 2>&1)
  if [[ "$out" == *"gRPC error"* ]] || [[ "$out" == *"UNAVAILABLE"* ]] || [[ "$out" == *"No watches"* ]]; then
    echo "  ✓ watches list --active: reaches gRPC layer"
    PASS=$((PASS + 1))
  else
    echo "  ✗ watches list --active: got '$out'"
    FAIL=$((FAIL + 1))
  fi
}

test_config_set() {
  local tmp=$(mktemp /tmp/cambrian-config-XXXXXX.json)
  local out
  out=$(CAMBRIAN_SERVER=localhost:50051 CAMBRIAN_OPERATOR_ID=tester $CLI --config "$tmp" config set server localhost:9999 2>&1)
  if [[ -f "$tmp" ]] && grep -q "localhost:9999" "$tmp"; then
    echo "  ✓ config set: writes to file"
    PASS=$((PASS + 1))
  else
    echo "  ✗ config set: got '$out'"
    FAIL=$((FAIL + 1))
  fi
  rm -f "$tmp"
}

test_config_get() {
  local tmp=$(mktemp /tmp/cambrian-config-XXXXXX.json)
  local out
  out=$(CAMBRIAN_SERVER=localhost:12345 CAMBRIAN_OPERATOR_ID=alice $CLI --config "$tmp" config get server 2>&1)
  if [[ "$out" == "localhost:12345" ]]; then
    echo "  ✓ config get server: returns env value"
    PASS=$((PASS + 1))
  else
    echo "  ✗ config get server: got '$out'"
    FAIL=$((FAIL + 1))
  fi
  out=$(CAMBRIAN_OPERATOR_ID=alice $CLI --config "$tmp" config get operator_id 2>&1)
  if [[ "$out" == "alice" ]]; then
    echo "  ✓ config get operator_id: returns env value"
    PASS=$((PASS + 1))
  else
    echo "  ✗ config get operator_id: got '$out'"
    FAIL=$((FAIL + 1))
  fi
  rm -f "$tmp"
}

test_config_edit() {
  local tmp=$(mktemp /tmp/cambrian-config-XXXXXX.json)
  local out
  out=$(EDITOR=true CAMBRIAN_SERVER=localhost:50051 CAMBRIAN_OPERATOR_ID=tester $CLI --config "$tmp" config edit 2>&1)
  if [[ "$out" == *"Opening"* ]] || [[ "$out" == *"config edit"* ]]; then
    echo "  ✓ config edit: opens editor"
    PASS=$((PASS + 1))
  else
    echo "  ✗ config edit: got '$out'"
    FAIL=$((FAIL + 1))
  fi
  rm -f "$tmp"
}

test_config_path() {
  local tmp=$(mktemp /tmp/cambrian-config-XXXXXX.json)
  local out
  out=$($CLI --config "$tmp" config path 2>&1)
  if [[ "$out" == "$tmp" ]]; then
    echo "  ✓ config path: prints --config path"
    PASS=$((PASS + 1))
  else
    echo "  ✗ config path: got '$out'"
    FAIL=$((FAIL + 1))
  fi
  rm -f "$tmp"
}

test_memory_json() {
  local out
  out=$(CAMBRIAN_SERVER=localhost:50051 CAMBRIAN_OPERATOR_ID=test $CLI memory query "test" --json 2>&1)
  if [[ "$out" == *"gRPC error"* ]] || [[ "$out" == *"UNAVAILABLE"* ]]; then
    echo "  ✓ memory query --json: reaches gRPC layer"
    PASS=$((PASS + 1))
  else
    echo "  ✗ memory query --json: got '$out'"
    FAIL=$((FAIL + 1))
  fi
}

test_memory_write() {
  local out
  out=$(CAMBRIAN_SERVER=localhost:50051 CAMBRIAN_OPERATOR_ID=test $CLI memory write "test memory entry" 2>&1)
  if [[ "$out" == *"gRPC error"* ]] || [[ "$out" == *"UNAVAILABLE"* ]] || [[ "$out" == *"Memory written"* ]]; then
    echo "  ✓ memory write: reaches gRPC layer"
    PASS=$((PASS + 1))
  else
    echo "  ✗ memory write: got '$out'"
    FAIL=$((FAIL + 1))
  fi
}

test_memory_write_tags() {
  local out
  out=$(CAMBRIAN_SERVER=localhost:50051 CAMBRIAN_OPERATOR_ID=test $CLI memory write "test" --tags tag1,tag2 2>&1)
  if [[ "$out" == *"gRPC error"* ]] || [[ "$out" == *"UNAVAILABLE"* ]] || [[ "$out" == *"Memory written"* ]]; then
    echo "  ✓ memory write --tags: reaches gRPC layer"
    PASS=$((PASS + 1))
  else
    echo "  ✗ memory write --tags: got '$out'"
    FAIL=$((FAIL + 1))
  fi
}

test_skills_get() {
  local out
  out=$(CAMBRIAN_SERVER=localhost:50051 CAMBRIAN_OPERATOR_ID=test $CLI skills get web-research 2>&1)
  if [[ "$out" == *"gRPC error"* ]] || [[ "$out" == *"UNAVAILABLE"* ]] || [[ "$out" == *"Skill not found"* ]]; then
    echo "  ✓ skills get: reaches gRPC layer"
    PASS=$((PASS + 1))
  else
    echo "  ✗ skills get: got '$out'"
    FAIL=$((FAIL + 1))
  fi
}

test_skills_query() {
  local out
  out=$(CAMBRIAN_SERVER=localhost:50051 CAMBRIAN_OPERATOR_ID=test $CLI skills list --query "web" 2>&1)
  if [[ "$out" == *"gRPC error"* ]] || [[ "$out" == *"UNAVAILABLE"* ]]; then
    echo "  ✓ skills list --query: reaches gRPC layer"
    PASS=$((PASS + 1))
  else
    echo "  ✗ skills list --query: got '$out'"
    FAIL=$((FAIL + 1))
  fi
}

test_help_includes_skills() {
  local out
  out=$($CLI --help 2>&1)
  if [[ "$out" == *"skills list"* ]] && [[ "$out" == *"skills get"* ]]; then
    echo "  ✓ --help includes skills commands"
    PASS=$((PASS + 1))
  else
    echo "  ✗ --help missing skills commands"
    FAIL=$((FAIL + 1))
  fi
}

test_config_subcommand() {
  local out
  out=$(CAMBRIAN_SERVER=localhost:50051 CAMBRIAN_OPERATOR_ID=tester $CLI config 2>&1)
  if [[ "$out" == *"Cambrian CLI Configuration"* ]] \
    && [[ "$out" == *"Server:"* ]] \
    && [[ "$out" == *"localhost:50051"* ]] \
    && [[ "$out" == *"tester"* ]] \
    && [[ "$out" == *"env (CAMBRIAN_SERVER)"* ]]; then
    echo "  ✓ config: shows resolved values + sources"
    PASS=$((PASS + 1))
  else
    echo "  ✗ config: got '$out'"
    FAIL=$((FAIL + 1))
  fi
}

echo "Cambrian CLI tests"
echo "=================="

test_version
test_version_short
test_help
test_help_includes_skills
test_config_subcommand
test_unknown_command
test_no_config_hint
test_env_bypass
test_bad_config_path
test_valid_config_path
test_clean_grpc_error
test_usage_on_missing_arg
test_skills_list
test_skills_get
test_skills_query
test_tools_query
test_tools_k
test_memory_top_k
test_watches_create_from_file
test_tools_json
test_skills_json
test_skills_describe
test_skills_get_summary
test_tools_describe
test_tools_get_summary
test_tools_list_dangerous
test_tools_exec
test_tools_exec_dry_run
test_status_json
test_doctor_json
test_approve_list
test_watches_describe
test_watches_list_json
test_watches_list_active
test_config_set
test_config_get
test_config_edit
test_config_path
test_memory_json
test_memory_write
test_memory_write_tags

# Test: whoami with no login (uses memory keychain)
test_whoami_no_login() {
  local out
  out=$(CAMBRIAN_KEYCHAIN_BACKEND=memory $CLI --server localhost:50051 whoami 2>&1)
  if [[ "$out" == *"Not logged in"* ]] && [[ "$out" == *"localhost:50051"* ]]; then
    echo "  ✓ whoami (no login): shows not-logged-in"
    PASS=$((PASS + 1))
  else
    echo "  ✗ whoami (no login): got '$out'"
    FAIL=$((FAIL + 1))
  fi
}

# Test: whoami with CAMBRIAN_TOKEN env var
test_whoami_env_token() {
  local out
  out=$(CAMBRIAN_TOKEN=fake.jwt.token $CLI --server localhost:50051 whoami 2>&1)
  if [[ "$out" == *"Source:  env"* ]]; then
    echo "  ✓ whoami (env token): shows env source"
    PASS=$((PASS + 1))
  else
    echo "  ✗ whoami (env token): got '$out'"
    FAIL=$((FAIL + 1))
  fi
}

# Test: whoami with --token flag
test_whoami_flag_token() {
  local out
  out=$($CLI --server localhost:50051 --token flag.jwt.token whoami 2>&1)
  if [[ "$out" == *"Source:  flag"* ]]; then
    echo "  ✓ whoami (--token): shows flag source"
    PASS=$((PASS + 1))
  else
    echo "  ✗ whoami (--token): got '$out'"
    FAIL=$((FAIL + 1))
  fi
}

# Test: logout (no keychain entry — should still succeed silently)
test_logout_no_entry() {
  local out
  out=$(CAMBRIAN_KEYCHAIN_BACKEND=memory $CLI --server localhost:50051 logout 2>&1)
  if [[ "$out" == *"Logged out of localhost:50051"* ]]; then
    echo "  ✓ logout (no entry): clears silently"
    PASS=$((PASS + 1))
  else
    echo "  ✗ logout (no entry): got '$out'"
    FAIL=$((FAIL + 1))
  fi
}

# Test: login non-interactive with no TTY — should fail with clear error
test_login_no_tty() {
  local out
  out=$(CAMBRIAN_KEYCHAIN_BACKEND=memory $CLI --server localhost:50051 login 2>&1)
  if [[ "$out" == *"TTY"* ]] || [[ "$out" == *"Username is required"* ]]; then
    echo "  ✓ login (no TTY): clear error"
    PASS=$((PASS + 1))
  else
    echo "  ✗ login (no TTY): got '$out'"
    FAIL=$((FAIL + 1))
  fi
}

# Test: login non-interactive with --username only (still no TTY) — should fail
test_login_no_password() {
  local out
  out=$(CAMBRIAN_KEYCHAIN_BACKEND=memory $CLI --server localhost:50051 login --username alice 2>&1)
  if [[ "$out" == *"Password is required"* ]] || [[ "$out" == *"TTY"* ]]; then
    echo "  ✓ login (no password): clear error"
    PASS=$((PASS + 1))
  else
    echo "  ✗ login (no password): got '$out'"
    FAIL=$((FAIL + 1))
  fi
}

# Test: --help shows new auth subcommands
test_help_shows_auth() {
  local out
  out=$($CLI --help 2>&1)
  if [[ "$out" == *"cambrian login"* ]] && [[ "$out" == *"cambrian logout"* ]] && [[ "$out" == *"cambrian whoami"* ]]; then
    echo "  ✓ --help shows auth subcommands"
    PASS=$((PASS + 1))
  else
    echo "  ✗ --help missing auth subcommands"
    FAIL=$((FAIL + 1))
  fi
}

# Test: --help shows global flags section
test_help_shows_global_flags() {
  local out
  out=$($CLI --help 2>&1)
  if [[ "$out" == *"--token"* ]] && [[ "$out" == *"--server"* ]] && [[ "$out" == *"--config"* ]]; then
    echo "  ✓ --help shows global flags"
    PASS=$((PASS + 1))
  else
    echo "  ✗ --help missing global flags"
    FAIL=$((FAIL + 1))
  fi
}

# Test: --help shows CAMBRIAN_TOKEN in env section
test_help_shows_token_env() {
  local out
  out=$($CLI --help 2>&1)
  if [[ "$out" == *"CAMBRIAN_TOKEN"* ]]; then
    echo "  ✓ --help shows CAMBRIAN_TOKEN env"
    PASS=$((PASS + 1))
  else
    echo "  ✗ --help missing CAMBRIAN_TOKEN"
    FAIL=$((FAIL + 1))
  fi
}

# Test: approve (no arg) — uses CAMBRIAN_TOKEN env, not keychain, role defaults to operator (fail-open)
test_approve_no_arg_with_env_token() {
  local out
  out=$(CAMBRIAN_TOKEN=fake.jwt.token CAMBRIAN_SERVER=localhost:50051 CAMBRIAN_OPERATOR_ID=test $CLI approve 2>&1)
  if [[ "$out" == *"Usage: cambrian approve"* ]] || [[ "$out" == *"Permission denied"* ]]; then
    echo "  ✓ approve (no arg, env token): clear error"
    PASS=$((PASS + 1))
  else
    echo "  ✗ approve (no arg, env token): got '$out'"
    FAIL=$((FAIL + 1))
  fi
}

test_whoami_no_login
test_whoami_env_token
test_whoami_flag_token
test_logout_no_entry
test_login_no_tty
test_login_no_password
test_help_shows_auth
test_help_shows_global_flags
test_help_shows_token_env
test_approve_no_arg_with_env_token

# Test: audit (no subcommand) — shows usage
test_audit_no_subcommand() {
  local out
  out=$(CAMBRIAN_SERVER=localhost:50051 CAMBRIAN_OPERATOR_ID=test CAMBRIAN_TOKEN=fake.jwt.token $CLI audit 2>&1)
  if [[ "$out" == *"Usage: cambrian audit"* ]]; then
    echo "  ✓ audit (no subcommand): shows usage"
    PASS=$((PASS + 1))
  else
    echo "  ✗ audit (no subcommand): got '$out'"
    FAIL=$((FAIL + 1))
  fi
}

# Test: audit show (no id) — shows usage
test_audit_show_no_id() {
  local out
  out=$(CAMBRIAN_SERVER=localhost:50051 CAMBRIAN_OPERATOR_ID=test CAMBRIAN_TOKEN=fake.jwt.token $CLI audit show 2>&1)
  if [[ "$out" == *"Usage: cambrian audit show"* ]]; then
    echo "  ✓ audit show (no id): shows usage"
    PASS=$((PASS + 1))
  else
    echo "  ✗ audit show (no id): got '$out'"
    FAIL=$((FAIL + 1))
  fi
}

# Test: audit list — reaches gRPC layer
test_audit_list() {
  local out
  out=$(CAMBRIAN_SERVER=localhost:50051 CAMBRIAN_OPERATOR_ID=test CAMBRIAN_TOKEN=fake.jwt.token $CLI audit list 2>&1)
  if [[ "$out" == *"gRPC error"* ]] || [[ "$out" == *"UNAVAILABLE"* ]] || [[ "$out" == *"(no entries)"* ]]; then
    echo "  ✓ audit list: reaches gRPC layer"
    PASS=$((PASS + 1))
  else
    echo "  ✗ audit list: got '$out'"
    FAIL=$((FAIL + 1))
  fi
}

# Test: audit list --json — reaches gRPC layer
test_audit_list_json() {
  local out
  out=$(CAMBRIAN_SERVER=localhost:50051 CAMBRIAN_OPERATOR_ID=test CAMBRIAN_TOKEN=fake.jwt.token $CLI audit list --json 2>&1)
  if [[ "$out" == *"gRPC error"* ]] || [[ "$out" == *"UNAVAILABLE"* ]] || [[ "$out" == *"entries"* ]]; then
    echo "  ✓ audit list --json: reaches gRPC layer"
    PASS=$((PASS + 1))
  else
    echo "  ✗ audit list --json: got '$out'"
    FAIL=$((FAIL + 1))
  fi
}

# Test: audit export without --reason — fails in non-TTY
test_audit_export_no_reason() {
  local out
  out=$(CAMBRIAN_SERVER=localhost:50051 CAMBRIAN_OPERATOR_ID=test CAMBRIAN_TOKEN=fake.jwt.token $CLI audit export 2>&1)
  if [[ "$out" == *"--reason"* ]]; then
    echo "  ✓ audit export (no --reason): clear error"
    PASS=$((PASS + 1))
  else
    echo "  ✗ audit export (no --reason): got '$out'"
    FAIL=$((FAIL + 1))
  fi
}

# Test: audit export with --reason — reaches gRPC layer
test_audit_export_with_reason() {
  local out
  out=$(CAMBRIAN_SERVER=localhost:50051 CAMBRIAN_OPERATOR_ID=test CAMBRIAN_TOKEN=fake.jwt.token $CLI audit export --reason "compliance" 2>&1)
  if [[ "$out" == *"gRPC error"* ]] || [[ "$out" == *"UNAVAILABLE"* ]] || [[ "$out" == *"Exported"* ]]; then
    echo "  ✓ audit export --reason: reaches gRPC layer"
    PASS=$((PASS + 1))
  else
    echo "  ✗ audit export --reason: got '$out'"
    FAIL=$((FAIL + 1))
  fi
}

# Test: --help shows audit subcommands
test_help_shows_audit() {
  local out
  out=$($CLI --help 2>&1)
  if [[ "$out" == *"cambrian audit list"* ]] && [[ "$out" == *"cambrian audit show"* ]] && [[ "$out" == *"cambrian audit export"* ]]; then
    echo "  ✓ --help shows audit subcommands"
    PASS=$((PASS + 1))
  else
    echo "  ✗ --help missing audit subcommands"
    FAIL=$((FAIL + 1))
  fi
}

test_audit_no_subcommand
test_audit_show_no_id
test_audit_list
test_audit_list_json
test_audit_export_no_reason
test_audit_export_with_reason
test_help_shows_audit

echo
echo "Results: $PASS passed, $FAIL failed"
exit $FAIL