param(
    [Parameter(Mandatory)][string]$ConfigPath,
    [switch]$MigrateLegacy
)
. (Join-Path $PSScriptRoot 'Common.ps1')
Assert-Administrator
$deployment = Get-Content -Raw -LiteralPath $ConfigPath | ConvertFrom-Json
Assert-RelayDeployment $deployment
$sshPath = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
$keygenPath = Join-Path $env:WINDIR 'System32\OpenSSH\ssh-keygen.exe'
foreach ($relay in $deployment.relays) {
    if (-not (Test-Path -LiteralPath $relay.privateKeySource -PathType Leaf)) { throw 'Private key source missing.' }
    $existingTask = Get-ScheduledTask -TaskName $relay.taskName -ErrorAction SilentlyContinue
    if ($existingTask) {
        $arguments = ($existingTask.Actions | ForEach-Object Arguments) -join ' '
        $managedAction = $arguments.Contains((Join-Path $script:RuntimeRoot 'bin\Run-Relay.ps1'))
        $legacyAction = $MigrateLegacy -and $relay.legacyDirectory -and
            $arguments.Contains((Join-Path $relay.legacyDirectory 'Run-Relay.ps1'))
        if (-not ($managedAction -or $legacyAction)) { throw "Unrelated task: $($relay.taskName)" }
    }
}
$trustedHostLines = @(& $keygenPath -F $deployment.cloudHost -f $deployment.knownHostsSource |
    Where-Object { $_ -and -not $_.StartsWith('#') })
if ($LASTEXITCODE -ne 0 -or $trustedHostLines.Count -eq 0) { throw 'Cloud host key must already be trusted.' }

$marker = Join-Path $script:RuntimeRoot '.gaasd-managed'
if ((Test-Path $script:RuntimeRoot) -and -not (Test-Path $marker)) { throw 'Runtime directory is not managed by this project.' }
New-Item -ItemType Directory -Path $script:RuntimeRoot -Force | Out-Null
Set-ProtectedAcl $script:RuntimeRoot $true
Set-Content -LiteralPath $marker -Value 'GAASD-SSH-Relays-v1'
foreach ($child in @('bin','config','credentials','runtime','runtime\linux','runtime\windows','backups')) {
    $path = Join-Path $script:RuntimeRoot $child
    New-Item -ItemType Directory -Path $path -Force | Out-Null
    Set-ProtectedAcl $path ($child -notin @('credentials','backups'))
}
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
foreach ($relay in $deployment.relays) {
    $existingTask = Get-ScheduledTask -TaskName $relay.taskName -ErrorAction SilentlyContinue
    if ($existingTask) {
        Export-ScheduledTask -TaskName $relay.taskName |
            Set-Content -LiteralPath (Join-Path $script:RuntimeRoot "backups\$($relay.name)-$stamp.xml") -Encoding Unicode
        Disable-ScheduledTask -TaskName $relay.taskName | Out-Null
        Stop-ScheduledTask -TaskName $relay.taskName
    }
    if ($MigrateLegacy -and $relay.legacyDirectory) {
        if (Test-Path $relay.legacyDirectory) {
            Set-Content -LiteralPath (Join-Path $relay.legacyDirectory 'disabled') -Value 'Migrated to SYSTEM startup tasks.'
            Stop-OwnedSsh (Join-Path $relay.legacyDirectory 'relay-ssh.conf')
        }
    }
    Stop-OwnedSsh (Join-Path $script:RuntimeRoot "config\$($relay.name).conf")
}
foreach ($name in @('Common.ps1','Run-Relay.ps1','Control-Relay.ps1','Test-RelayRecovery.ps1')) {
    $dest = Join-Path $script:RuntimeRoot "bin\$name"
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $dest -Force
    Set-ProtectedAcl $dest $true
}
$hostFile = Join-Path $script:RuntimeRoot 'credentials\cloud_known_hosts'
[IO.File]::WriteAllLines($hostFile, $trustedHostLines, [Text.UTF8Encoding]::new($false))
Set-ProtectedAcl $hostFile
$installedRelays = @()
foreach ($relay in $deployment.relays) {
    $keyFile = Join-Path $script:RuntimeRoot "credentials\$($relay.name)_ed25519"
    Copy-Item -LiteralPath $relay.privateKeySource -Destination $keyFile -Force
    Set-ProtectedAcl $keyFile
    $keyForConfig = $keyFile.Replace('\','/')
    $hostsForConfig = $hostFile.Replace('\','/')
    $config = @"
Host relay
    HostName $($deployment.cloudHost)
    Port $($deployment.cloudPort)
    User $($relay.cloudUser)
    IdentityFile "$keyForConfig"
    UserKnownHostsFile "$hostsForConfig"
    IdentitiesOnly yes
    BatchMode yes
    PreferredAuthentications publickey
    StrictHostKeyChecking yes
    UpdateHostKeys no
    ExitOnForwardFailure yes
    ConnectTimeout 10
    ConnectionAttempts 1
    ServerAliveInterval 15
    ServerAliveCountMax 3
    TCPKeepAlive yes
    ForwardAgent no
    ForwardX11 no
    RequestTTY no
    ControlMaster no
    Compression no
    RemoteForward 127.0.0.1:$($relay.remotePort) $($relay.targetHost):$($relay.targetPort)
"@
    $sshConfig = Join-Path $script:RuntimeRoot "config\$($relay.name).conf"
    [IO.File]::WriteAllText($sshConfig, $config + "`n", [Text.UTF8Encoding]::new($false))
    Set-ProtectedAcl $sshConfig $true
    & $sshPath -G -F $sshConfig relay | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Generated SSH configuration is invalid.' }
    $installedRelays += [pscustomobject]@{
        name=$relay.name; taskName=$relay.taskName; cloudUser=$relay.cloudUser;
        remotePort=$relay.remotePort; targetHost=$relay.targetHost; targetPort=$relay.targetPort
    }
}
@{cloudHost=$deployment.cloudHost; cloudPort=$deployment.cloudPort; relays=$installedRelays} |
    ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $script:RuntimeRoot 'relays.json') -Encoding UTF8

$powershellPath = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
foreach ($relay in $installedRelays) {
    $runner = Join-Path $script:RuntimeRoot 'bin\Run-Relay.ps1'
    $action = New-ScheduledTaskAction -Execute $powershellPath -WorkingDirectory $script:RuntimeRoot `
        -Argument ('-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -Name {1}' -f $runner,$relay.name)
    $boot = New-ScheduledTaskTrigger -AtStartup
    $boot.Delay = 'PT15S'
    $watchdog = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew `
        -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    Register-ScheduledTask -TaskName $relay.taskName -Action $action -Trigger @($boot,$watchdog) `
        -Principal $principal -Settings $settings -Force `
        -Description "GAASD $($relay.name) reverse SSH relay; runs at boot without interactive login." | Out-Null
    $disabled = Join-Path $script:RuntimeRoot "runtime\$($relay.name)\disabled"
    if (Test-Path $disabled) { Remove-Item -LiteralPath $disabled }
    Start-ScheduledTask -TaskName $relay.taskName
}
Write-Output "Installed both SYSTEM startup tasks. Runtime: $script:RuntimeRoot"
