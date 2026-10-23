<#
.SYNOPSIS
  Fresh-install network capture gate: drive one VirtualBox guest capture.
.DESCRIPTION
  start  Restore the clean snapshot, point the NIC trace at a new run
         directory, start the VM. The pcap is written outside the guest's
         shares, so nothing in the guest can read or alter it.
  stop   Power the VM off, turn the trace off, copy sysmon.evtx and
         docker-compose.yml (written by guest\collect.ps1) into the run
         directory, and print the analyze command.
  Needs no admin rights. See docs/NETWORK_GATE.md.
.EXAMPLE
  powershell -File scripts\netgate\run-capture.ps1 -Phase start
  powershell -File scripts\netgate\run-capture.ps1 -Phase stop
#>
param(
  [Parameter(Mandatory = $true)][ValidateSet('start', 'stop')][string]$Phase,
  [string]$VmName = 'ember-netgate',
  [string]$Snapshot = 'netgate-clean',
  [string]$CaptureRoot = 'C:\netgate\captures',
  [string]$OutShare = 'C:\netgate\out',
  [switch]$Baseline
)
$ErrorActionPreference = 'Stop'

function Find-VBoxManage {
  $candidates = @()
  if ($env:VBOX_MSI_INSTALL_PATH) { $candidates += Join-Path $env:VBOX_MSI_INSTALL_PATH 'VBoxManage.exe' }
  $candidates += 'C:\Program Files\Oracle\VirtualBox\VBoxManage.exe'
  foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
  throw 'VBoxManage.exe not found. Install VirtualBox first (docs/NETWORK_GATE.md, one-off setup).'
}
$vbox = Find-VBoxManage

function Invoke-VBox {
  & $vbox @args
  if ($LASTEXITCODE -ne 0) { throw "VBoxManage $($args -join ' ') exited $LASTEXITCODE" }
}

function Get-VmState {
  $line = & $vbox showvminfo $VmName --machinereadable | Where-Object { $_ -like 'VMState=*' }
  return ($line -replace '^VMState="?([^"]*)"?$', '$1')
}

$currentFile = Join-Path $OutShare 'current-run.txt'

if ($Phase -eq 'start') {
  if (@('poweroff', 'saved', 'aborted') -notcontains (Get-VmState)) { throw "VM $VmName is running. Stop it first." }
  $suffix = ''
  if ($Baseline) { $suffix = '-baseline' }
  $runId = (Get-Date -Format 'yyyyMMdd-HHmmss') + $suffix
  $runDir = Join-Path $CaptureRoot $runId
  New-Item -ItemType Directory -Force $runDir | Out-Null
  New-Item -ItemType Directory -Force (Join-Path $OutShare $runId) | Out-Null

  Invoke-VBox snapshot $VmName restore $Snapshot
  Invoke-VBox modifyvm $VmName --nictrace1 on --nictracefile1 (Join-Path $runDir 'guest.pcap')
  [IO.File]::WriteAllText($currentFile, $runId)
  $meta = [ordered]@{ runId = $runId; vm = $VmName; snapshot = $Snapshot; baseline = [bool]$Baseline; startedUtc = (Get-Date).ToUniversalTime().ToString('o') }
  [IO.File]::WriteAllText((Join-Path $runDir 'run.json'), ($meta | ConvertTo-Json))
  Invoke-VBox startvm $VmName --type gui

  Write-Output "started $runId"
  Write-Output "runDir $runDir"
  return
}

# stop
if (-not (Test-Path $currentFile)) { throw "No run in progress ($currentFile missing)." }
$runId = ([IO.File]::ReadAllText($currentFile)).Trim()
$runDir = Join-Path $CaptureRoot $runId

if ((Get-VmState) -eq 'running') {
  Invoke-VBox controlvm $VmName acpipowerbutton
  $deadline = (Get-Date).AddSeconds(180)
  $state = Get-VmState
  while ($state -ne 'poweroff' -and (Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    $state = Get-VmState
  }
  if ($state -ne 'poweroff') {
    Invoke-VBox controlvm $VmName poweroff
    Start-Sleep -Seconds 3
  }
}
Invoke-VBox modifyvm $VmName --nictrace1 off

$collected = Join-Path $OutShare $runId
foreach ($f in @('sysmon.evtx', 'docker-compose.yml')) {
  $p = Join-Path $collected $f
  if (Test-Path $p) { Copy-Item $p $runDir -Force } else { Write-Warning "$f not collected. Run guest\collect.ps1 in the guest before stop." }
}
Remove-Item $currentFile

$pcap = Join-Path $runDir 'guest.pcap'
if (-not (Test-Path $pcap)) { throw "No pcap at $pcap. The NIC trace did not run." }
Write-Output "stopped $runId ($((Get-Item $pcap).Length) bytes of pcap)"
$flag = ''
if ($runId -like '*-baseline') { $flag = ' --baseline' }
Write-Output "next: npm run netgate:analyze -- `"$runDir`"$flag"
