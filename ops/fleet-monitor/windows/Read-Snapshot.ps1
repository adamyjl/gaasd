$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
if($env:SSH_ORIGINAL_COMMAND -ne 'snapshot'){throw 'Only snapshot is permitted.'}
$path='C:\ProgramData\GAASD-Monitor\latest.json'
if(-not (Test-Path -LiteralPath $path)){throw 'No monitor sample yet.'}
if((Get-Item -LiteralPath $path).Length -gt 2000000){throw 'Oversized sample.'}
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::WriteLine([IO.File]::ReadAllText($path))
