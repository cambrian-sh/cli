# Cambrian installer for Windows - SOURCE mode. Behavior-identical to install.sh: clones the
# repos into %USERPROFILE%\.cambrian\src, builds both binaries, installs them to
# %USERPROFILE%\.cambrian\bin, updates the user PATH (registry, no admin), and hands off to
# `cambrian init`. It does NOT set up Postgres/Python/models - that is `cambrian init`'s job.
#
#   powershell -ExecutionPolicy Bypass -c "irm https://cambrian.dev/install.ps1 | iex"
#
# Why source and not GitHub releases: Cambrian is under active daily development and the
# release channel is empty. Re-running this script is the update path (fetch -> reset -> rebuild).
#
# Build inputs (must be on PATH): git, go (>=1.21), bun (>=1.3).
#
# Knobs: CAMBRIAN_HOME, CAMBRIAN_SRC, CAMBRIAN_REF, CAMBRIAN_{CLI,CORE,SDK}_REF,
#        CAMBRIAN_GIT_BASE, CAMBRIAN_FORCE=1, CAMBRIAN_SKIP_INIT=1, CAMBRIAN_TELEMETRY=0
#
# Windows PowerShell 5.1 compatible (no ternary / null-coalescing / && chaining).
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$CliRepo  = 'cambrian-sh/cli'
$CoreRepo = 'cambrian-sh/core'
$SdkRepo  = 'cambrian-sh/agent-sdk-python'
$GitBase  = if ($env:CAMBRIAN_GIT_BASE) { $env:CAMBRIAN_GIT_BASE } else { 'https://github.com' }

$Prefix   = if ($env:CAMBRIAN_HOME) { $env:CAMBRIAN_HOME } else { Join-Path $env:USERPROFILE '.cambrian' }
$BinDir   = Join-Path $Prefix 'bin'
$SrcDir   = if ($env:CAMBRIAN_SRC) { $env:CAMBRIAN_SRC } else { Join-Path $Prefix 'src' }
$CliDir   = Join-Path $SrcDir 'cli'
$CoreDir  = Join-Path $SrcDir 'core'
$SdkDir   = Join-Path $SrcDir 'sdk'
$ConfigPath = Join-Path $Prefix 'config.json'
$StampPath  = Join-Path $Prefix '.build-stamp'
$TelemetryUrl = 'https://telemetry.cambrian.dev/v1/install'

function Say($m)  { Write-Host $m }
function Step($m) { Write-Host ("  " + $m + " ... ") -NoNewline }
function Ok($m)   { if ($m) { Write-Host ($m + " ") -NoNewline }; Write-Host ([char]0x2713) -ForegroundColor Green }
function Die($m)  { Write-Host ""; Write-Host ("X " + $m) -ForegroundColor Red; exit 1 }

Say "Cambrian installer  -  building from source  -  https://github.com/$CliRepo"

# --- 1. platform ---------------------------------------------------------------------------
$arch = $env:PROCESSOR_ARCHITECTURE
Say "  platform: windows-$arch  (source build)"

