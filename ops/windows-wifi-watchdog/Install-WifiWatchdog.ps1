param([Parameter(Mandatory)][string]$InterfaceGuid, [string]$ProfileName='tsari20F', [string]$Ssid='tsari20F')
$ErrorActionPreference = 'Stop'
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Run as administrator' }
if ($env:COMPUTERNAME -ne 'DESKTOP-9TOSVU4') { throw 'This installer targets only the institute Windows relay' }
if (@(Get-NetAdapter | Where-Object {([guid]$_.InterfaceGuid) -eq ([guid]$InterfaceGuid)}).Count -ne 1) { throw 'Unknown adapter GUID' }
$taskName = 'GAASD-Wifi-Watchdog'
$root = Join-Path $env:ProgramData 'GAASD-Wifi-Watchdog'
$marker = Join-Path $root '.gaasd-managed'
if ((Test-Path -LiteralPath $root) -and -not (Test-Path -LiteralPath $marker)) { throw 'Unmanaged runtime directory' }
$old = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($old -and -not (($old.Actions.Arguments -join ' ').Contains((Join-Path $root 'Watch-Wifi.ps1')))) { throw 'Unrelated task with same name' }
New-Item -ItemType Directory -Path $root -Force | Out-Null
$acl = [Security.AccessControl.DirectorySecurity]::new()
$acl.SetAccessRuleProtection($true,$false)
foreach ($sid in 'S-1-5-18','S-1-5-32-544') {
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid), 'FullControl', 'ContainerInherit,ObjectInherit','None','Allow'))
}
$acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
Set-Acl -LiteralPath $root -AclObject $acl
Set-Content -LiteralPath $marker -Value 'GAASD-Wifi-Watchdog-v1'
$backup = Join-Path $root ('backups\'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $backup -Force | Out-Null
if ($old) {
    Export-ScheduledTask -TaskName $taskName | Set-Content -LiteralPath (Join-Path $backup 'task.xml') -Encoding Unicode
    Disable-ScheduledTask -TaskName $taskName | Out-Null
    Stop-ScheduledTask -TaskName $taskName
}
foreach ($name in 'Watch-Wifi.ps1','Wifi-Common.ps1','config.json') {
    $dest = Join-Path $root $name
    if (Test-Path -LiteralPath $dest) { Copy-Item -LiteralPath $dest -Destination (Join-Path $backup $name) }
    if ($name -ne 'config.json') { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $dest -Force }
}
@{InterfaceGuid=$InterfaceGuid;ProfileName=$ProfileName;Ssid=$Ssid;Probes=@(
    @{Address='49.232.60.144';Port=22},@{Address='223.5.5.5';Port=53},@{Address='119.29.29.29';Port=53}
)} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $root 'config.json') -Encoding UTF8
$exe = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$action = New-ScheduledTaskAction -Execute $exe -WorkingDirectory $root -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f (Join-Path $root 'Watch-Wifi.ps1'))
$boot = New-ScheduledTaskTrigger -AtStartup
$boot.Delay = 'PT45S'
$repeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 3)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($boot,$repeat) -Settings $settings -Principal $principal -Description 'Check WLAN every 5 minutes; reconnect saved profile only after two failed connectivity rounds.' -Force | Out-Null
Write-Output "Installed $taskName; first run in one minute; existing relay tasks unchanged."
