$ErrorActionPreference = 'Stop'

function Write-WifiLog($Root, $Event, $Data) {
    $path = Join-Path $Root 'watchdog.jsonl'
    if ((Test-Path -LiteralPath $path) -and (Get-Item -LiteralPath $path).Length -gt 2MB) {
        Move-Item -LiteralPath $path -Destination ($path+'.1') -Force
    }
    $entry = @{time=[DateTimeOffset]::Now.ToString('o');event=$Event;data=$Data}
    $line = $entry | ConvertTo-Json -Compress -Depth 5
    [IO.File]::AppendAllText($path, $line+"`r`n", [Text.UTF8Encoding]::new($false))
}

function Get-WifiObservation($Config) {
    $adapters = @(Get-NetAdapter | Where-Object {([guid]$_.InterfaceGuid) -eq ([guid]$Config.InterfaceGuid)})
    if ($adapters.Count -ne 1) { return @{Skip='adapter_missing'} }
    $adapter = $adapters[0]
    if ([string]$adapter.Status -eq 'Disabled') { return @{Skip='adapter_disabled'} }
    if ((Get-Service WlanSvc).Status -ne 'Running') { return @{Skip='wlan_service_stopped'} }
    # One physical WLAN interface is verified on this machine. Fail closed if that changes.
    $raw = (& "$env:WINDIR\System32\netsh.exe" wlan show interfaces) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw 'Cannot query WLAN interfaces' }
    $guids = [regex]::Matches($raw, '(?im)^\s*GUID\s*:\s*\{?([a-f0-9-]{36})\}?\s*$')
    if ($guids.Count -ne 1 -or ([guid]$guids[0].Groups[1].Value) -ne ([guid]$Config.InterfaceGuid)) {
        return @{Skip='ambiguous_wlan_interface'}
    }
    $ssid = [regex]::Match($raw, '(?im)^\s*SSID\s*:\s*(.*?)\s*$').Groups[1].Value
    if ($ssid -and $ssid -cne $Config.Ssid) { return @{Skip='other_ssid';Ssid=$ssid} }
    $addresses = @(Get-NetIPAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object {$_.AddressState -eq 'Preferred' -and $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -ne '127.0.0.1'} |
        Select-Object -ExpandProperty IPAddress)
    return @{Name=$adapter.Name;Ssid=$ssid;Addresses=$addresses;Skip=$null}
}

function Test-WifiTcp($Source, $Address, $Port) {
    $client = [Net.Sockets.TcpClient]::new([Net.Sockets.AddressFamily]::InterNetwork)
    $pending = $null
    try {
        # Bind to WLAN's address so a working ZeroTier/other interface cannot mask its failure.
        $client.Client.Bind([Net.IPEndPoint]::new([Net.IPAddress]::Parse($Source), 0))
        $pending = $client.BeginConnect([Net.IPAddress]::Parse($Address), [int]$Port, $null, $null)
        if (-not $pending.AsyncWaitHandle.WaitOne(2500)) { return $false }
        $client.EndConnect($pending)
        return $client.Connected
    } catch { return $false }
    finally {
        if ($pending) { $pending.AsyncWaitHandle.Close() }
        $client.Close()
    }
}

function Test-WifiInternet($Observation, $Config) {
    foreach ($source in $Observation.Addresses) {
        foreach ($endpoint in $Config.Probes) {
            if (Test-WifiTcp $source $endpoint.Address $endpoint.Port) { return $true }
        }
    }
    return $false
}

function Invoke-WifiNetsh($Action, $Name, $Profile) {
    if ($Action -eq 'disconnect') {
        $output = & "$env:WINDIR\System32\netsh.exe" wlan disconnect "interface=$Name" 2>&1
    } else {
        $output = & "$env:WINDIR\System32\netsh.exe" wlan connect "name=$Profile" "interface=$Name" 2>&1
    }
    return @{exit_code=$LASTEXITCODE;output=($output -join ' ')}
}

function Invoke-WifiWatchdog($Config, $Root, [switch]$CheckOnly) {
    $observation = Get-WifiObservation $Config
    if ($observation.Skip) { Write-WifiLog $Root 'skip' $observation; return }
    if (Test-WifiInternet $observation $Config) {
        Write-WifiLog $Root 'healthy' @{ssid=$observation.Ssid;addresses=$observation.Addresses;check_only=[bool]$CheckOnly}
        return
    }
    if ($CheckOnly) { Write-WifiLog $Root 'unhealthy_check_only' $observation; return }
    Start-Sleep -Seconds 10
    $observation = Get-WifiObservation $Config
    if ($observation.Skip) { Write-WifiLog $Root 'skip_recheck' $observation; return }
    if (Test-WifiInternet $observation $Config) { Write-WifiLog $Root 'recovered_without_reset' @{}; return }

    $statePath = Join-Path $Root 'state.json'
    if (Test-Path -LiteralPath $statePath) {
        $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
        # Allow probe-duration/scheduler jitter between 5-minute triggers.
        if (([DateTimeOffset]::UtcNow - [DateTimeOffset]::Parse($state.last_reconnect_utc)).TotalSeconds -lt 270) {
            Write-WifiLog $Root 'cooldown' @{}; return
        }
    }
    # Persist before disconnect, independent of the administrator's SSH session.
    @{last_reconnect_utc=[DateTimeOffset]::UtcNow.ToString('o')} |
        ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
    Write-WifiLog $Root 'reconnect_start' @{ssid=$Config.Ssid;interface=$observation.Name}
    try {
        if ($observation.Ssid) {
            $disconnect = Invoke-WifiNetsh 'disconnect' $observation.Name $Config.ProfileName
            Write-WifiLog $Root 'disconnect' $disconnect
            Start-Sleep -Seconds 2
        }
    } finally {
        # Always attempt reconnect, even if disconnect returned an error.
        $connect = Invoke-WifiNetsh 'connect' $observation.Name $Config.ProfileName
        Write-WifiLog $Root 'connect_requested' $connect
    }
    Start-Sleep -Seconds 25
    $after = Get-WifiObservation $Config
    $ok = (-not $after.Skip) -and (Test-WifiInternet $after $Config)
    Write-WifiLog $Root 'reconnect_finished' @{online=$ok;observation=$after}
}
