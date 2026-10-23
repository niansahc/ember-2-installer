<#
.SYNOPSIS
  Fresh-install network capture gate: one-off guest preparation. Run once in
  the throwaway guest, as admin, before taking the netgate-clean snapshot.
.DESCRIPTION
  - Installs Sysmon with sysmon-netgate.xml (EID 1, 3, 22) and a 256 MB log.
  - Puts the docker.cmd shim on the machine PATH.
  - Forwards 127.0.0.1:8888 (the SearXNG URL the backend hardcodes) to the
    host's SearXNG at 10.0.2.2:8888 with netsh portproxy.
  - Checks SearXNG through the proxy, winget, and that no Ember install exists.
  Expects the read-only share at \\VBoxSvr\share holding guest\ and
  tools\Sysmon64.exe. See docs/NETWORK_GATE.md.
#>
param([string]$ShareRoot = '\\VBoxSvr\share')
$ErrorActionPreference = 'Stop'

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run as administrator.' }

$guestDir = Join-Path $ShareRoot 'guest'
$sysmonExe = Join-Path $ShareRoot 'tools\Sysmon64.exe'
if (-not (Test-Path $sysmonExe)) { throw "Missing $sysmonExe (download Sysmon on the host into C:\netgate\share\tools)." }

# Sysmon: install, or update the config if already installed.
$config = Join-Path $guestDir 'sysmon-netgate.xml'
if (Get-Service -Name Sysmon64 -ErrorAction SilentlyContinue) {
  & $sysmonExe -c $config | Out-Null
} else {
  & $sysmonExe -accepteula -i $config | Out-Null
}
if ($LASTEXITCODE -ne 0) { throw "Sysmon install/config failed ($LASTEXITCODE)" }
wevtutil sl Microsoft-Windows-Sysmon/Operational /ms:268435456
Write-Output 'Sysmon OK'

# Docker shim on the machine PATH.
$shimDir = 'C:\netgate\shim'
New-Item -ItemType Directory -Force $shimDir | Out-Null
Copy-Item (Join-Path $guestDir 'docker.cmd') $shimDir -Force
$machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
if (($machinePath -split ';') -notcontains $shimDir) {
  [Environment]::SetEnvironmentVariable('Path', "$machinePath;$shimDir", 'Machine')
}
Write-Output 'docker shim OK'

# Portproxy needs the IP Helper service.
Set-Service -Name iphlpsvc -StartupType Automatic
Start-Service -Name iphlpsvc
netsh interface portproxy delete v4tov4 listenaddress=127.0.0.1 listenport=8888 2>$null | Out-Null
netsh interface portproxy add v4tov4 listenaddress=127.0.0.1 listenport=8888 connectaddress=10.0.2.2 connectport=8888 | Out-Null
$code = & curl.exe -s -o NUL -w '%{http_code}' --max-time 10 http://127.0.0.1:8888/
if ($code -ne '200') { throw "SearXNG via 127.0.0.1:8888 answered '$code'. Start it on the host (docker compose up -d in ember-2)." }
Write-Output 'SearXNG OK'

$winget = Get-Command winget -ErrorAction SilentlyContinue
if (-not $winget) { throw 'winget missing. Update App Installer from the Microsoft Store, then rerun.' }
Write-Output "winget OK $(winget --version)"

foreach ($p in @('C:\EmberVault', (Join-Path $env:APPDATA 'Ember Setup'))) {
  if (Test-Path $p) { throw "$p exists. The snapshot must be taken before any Ember install." }
}
Write-Output 'clean OK'
Write-Output 'Next: shut the guest down and take snapshot netgate-clean.'