# --- 2. build toolchain --------------------------------------------------------------------
function Have($cmd) {
  $c = Get-Command $cmd -ErrorAction SilentlyContinue
  if ($c) { return $true }
  return $false
}
if (-not (Have 'git')) { Die "git is required to build Cambrian from source. Install Git for Windows (https://git-scm.com/download/win), then re-run." }
if (-not (Have 'go'))  { Die "Go >=1.21 is required (it auto-fetches the toolchain go.mod pins). Install from https://go.dev/dl, then re-run." }
if (-not (Have 'bun')) { Die "Bun >=1.3 is required. Install with:  powershell -c `"irm bun.sh/install.ps1 | iex`"    then re-run." }
$goVer  = (& go version)
$bunVer = (& bun --version)
Say ("  toolchain: " + $goVer + " - bun " + $bunVer)

# --- 3. sync a checkout (clone, or fetch+reset to the remote) ------------------------------
# Never destroys work: a dirty checkout aborts the install instead of being reset.
function Sync-Repo($slug, $dir, $ref, $soft) {
  # $soft: throw (recoverable) instead of exiting the installer - `exit` inside a function
  # kills the whole script and cannot be caught, so the optional SDK repo needs this.
  function Fail($m) { if ($soft) { throw $m } else { Die $m } }
  $url = "$GitBase/$slug.git"
  if (Test-Path (Join-Path $dir '.git')) {
    & git -C $dir diff --quiet
    $dirty = ($LASTEXITCODE -ne 0)
    & git -C $dir diff --cached --quiet
    if ($LASTEXITCODE -ne 0) { $dirty = $true }
    if ($dirty) {
      Fail "Uncommitted changes in $dir. This installer resets checkouts to the remote and will not discard your work. Commit/stash them, or point CAMBRIAN_SRC at a different directory."
    }
    & git -C $dir remote set-url origin $url
    if ($ref) { & git -C $dir fetch --quiet --depth 1 --tags origin $ref }
    else      { & git -C $dir fetch --quiet --depth 1 origin HEAD }
    if ($LASTEXITCODE -ne 0) { Fail "Could not fetch $url. Check the ref name and your network (or GitHub access if the repo is private)." }
    & git -C $dir reset --quiet --hard FETCH_HEAD
    if ($LASTEXITCODE -ne 0) { Fail "Could not update $dir." }
  } else {
    if (Test-Path $dir) { Fail "$dir exists but is not a git checkout. Move it aside and re-run." }
    New-Item -ItemType Directory -Path (Split-Path -Parent $dir) -Force | Out-Null
    if ($ref) { & git clone --quiet --depth 1 --branch $ref $url $dir }
    else      { & git clone --quiet --depth 1 $url $dir }
    if ($LASTEXITCODE -ne 0) { Fail "Could not clone $url. Check the ref name / your network (or GitHub access if the repo is private)." }
  }
  return (& git -C $dir rev-parse --short HEAD).Trim()
}
function RefFor($specific) {
  if ($specific) { return $specific }
  if ($env:CAMBRIAN_REF) { return $env:CAMBRIAN_REF }
  return $null
}

Say ""
Say "Sources -> $SrcDir"
Step "cli";  $CliSha  = Sync-Repo $CliRepo  $CliDir  (RefFor $env:CAMBRIAN_CLI_REF)  $false; Ok $CliSha
Step "core"; $CoreSha = Sync-Repo $CoreRepo $CoreDir (RefFor $env:CAMBRIAN_CORE_REF) $false; Ok $CoreSha
# The agent SDK is only needed by `cambrian init` (it pip-installs it into the venv). A
# failure here is not fatal - init falls back to the PyPI package.
Step "sdk"
$SdkSha = $null
try { $SdkSha = Sync-Repo $SdkRepo $SdkDir (RefFor $env:CAMBRIAN_SDK_REF) $true } catch { $SdkSha = $null }
if ($SdkSha) { Ok $SdkSha } else { Write-Host "skipped (init will use PyPI)" -ForegroundColor Yellow; $SdkDir = '' }

# --- 4. idempotency: did anything actually move? -------------------------------------------
$Want   = "cli=$CliSha core=$CoreSha"
$CliOut = Join-Path $BinDir 'cambrian.exe'
$OrchOut = Join-Path $BinDir 'cambrian-orchestrator.exe'
if (($env:CAMBRIAN_FORCE -ne '1') -and (Test-Path $CliOut) -and (Test-Path $OrchOut) -and (Test-Path $StampPath)) {
  if ((Get-Content $StampPath -Raw).Trim() -eq $Want) {
    Say ""
    Say ("Already up to date (" + $Want + ").  Re-run setup with 'cambrian init', or force a rebuild with CAMBRIAN_FORCE=1.")
    exit 0
  }
}

$Tmp = Join-Path ([IO.Path]::GetTempPath()) ("cambrian-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Tmp -Force | Out-Null
try {
  # --- 5. build ----------------------------------------------------------------------------
  Say ""
  Say "Build"

  # Kernel: pure Go, no cgo. Version is stamped from the checkout so `--version` is traceable.
  $CoreVer = (& git -C $CoreDir describe --tags --always).Trim()
  if (-not $CoreVer) { $CoreVer = $CoreSha }
  $orchTmp = Join-Path $Tmp 'cambrian-orchestrator.exe'
  # Compiler output is left on the console (not captured): PowerShell 5.1 turns a redirected
  # native stderr into ErrorRecords, and a failed build is exactly when you want the raw text.
  Say "  cambrian-orchestrator (go, $CoreVer)"
  Push-Location $CoreDir
  $env:CGO_ENABLED = '0'
  & go build -trimpath -ldflags "-s -w -X main.version=$CoreVer" -o $orchTmp ./cmd/orchestrator
  $goRc = $LASTEXITCODE
  Pop-Location
  if ($goRc -ne 0) { Die "Go build failed (output above)." }
  Ok "  cambrian-orchestrator"

  # CLI: bun deps -> vendored protos -> single-file executable.
  Say "  cambrian (bun)"
  Push-Location $CliDir
  & bun install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { & bun install }
  $bunRc = $LASTEXITCODE
  if ($bunRc -eq 0) { & bun run scripts/embed-proto.ts; $bunRc = $LASTEXITCODE }
  if ($bunRc -eq 0) { & bun run build:bin;              $bunRc = $LASTEXITCODE }
  Pop-Location
  if ($bunRc -ne 0) { Die "CLI build failed (output above)." }
  $cliBuilt = Join-Path $CliDir 'dist\cambrian.exe'
  if (-not (Test-Path $cliBuilt)) { $cliBuilt = Join-Path $CliDir 'dist\cambrian' }
  if (-not (Test-Path $cliBuilt)) { Die "CLI build produced no binary in $CliDir\dist." }
  $cliTmp = Join-Path $Tmp 'cambrian.exe'
  Copy-Item $cliBuilt $cliTmp -Force
  Ok "  cambrian"

  # --- 6. install ---------------------------------------------------------------------------
  try { New-Item -ItemType Directory -Path $BinDir -Force | Out-Null } catch { Die "Cannot write to $BinDir. Check disk space and permissions." }
  # A running orchestrator locks its .exe on Windows: move the old one aside, then install.
  function Install-Bin($from, $to) {
    if (Test-Path $to) {
      $old = "$to.old-" + [Guid]::NewGuid().ToString('N').Substring(0, 8)
      try { Move-Item -Force $to $old } catch { Die "Cannot replace $to - it is in use. Stop Cambrian ('cambrian stop', or end cambrian-orchestrator.exe) and re-run." }
      try { Remove-Item -Force $old -ErrorAction SilentlyContinue } catch {}
    }
    Move-Item -Force $from $to
  }
  Install-Bin $cliTmp  $CliOut
  Install-Bin $orchTmp $OrchOut
  Step "installed to $BinDir"; Ok
} finally {
  Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
}

# Reference config bundle: `cambrian init` reads configs/config.example.json + tuning.json from
# its working directory (we hand off with cwd=$Prefix) and writes the real config.json next to
# them. Seeding the templates is what makes the generated bundle complete rather than a stub.
New-Item -ItemType Directory -Path (Join-Path $Prefix 'configs') -Force | Out-Null
Copy-Item (Join-Path $CoreDir 'configs\config.example.json') (Join-Path $Prefix 'configs\config.example.json') -Force -ErrorAction SilentlyContinue
if (-not (Test-Path (Join-Path $Prefix 'configs\tuning.json'))) {
  Copy-Item (Join-Path $CoreDir 'configs\tuning.json') (Join-Path $Prefix 'configs\tuning.json') -Force -ErrorAction SilentlyContinue
}

# Where init should look for the moving parts that live in the source tree. Recorded so a later
# `cambrian init` run (outside this script) finds them too.
$srcEnv = @(
  '# Written by install.ps1 - the source checkouts this installation was built from.',
  '# Dot-source this before running `cambrian init` by hand.',
  ('$env:CAMBRIAN_SRC = "' + $SrcDir + '"'),
  ('$env:CAMBRIAN_AGENTS_DIR = "' + (Join-Path $CoreDir 'agents') + '"'),
  ('$env:CAMBRIAN_SDK_DIR = "' + $SdkDir + '"'),
  ('$env:CAMBRIAN_COMPOSE = "' + (Join-Path $CoreDir 'db\docker-compose.yml') + '"')
) -join "`r`n"
Set-Content -Path (Join-Path $Prefix 'source.env.ps1') -Value $srcEnv -Encoding utf8

Set-Content -Path $StampPath -Value $Want -Encoding utf8

# --- 7. PATH update (user-level, registry; idempotent) -------------------------------------
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($null -eq $userPath) { $userPath = '' }
if ($userPath -notlike "*$BinDir*") {
  $newPath = if ($userPath.TrimEnd(';') -eq '') { $BinDir } else { $userPath.TrimEnd(';') + ';' + $BinDir }
  [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
  $env:Path = $env:Path + ';' + $BinDir
  Say "  added to user PATH (open a new terminal to pick it up)"
}

# --- 8. verify the binaries run ------------------------------------------------------------
# A native exe that exits non-zero does NOT throw, so try/catch alone would pass a broken
# binary: check $LASTEXITCODE.
& $CliOut --version | Out-Null
if ($LASTEXITCODE -ne 0) { Die "Built CLI does not run (exit $LASTEXITCODE). Report at https://github.com/$CliRepo/issues" }
& $OrchOut --version | Out-Null
if ($LASTEXITCODE -ne 0) { Die "Built orchestrator does not run (exit $LASTEXITCODE). Report at https://github.com/$CoreRepo/issues" }

# --- 9. telemetry opt-in (default OFF when non-interactive) --------------------------------
$telem = 'off'
if ($env:CAMBRIAN_TELEMETRY -eq '0') { $telem = 'off' }
elseif ((Test-Path $ConfigPath) -and ((Get-Content $ConfigPath -Raw) -match 'telemetry_enabled')) { $telem = 'kept' }
elseif ([Environment]::UserInteractive) {
  try {
    $ans = Read-Host 'Help us improve Cambrian by sending anonymous install metrics (OS, version, success/fail). No PII. [Y/n]'
    if ($ans -match '^[Nn]') { $telem = 'off' } else { $telem = 'on' }
  } catch { $telem = 'off' }
}
if ($telem -eq 'on' -or $telem -eq 'off') {
  New-Item -ItemType Directory -Path $Prefix -Force | Out-Null
  $val = if ($telem -eq 'on') { 'true' } else { 'false' }
  Set-Content -Path $ConfigPath -Value ('{"telemetry_enabled": ' + $val + '}') -Encoding utf8
}
if ($telem -eq 'on') {
  $body = (@{ os = 'windows'; arch = $arch; version = $CoreVer; source = 'git'; result = 'success' } | ConvertTo-Json -Compress)
  try { Invoke-RestMethod -Uri $TelemetryUrl -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 5 | Out-Null } catch {}
}

Say ""
Say ("Cambrian built and installed.  cli " + $CliSha + " - core " + $CoreVer)

# --- 10. hand off to `cambrian init` -------------------------------------------------------
# cwd=$Prefix so init resolves ~\.cambrian\configs; the env vars point it at the checkouts for
# the agents, the Python SDK, and the Postgres compose file.
$env:CAMBRIAN_AGENTS_DIR = (Join-Path $CoreDir 'agents')
$env:CAMBRIAN_COMPOSE    = (Join-Path $CoreDir 'db\docker-compose.yml')
if ($SdkDir) { $env:CAMBRIAN_SDK_DIR = $SdkDir }
Set-Location $Prefix
if ($env:CAMBRIAN_SKIP_INIT -eq '1') {
  Say "Run 'cambrian init' to finish setup (Postgres, Python, models, config)."
} elseif ([Environment]::UserInteractive) {
  Say "Running first-time setup..."
  & $CliOut init
} else {
  Say "Run 'cambrian init' to finish setup (Postgres, Python, models, config)."
  Say ("  dot-source " + (Join-Path $Prefix 'source.env.ps1') + " first, so init finds the agents/SDK/compose in " + $SrcDir + ".")
}
