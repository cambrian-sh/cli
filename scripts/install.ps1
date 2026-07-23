# Cambrian installer for Windows — CLI-004 (D7). Behavior-identical to install.sh: downloads
# the two binaries, installs to %USERPROFILE%\.cambrian\bin, updates the user PATH (registry,
# no admin), hands off to `cambrian init`. It does NOT set up Postgres/Python/models — that
# is `cambrian init`'s job.
#
#   powershell -ExecutionPolicy Bypass -c "irm https://cambrian.dev/install.ps1 | iex"
#
# Windows PowerShell 5.1 compatible (no ternary / null-coalescing).
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$CliRepo      = 'cambrian-sh/cli'
$CoreRepo     = 'cambrian-sh/core'
$Prefix       = if ($env:CAMBRIAN_HOME) { $env:CAMBRIAN_HOME } else { Join-Path $env:USERPROFILE '.cambrian' }
$BinDir       = Join-Path $Prefix 'bin'
$ConfigPath   = Join-Path $Prefix 'config.json'
$TelemetryUrl = 'https://telemetry.cambrian.dev/v1/install'

function Say($m)  { Write-Host $m }
function Ok($m)   { Write-Host ("  " + $m + " ") -NoNewline; Write-Host ([char]0x2713) -ForegroundColor Green }
function Die($m)  { Write-Host ""; Write-Host ("X " + $m) -ForegroundColor Red; exit 1 }

Say "Cambrian installer  ·  https://github.com/$CliRepo"

# --- 1. platform (Windows x64 only in V1) -------------------------------------------------
$arch = $env:PROCESSOR_ARCHITECTURE
if ($arch -ne 'AMD64' -and $arch -ne 'x86_64') {
  Die "Cambrian on Windows ships x64 only in V1 (detected '$arch'). arm64 Windows is on the roadmap."
}
$Platform = 'windows-x64'
Say "  platform: $Platform"

# --- release-redirect helpers (no API, no JSON) -------------------------------------------
function Asset-Url($repo, $asset) { "https://github.com/$repo/releases/latest/download/$asset" }
function Latest-Tag($repo) {
  try {
    $r = Invoke-WebRequest -Uri "https://github.com/$repo/releases/latest" -UseBasicParsing -MaximumRedirection 5
    $u = $r.BaseResponse.ResponseUri.AbsoluteUri
    return ($u -split '/tag/')[-1]
  } catch { return $null }
}
$Latest = Latest-Tag $CliRepo
if (-not $Latest) { Die "Could not reach GitHub. Check your network or install manually: https://cambrian.dev/manual-install" }
Say "  latest:   $Latest"

# --- idempotency: up to date? -------------------------------------------------------------
$CliOut = Join-Path $BinDir 'cambrian.exe'
if (Test-Path $CliOut) {
  try { $cur = (& $CliOut --version) 2>$null } catch { $cur = '' }
  if ($cur) {
    $curV = ($cur -split '\s+')[-1]
    if (($curV -eq ($Latest -replace '^v','')) -or (("v" + $curV) -eq $Latest)) {
      Say ("Cambrian is up to date (" + $Latest + ").")
      exit 0
    }
    Say ("  upgrading " + $curV + " -> " + $Latest)
  }
}

$Tmp = Join-Path ([IO.Path]::GetTempPath()) ("cambrian-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Tmp -Force | Out-Null
try {
  # --- download + checksum-verify one asset -----------------------------------------------
  function Fetch-Verified($repo, $asset, $out) {
    try { Invoke-WebRequest -Uri (Asset-Url $repo $asset) -OutFile $out -UseBasicParsing }
    catch { Die "Could not reach GitHub. Check your network or install manually: https://cambrian.dev/manual-install" }
    $sumsPath = Join-Path $Tmp ((($repo -split '/')[-1]) + '.SHA256SUMS')
    try { Invoke-WebRequest -Uri (Asset-Url $repo 'SHA256SUMS') -OutFile $sumsPath -UseBasicParsing }
    catch { Die "Could not download SHA256SUMS for $repo. Try again or install manually: https://cambrian.dev/manual-install" }
    $line = Select-String -Path $sumsPath -Pattern ([Regex]::Escape($asset) + '$') | Select-Object -First 1
    if (-not $line) { Die "No checksum for $asset in $repo SHA256SUMS. Refusing to install." }
    $expected = (($line.Line -split '\s+')[0]).ToLower()
    $actual   = (Get-FileHash -Path $out -Algorithm SHA256).Hash.ToLower()
    if ($expected -ne $actual) {
      Die "Binary integrity check failed. Refusing to install. Possible cause: incomplete download or compromised release. Try again or report at https://github.com/$CliRepo/issues"
    }
  }

  Say ""
  $cliTmp  = Join-Path $Tmp 'cambrian.exe'
  $orchTmp = Join-Path $Tmp 'cambrian-orchestrator.exe'
  Fetch-Verified $CliRepo  ("cambrian-" + $Platform + ".exe")              $cliTmp;  Ok "Downloaded cambrian ($Platform)"
  Fetch-Verified $CoreRepo ("cambrian-orchestrator-" + $Platform + ".exe") $orchTmp; Ok "Downloaded cambrian-orchestrator ($Platform)"

  # --- install ----------------------------------------------------------------------------
  try { New-Item -ItemType Directory -Path $BinDir -Force | Out-Null } catch { Die "Cannot write to $BinDir. Check disk space and permissions." }
  Move-Item -Force $cliTmp  $CliOut
  Move-Item -Force $orchTmp (Join-Path $BinDir 'cambrian-orchestrator.exe')
  Ok "Installed to $BinDir"
} finally {
  Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
}

# --- PATH update (user-level, registry; idempotent) ---------------------------------------
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($null -eq $userPath) { $userPath = '' }
if ($userPath -notlike "*$BinDir*") {
  $newPath = if ($userPath.TrimEnd(';') -eq '') { $BinDir } else { $userPath.TrimEnd(';') + ';' + $BinDir }
  [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
  $env:Path = $env:Path + ';' + $BinDir
  Say "  added to user PATH (open a new terminal to pick it up)"
}

# --- verify the binary runs ---------------------------------------------------------------
try { & $CliOut --version | Out-Null } catch { Die "Downloaded binary is not executable. Report at https://github.com/$CliRepo/issues" }

# --- telemetry opt-in (default OFF when non-interactive) ----------------------------------
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
  $body = (@{ os = 'windows'; arch = 'x64'; version = $Latest; result = 'success' } | ConvertTo-Json -Compress)
  try { Invoke-RestMethod -Uri $TelemetryUrl -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 5 | Out-Null } catch {}
}

Say ""
Say ("Cambrian " + $Latest + " installed.")

# --- hand off to `cambrian init` ----------------------------------------------------------
if ([Environment]::UserInteractive) {
  Say "Running first-time setup..."
  & $CliOut init
} else {
  Say "Run 'cambrian init' to finish setup (Postgres, Python, models, config)."
}
