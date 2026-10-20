param([ValidateSet('all','linux','windows')][string]$Name='all')
. (Join-Path $PSScriptRoot 'Common.ps1')
Assert-Administrator
$relays = @(Get-RelayDefinitions | Where-Object { $Name -eq 'all' -or $_.name -eq $Name })
foreach ($relay in $relays) {
    $config = Join-Path $script:RuntimeRoot "config\$($relay.name).conf"
    $statePath = Join-Path $script:RuntimeRoot "runtime\$($relay.name)\state.json"
    $original = [IO.File]::ReadAllText($config)
    $before = Get-Content -Raw $statePath | ConvertFrom-Json
    if ($before.sshPid -eq 0) { throw "Relay $($relay.name) must be running before this test." }
    if (Get-NetTCPConnection -State Listen -LocalPort 1 -ErrorAction SilentlyContinue) {
        throw 'TCP port 1 must be unused for the simulated outage.'
    }
    try {
        # Change only this tunnel's destination. No network adapter/firewall changes.
        $broken = [regex]::Replace($original,'(?m)^    HostName .+$','    HostName 127.0.0.1')
        $broken = [regex]::Replace($broken,'(?m)^    Port .+$','    Port 1')
        [IO.File]::WriteAllText($config,$broken,[Text.UTF8Encoding]::new($false))
        Stop-OwnedSsh $config
        Start-Sleep -Seconds 9
        $during = Get-Content -Raw $statePath | ConvertFrom-Json
        if ($during.sshPid -eq $before.sshPid) { throw 'Supervisor did not observe SSH termination.' }
        Write-Output "$($relay.name): simulated unreachable endpoint; supervisor status=$($during.status)"
    } finally {
        [IO.File]::WriteAllText($config,$original,[Text.UTF8Encoding]::new($false))
        # A process that already loaded the temporary configuration must reconnect.
        Stop-OwnedSsh $config
    }
    $deadline = (Get-Date).AddSeconds(75)
    do {
        Start-Sleep -Seconds 2
        $after = Get-Content -Raw $statePath | ConvertFrom-Json
        $connected = $false
        if ($after.sshPid -gt 0 -and $after.sshPid -ne $before.sshPid) {
            $connected = [bool](Get-NetTCPConnection -OwningProcess $after.sshPid -State Established -ErrorAction SilentlyContinue)
        }
    } while (-not $connected -and (Get-Date) -lt $deadline)
    if (-not $connected) { throw "$($relay.name): did not reconnect before the deadline." }
    Write-Output "$($relay.name): TCP reconnected, old PID=$($before.sshPid), new PID=$($after.sshPid). Verify end-to-end SSH separately."
}
