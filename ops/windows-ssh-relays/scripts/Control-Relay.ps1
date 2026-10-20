param(
    [ValidateSet('Status','Start','Stop','Restart')][string]$Action = 'Status',
    [ValidateSet('all','linux','windows','rtx4090')][string]$Name = 'all'
)
. (Join-Path $PSScriptRoot 'Common.ps1')
if ($Action -ne 'Status') { Assert-Administrator }
$relays = @(Get-RelayDefinitions | Where-Object { $Name -eq 'all' -or $_.name -eq $Name })
foreach ($relay in $relays) {
    $runDir = Join-Path $script:RuntimeRoot "runtime\$($relay.name)"
    $disabled = Join-Path $runDir 'disabled'
    if ($Action -in @('Stop','Restart')) {
        Set-Content -LiteralPath $disabled -Value (Get-Date -Format o)
        Disable-ScheduledTask -TaskName $relay.taskName | Out-Null
        Stop-ScheduledTask -TaskName $relay.taskName
        Stop-OwnedSsh (Join-Path $script:RuntimeRoot "config\$($relay.name).conf")
    }
    if ($Action -in @('Start','Restart')) {
        if (Test-Path $disabled) { Remove-Item -LiteralPath $disabled }
        Enable-ScheduledTask -TaskName $relay.taskName | Out-Null
        Start-ScheduledTask -TaskName $relay.taskName
    }
    $task = Get-ScheduledTask -TaskName $relay.taskName
    [pscustomobject]@{
        Name=$relay.name; Task=$relay.taskName; State=$task.State;
        Account=$task.Principal.UserId; LogonType=$task.Principal.LogonType;
        Disabled=(Test-Path $disabled)
    }
    $state = Join-Path $runDir 'state.json'
    if (Test-Path $state) { Get-Content -Raw -LiteralPath $state }
}
