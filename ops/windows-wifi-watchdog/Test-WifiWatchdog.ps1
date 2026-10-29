param([string]$OutputRoot=(Join-Path $env:TEMP ('gaasd-wifi-test-'+[guid]::NewGuid().ToString('N'))))
$ErrorActionPreference='Stop'
$OutputRoot = Join-Path $OutputRoot ([guid]::NewGuid().ToString('N'))
. (Join-Path $PSScriptRoot 'Wifi-Common.ps1')
# Pure state-machine tests: no real network, adapter, task, or netsh calls.
function Write-WifiLog($Root,$Event,$Data) { $script:Events += $Event }
function Get-WifiObservation($Config) { return $script:Observation }
function Test-WifiInternet($Observation,$Config) {
    $index=[Math]::Min($script:HealthIndex,$script:Health.Count-1)
    $script:HealthIndex++
    return $script:Health[$index]
}
function Invoke-WifiNetsh($Action,$Name,$Profile) {
    $script:Actions += $Action
    if ($script:ThrowDisconnect -and $Action -eq 'disconnect') { throw 'simulated disconnect error' }
    return @{exit_code=0}
}
function Start-Sleep { param($Seconds) }
$cfg=[pscustomobject]@{Ssid='demo';ProfileName='demo'}
$tests=@(
    @{Name='healthy';Health=@($true);Actions=@();Event='healthy'},
    @{Name='transient';Health=@($false,$true);Actions=@();Event='recovered_without_reset'},
    @{Name='offline-connected';Health=@($false,$false,$true);Actions=@('disconnect','connect');Event='reconnect_finished'},
    @{Name='disassociated';Health=@($false,$false,$true);Ssid='';Actions=@('connect');Event='reconnect_finished'},
    @{Name='other-network';Skip='other_ssid';Health=@($false);Actions=@();Event='skip'},
    @{Name='disabled';Skip='adapter_disabled';Health=@($false);Actions=@();Event='skip'},
    @{Name='ambiguous';Skip='ambiguous_wlan_interface';Health=@($false);Actions=@();Event='skip'},
    @{Name='cooldown';Health=@($false,$false);Cooldown=$true;Actions=@();Event='cooldown'},
    @{Name='check-only';Health=@($false);CheckOnly=$true;Actions=@();Event='unhealthy_check_only'},
    @{Name='disconnect-error';Health=@($false,$false);Throws=$true;Actions=@('disconnect','connect');Event='connect_requested'}
)
foreach ($case in $tests) {
    $caseRoot=Join-Path $OutputRoot $case.Name
    New-Item -ItemType Directory -Path $caseRoot -Force | Out-Null
    $script:Actions=@();$script:Events=@();$script:Health=$case.Health;$script:HealthIndex=0
    $script:ThrowDisconnect=[bool]$case.Throws
    $ssid=if ($case.ContainsKey('Ssid')) {$case.Ssid} else {'demo'}
    $script:Observation=@{Name='WLAN';Ssid=$ssid;Skip=$case.Skip;Addresses=@('192.0.2.2')}
    if ($case.Cooldown) {
        @{last_reconnect_utc=[DateTimeOffset]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $caseRoot 'state.json')
    }
    $didThrow=$false
    try { Invoke-WifiWatchdog $cfg $caseRoot -CheckOnly:([bool]$case.CheckOnly) }
    catch { $didThrow=$true; if (-not $case.Throws) { throw } }
    if ($case.Throws -and -not $didThrow) { throw 'Expected error was not propagated' }
    if (($script:Actions -join ',') -ne ($case.Actions -join ',')) { throw ('Unexpected actions: '+$case.Name) }
    if ($case.Event -notin $script:Events) { throw ('Missing event: '+$case.Name) }
    Write-Output ('PASS '+$case.Name)
}
Write-Output '10 state-machine checks passed (mocked; not a real Wi-Fi outage test).'
