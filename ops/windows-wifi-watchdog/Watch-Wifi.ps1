param(
    [string]$ConfigPath = (Join-Path $env:ProgramData 'GAASD-Wifi-Watchdog\config.json'),
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Wifi-Common.ps1')
$cfg = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$root = Split-Path -Parent $ConfigPath
$lock = $null
try {
    try { $lock = [IO.File]::Open((Join-Path $root 'watchdog.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
    catch [IO.IOException] { exit 0 }
    Invoke-WifiWatchdog -Config $cfg -Root $root -CheckOnly:$CheckOnly
} catch {
    Write-WifiLog -Root $root -Event 'error' -Data @{message=$_.Exception.Message}
    exit 1
} finally {
    if ($lock) { $lock.Dispose() }
}
