param([Parameter(Mandatory)][ValidateSet('linux', 'windows', 'rtx4090')][string]$Name)
. (Join-Path $PSScriptRoot 'Common.ps1')
$relay = Get-RelayDefinitions | Where-Object name -eq $Name
if (-not $relay) { throw "No configuration for $Name" }
$runDir = Join-Path $script:RuntimeRoot "runtime\$Name"
$configPath = Join-Path $script:RuntimeRoot "config\$Name.conf"
$stopPath = Join-Path $runDir 'disabled'
$statePath = Join-Path $runDir 'state.json'
$logPath = Join-Path $runDir 'relay.log'
$sshLogPath = Join-Path $runDir 'ssh.log'
$sshPath = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
$lockStream = $null
$sshProcess = $null

function Write-RelayLog([string]$Message) {
    if ((Test-Path $logPath) -and (Get-Item $logPath).Length -gt 1MB) {
        Move-Item -LiteralPath $logPath -Destination "$logPath.1" -Force
    }
    Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format o) $Message" -Encoding UTF8
}

function Write-RelayState([string]$Status, [int]$SshProcessId = 0) {
    @{
        name = $Name
        supervisorPid = $PID
        sshPid = $SshProcessId
        status = $Status
        account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
        sessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId
        updatedAt = (Get-Date).ToString('o')
        remoteListen = "127.0.0.1:$($relay.remotePort)"
        target = "$($relay.targetHost):$($relay.targetPort)"
    } | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
}

if (Test-Path $stopPath) { exit 0 }
try {
    $lockStream = [IO.File]::Open((Join-Path $runDir 'relay.lock'),
        [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
} catch [IO.IOException] {
    exit 0
}
try {
    Stop-OwnedSsh $configPath
    Write-RelayLog 'Supervisor started.'
    $retrySeconds = 5
    while (-not (Test-Path $stopPath)) {
        if ((Test-Path $sshLogPath) -and (Get-Item $sshLogPath).Length -gt 1MB) {
            Move-Item -LiteralPath $sshLogPath -Destination "$sshLogPath.1" -Force
        }
        $startInfo = [Diagnostics.ProcessStartInfo]::new()
        $startInfo.FileName = $sshPath
        $startInfo.Arguments = '-F "{0}" -E "{1}" -N -T -n relay' -f $configPath, $sshLogPath
        $startInfo.UseShellExecute = $false
        $startInfo.CreateNoWindow = $true
        $sshProcess = [Diagnostics.Process]::Start($startInfo)
        $startedAt = Get-Date
        Write-RelayState 'connecting-or-running' $sshProcess.Id
        Write-RelayLog "SSH started with PID $($sshProcess.Id)."
        while (-not $sshProcess.WaitForExit(1000)) {
            if (Test-Path $stopPath) {
                $sshProcess.Kill()
                $sshProcess.WaitForExit()
                break
            }
        }
        $exitCode = $sshProcess.ExitCode
        $runtime = ((Get-Date) - $startedAt).TotalSeconds
        $sshProcess.Dispose()
        $sshProcess = $null
        if (Test-Path $stopPath) { break }
        if ($runtime -ge 120) { $retrySeconds = 5 }
        Write-RelayState 'reconnecting'
        Write-RelayLog "SSH exited with code $exitCode after $([int]$runtime)s; retry in ${retrySeconds}s."
        for ($second = 0; $second -lt $retrySeconds; $second++) {
            if (Test-Path $stopPath) { break }
            Start-Sleep -Seconds 1
        }
        $retrySeconds = [Math]::Min(60, $retrySeconds * 2)
    }
} catch {
    Write-RelayLog "Supervisor error: $($_.Exception.Message)"
    throw
} finally {
    if ($null -ne $sshProcess) {
        if (-not $sshProcess.HasExited) {
            $sshProcess.Kill()
            $sshProcess.WaitForExit()
        }
        $sshProcess.Dispose()
    }
    Write-RelayState 'stopped'
    Write-RelayLog 'Supervisor stopped.'
    if ($null -ne $lockStream) { $lockStream.Dispose() }
}
