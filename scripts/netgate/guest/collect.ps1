<#
.SYNOPSIS
  Fresh-install network capture gate: collect the guest side of one run. Run
  in the guest, as admin, after the installer reaches Done.
.DESCRIPTION
  Exports the Sysmon log and copies the docker-compose.yml the installer
  cloned into \\VBoxSvr\out\<runId>\. Nothing else leaves the guest: no .env,
  no vault, no install log, no screenshots. See docs/NETWORK_GATE.md.
#>
param([string]$OutRoot = '\\VBoxSvr\out')
$ErrorActionPreference = 'Stop'

$runId = ([IO.File]::ReadAllText((Join-Path $OutRoot 'current-run.txt'))).Trim()
$dest = Join-Path $OutRoot $runId
New-Item -ItemType Directory -Force $dest | Out-Null

$tmp = Join-Path $env:TEMP 'netgate-sysmon.evtx'
if (Test-Path $tmp) { Remove-Item $tmp -Force }
wevtutil epl Microsoft-Windows-Sysmon/Operational $tmp
if ($LASTEXITCODE -ne 0) { throw "wevtutil epl failed ($LASTEXITCODE)" }
Copy-Item $tmp (Join-Path $dest 'sysmon.evtx') -Force
Write-Output 'sysmon.evtx collected'

# The installer records its chosen install path here.
$pathFile = Join-Path $env:APPDATA 'Ember Setup\ember-install-path.txt'
if (Test-Path $pathFile) {
  $compose = Join-Path ([IO.File]::ReadAllText($pathFile)).Trim() 'docker-compose.yml'
  if (Test-Path $compose) {
    Copy-Item $compose (Join-Path $dest 'docker-compose.yml') -Force
    Write-Output 'docker-compose.yml collected'
  } else {
    Write-Warning "No docker-compose.yml in the install path."
  }
} else {
  Write-Warning "No install path recorded; the install did not complete (baseline runs expect this)."
}
Write-Output "Done. On the host: run-capture.ps1 -Phase stop"
