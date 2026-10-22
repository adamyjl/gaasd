# Read-only tests: never install tasks, connect to servers or modify SSH settings.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$package = Join-Path $root 'ops\windows-ssh-relays'
. (Join-Path $package 'scripts\Common.ps1')
$checks = 0
foreach ($file in Get-ChildItem -LiteralPath $package -Filter '*.ps1' -Recurse) {
    $tokens = $null
    $parseErrors = $null
    [Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$parseErrors) | Out-Null
    if ($parseErrors.Count) { throw "$($file.Name): $($parseErrors.Message -join '; ')" }
    $checks++
}
$template = Get-Content -Raw -LiteralPath (Join-Path $package 'config\relays.example.json')
Assert-RelayDeployment ($template | ConvertFrom-Json)
$checks++

function Assert-Rejected([string]$Name, [scriptblock]$Change) {
    $deployment = $template | ConvertFrom-Json
    & $Change $deployment
    $rejected = $false
    try { Assert-RelayDeployment $deployment } catch { $rejected = $true }
    if (-not $rejected) { throw "Unsafe configuration accepted: $Name" }
    $script:checks++
}

Assert-Rejected 'Ubuntu SSH port' { param($d) $d.relays[0].remotePort = 2222 }
Assert-Rejected 'Ubuntu monitor port' { param($d) $d.relays[1].remotePort = 18765 }
Assert-Rejected 'duplicate port' { param($d) $d.relays[1].remotePort = 2223 }
Assert-Rejected 'exchanged assigned ports' {
    param($d) $d.relays[0].remotePort = 2224; $d.relays[1].remotePort = 2223
}
Assert-Rejected 'Ubuntu tunnel account' { param($d) $d.relays[0].cloudUser = 'gaasd-office-tunnel' }
Assert-Rejected 'administrator account' { param($d) $d.relays[1].cloudUser = 'ubuntu' }
Assert-Rejected 'unrelated task' { param($d) $d.relays[0].taskName = 'Other-SSH-Task' }
Assert-Rejected 'unrelated legacy directory' { param($d) $d.relays[0].legacyDirectory = 'D:\OtherProject' }
Assert-Rejected 'duplicate route' { param($d) $d.relays[1].name = 'linux' }
Assert-Rejected 'missing route' { param($d) $d.relays = @($d.relays[0]) }
Assert-Rejected 'unknown route' { param($d) $d.relays[1].name = 'office' }
Assert-Rejected 'unregistered cloud endpoint' { param($d) $d.cloudHost = 'example.com' }
Assert-Rejected 'unsupported cloud port' { param($d) $d.cloudPort = 2222 }
Assert-Rejected 'non-loopback Windows target' { param($d) $d.relays[1].targetHost = '192.168.0.37' }
Assert-Rejected 'invalid target port' { param($d) $d.relays[0].targetPort = 65536 }
Assert-Rejected 'newline in target host' { param($d) $d.relays[0].targetHost = "192.168.1.111`n" }
Assert-Rejected '4090 reused 5090 port' { param($d) $d.relays[2].remotePort = 2223 }
Assert-Rejected '4090 wrong target' { param($d) $d.relays[2].targetHost = '192.168.1.111' }
Assert-Rejected '4090 wrong account' { param($d) $d.relays[2].cloudUser = 'gaasd-tsari-relay' }
Assert-Rejected '4090 legacy migration' { param($d) $d.relays[2] | Add-Member legacyDirectory 'D:\Server\tsari-relay' }

$full = $template | ConvertFrom-Json
$legacy = $template | ConvertFrom-Json
$legacy.relays = @($legacy.relays | Where-Object name -ne 'rtx4090')
Assert-RelayDeployment $legacy
$checks++
$plan = Get-RelayInstallPlan $full $legacy @('rtx4090')
if ($plan.Selected.Count -ne 1 -or $plan.Selected[0].name -ne 'rtx4090' -or
    $plan.Preserved.Count -ne 2 -or
    (ConvertTo-Json -InputObject @($plan.Preserved) -Depth 8 -Compress) -cne
    (ConvertTo-Json -InputObject @($legacy.relays) -Depth 8 -Compress)) {
    throw 'Selective installation did not preserve the installed routes.'
}
$checks++
# Updates to unselected deployment entries must never modify live definitions.
$full.relays[0].targetHost = '192.168.1.99'
$plan = Get-RelayInstallPlan $full $legacy @('rtx4090')
if (($plan.Preserved | Where-Object name -eq 'linux').targetHost -ne '192.168.1.111') {
    throw 'An unselected route was overwritten.'
}
$checks++
foreach ($scenario in @('fresh-selective','missing-selected','duplicate-selected','implicit-removal')) {
    $rejected = $false
    try {
        switch ($scenario) {
            'fresh-selective' { Get-RelayInstallPlan $full $null @('rtx4090') | Out-Null }
            'missing-selected' { Get-RelayInstallPlan $legacy $legacy @('rtx4090') | Out-Null }
            'duplicate-selected' { Get-RelayInstallPlan $full $legacy @('rtx4090','rtx4090') | Out-Null }
            'implicit-removal' { Get-RelayInstallPlan $legacy $full @() | Out-Null }
        }
    } catch { $rejected = $true }
    if (-not $rejected) { throw "Unsafe install plan accepted: $scenario" }
    $checks++
}
Write-Output "$checks checks passed: PowerShell syntax, reserved assignments and selective installation."
