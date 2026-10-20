param([Parameter(Mandatory)][string]$PublicKeyFile)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$root='C:\ProgramData\GAASD-Monitor'
$taskName='GAASD-Hardware-Monitor'
$key=[IO.File]::ReadAllText($PublicKeyFile).Trim()
if($key -notmatch '\Assh-ed25519 [A-Za-z0-9+/]{68}( [^\r\n]+)?\z'){throw 'One Ed25519 public key required.'}
$principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Administrator required.'}
if((Test-Path $root) -and -not (Test-Path (Join-Path $root '.gaasd-managed'))){throw 'Existing unmanaged directory.'}
$task=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if($task -and -not (($task.Actions.Arguments -join ' ').Contains($root+'\Collect-Hardware.ps1'))){throw 'Unrelated task.'}
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
[IO.Directory]::CreateDirectory($root)|Out-Null
[IO.File]::WriteAllText((Join-Path $root '.gaasd-managed'),'GAASD hardware monitor')
# Protect all scripts executed as SYSTEM. No personal private key is copied.
& icacls.exe $root /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if($LASTEXITCODE -ne 0){throw 'Runtime ACL failed.'}
$backups=Join-Path $root ('backups\'+$stamp)
[IO.Directory]::CreateDirectory($backups)|Out-Null
if($task){
    Export-ScheduledTask -TaskName $taskName | Set-Content -LiteralPath (Join-Path $backups 'task.xml') -Encoding Unicode
    Stop-ScheduledTask -TaskName $taskName
}
foreach($name in @('Collect-Hardware.ps1','Read-Snapshot.ps1')){
    $target=Join-Path $root $name
    if(Test-Path $target){Copy-Item -LiteralPath $target -Destination (Join-Path $backups $name)}
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $target -Force
}
# Existing sshd_config explicitly uses this per-user file; keep all prior keys.
$auth='C:\ProgramData\ssh\gaasd_tsari_authorized_keys'
if(-not (Test-Path $auth)){throw 'Expected existing Windows SSH authorization file.'}
$entry='restrict,command="powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File C:/ProgramData/GAASD-Monitor/Read-Snapshot.ps1" '+$key
$contents=[IO.File]::ReadAllText($auth)
$blob=$key.Split(' ')[1]
if(-not $contents.Contains($blob)){
    Copy-Item -LiteralPath $auth -Destination (Join-Path $backups 'authorized_keys')
    $separator=if($contents.Length -and -not $contents.EndsWith("`n")){"`r`n"}else{''}
    [IO.File]::AppendAllText($auth,$separator+$entry+"`r`n",[Text.UTF8Encoding]::new($false))
} elseif(-not $contents.Contains($entry)){throw 'Key already authorized with different restrictions.'}
$exe="$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
$action=New-ScheduledTaskAction -Execute $exe -WorkingDirectory $root -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+$root+'\Collect-Hardware.ps1"')
$boot=New-ScheduledTaskTrigger -AtStartup
$boot.Delay='PT30S'
$retry=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$settings=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
$identity=New-ScheduledTaskPrincipal -UserId SYSTEM -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($boot,$retry) -Settings $settings -Principal $identity -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output ('Installed '+$taskName+'; existing relay tasks and sshd untouched. Backup: '+$backups)
