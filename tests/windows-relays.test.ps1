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
Write-Output "$checks checks passed: PowerShell syntax and reserved relay assignments."
