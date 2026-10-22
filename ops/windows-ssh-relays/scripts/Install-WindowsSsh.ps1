# Optional fresh-machine setup; not needed on the already configured desktop.
# Run from a LOCAL administrator console because changing sshd can end SSH sessions.
param(
    [string]$UserName = 'tsari',
    [Parameter(Mandatory)][string[]]$PublicKeyFiles,
    [string]$MsiPath,
    [string]$MsiSha256 = 'ddec9c53864280759cf9f74791cefd387100e3946aa849a1c138a4ed1b96b7d9'
)
. (Join-Path $PSScriptRoot 'Common.ps1')
Assert-Administrator
if ($UserName -notmatch '^[a-zA-Z0-9_.-]+$') { throw 'Invalid local user name.' }
Get-LocalUser -Name $UserName -ErrorAction Stop | Out-Null
$serverDir = Join-Path $env:ProgramFiles 'OpenSSH'
$clientDir = Join-Path $env:WINDIR 'System32\OpenSSH'
$configDir = Join-Path $env:ProgramData 'ssh'
$configPath = Join-Path $configDir 'sshd_config'
$authPath = Join-Path $configDir "gaasd_${UserName}_authorized_keys"
$marker = '# GAASD WINDOWS LOOPBACK SSH'
$service = Get-Service sshd -ErrorAction SilentlyContinue
if ((Test-Path $configPath) -and (Get-Content -Raw $configPath) -notmatch [regex]::Escape($marker)) {
    throw 'Existing SSH configuration is not managed by this project; review it manually.'
}
if ($service -and -not (Test-Path $configPath)) { throw 'Existing sshd service has no managed configuration.' }
$keys = @()
if (Test-Path $authPath) { $keys += @(Get-Content -LiteralPath $authPath | Where-Object { $_.Trim() }) }
foreach ($file in $PublicKeyFiles) {
    $key = (Get-Content -Raw -LiteralPath $file).Trim()
    if ($key -notmatch '^(ssh-ed25519|ssh-rsa) [A-Za-z0-9+/=]+(?: [^\r\n]*)?$') {
        throw "Expected a single public key in $file"
    }
    & (Join-Path $clientDir 'ssh-keygen.exe') -lf $file | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Invalid public key: $file" }
    $keys += $key
}
$keys = @($keys | Select-Object -Unique)
if (-not $service) {
    if (-not $MsiPath -or -not (Test-Path -LiteralPath $MsiPath)) { throw 'Supply a Microsoft OpenSSH MSI path.' }
    if ((Get-FileHash -LiteralPath $MsiPath -Algorithm SHA256).Hash -ne $MsiSha256) {
        throw 'Installer hash mismatch.'
    }
    $signature = Get-AuthenticodeSignature -LiteralPath $MsiPath
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') {
        throw 'Installer is not signed by Microsoft with a valid signature.'
    }
    New-Item -ItemType Directory -Path $configDir -Force | Out-Null
    $installer = Start-Process -FilePath "$env:WINDIR\System32\msiexec.exe" -WindowStyle Hidden -Wait -PassThru `
        -ArgumentList ('/i "{0}" ADDLOCAL=Server /qn /norestart' -f (Resolve-Path -LiteralPath $MsiPath).Path)
    if ($installer.ExitCode -notin @(0,3010)) { throw "MSI failed: $($installer.ExitCode)" }
    if ($installer.ExitCode -eq 3010) { Write-Warning 'MSI reported that a reboot is needed.' }
}
if (-not (Test-Path (Join-Path $serverDir 'sshd.exe'))) { $serverDir = $clientDir }
$serverExe = Join-Path $serverDir 'sshd.exe'
if (-not (Test-Path $serverExe)) { throw 'sshd.exe was not found.' }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
foreach ($path in @($configPath,$authPath)) {
    if (Test-Path $path) {
        $backup = "$path.before-gaasd-$stamp"
        Copy-Item -LiteralPath $path -Destination $backup
        Set-ProtectedAcl $backup
    }
}
$sftp = (Join-Path $serverDir 'sftp-server.exe').Replace('\','/')
$config = @"
$marker
Port 22
AddressFamily inet
ListenAddress 127.0.0.1
PubkeyAuthentication yes
PasswordAuthentication no
AuthenticationMethods publickey
AuthorizedKeysFile __PROGRAMDATA__/ssh/gaasd_${UserName}_authorized_keys
AllowUsers $UserName
PermitEmptyPasswords no
PermitUserEnvironment no
AllowAgentForwarding no
AllowTcpForwarding yes
GatewayPorts no
LogLevel INFO
Subsystem sftp "$sftp"
"@
[IO.File]::WriteAllText($authPath, ($keys -join "`n") + "`n", [Text.UTF8Encoding]::new($false))
Set-ProtectedAcl $authPath
$candidate = Join-Path $configDir 'gaasd_sshd_config_candidate'
[IO.File]::WriteAllText($candidate, $config + "`n", [Text.UTF8Encoding]::new($false))
Set-ProtectedAcl $candidate
& (Join-Path $clientDir 'ssh-keygen.exe') -A
if ($LASTEXITCODE -ne 0) { throw 'Host key generation failed.' }
& $serverExe -t -f $candidate
if ($LASTEXITCODE -ne 0) { throw 'Candidate SSH configuration failed validation.' }
Move-Item -LiteralPath $candidate -Destination $configPath -Force
Set-ProtectedAcl $configPath
Set-Service sshd -StartupType Automatic
& sc.exe failure sshd reset= 86400 actions= restart/5000/restart/15000/restart/60000 | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Service recovery configuration failed.' }
$registry = 'HKLM:\SOFTWARE\OpenSSH'
if (-not (Test-Path $registry)) { New-Item -Path $registry -Force | Out-Null }
if (-not (Get-ItemProperty -Path $registry -Name DefaultShell -ErrorAction SilentlyContinue)) {
    New-ItemProperty -Path $registry -Name DefaultShell -PropertyType String `
        -Value "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" | Out-Null
}
if ((Get-Service sshd).Status -eq 'Running') { Restart-Service sshd } else { Start-Service sshd }
Write-Output "SSH is configured for $UserName on 127.0.0.1:22 with public-key authentication."
