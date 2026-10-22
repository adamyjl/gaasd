$ErrorActionPreference = 'Stop'
$script:RuntimeRoot = Join-Path $env:ProgramData 'GAASD-SSH-Relays'

function Assert-RelayDeployment($Deployment) {
    # These assignments belong only to the Suzhou Windows relay. In particular,
    # never reuse the independent Ubuntu relay's 2222 / 18765 or its account.
    $expected = @{
        linux = @{
            taskName = 'GAASD-Tsari-SSH-Relay'
            cloudUser = 'gaasd-tsari-relay'
            remotePort = 2223
            legacyDirectory = 'D:\Server\tsari-relay'
        }
        windows = @{
            taskName = 'GAASD-Windows-SSH-Relay'
            cloudUser = 'gaasd-windows-relay'
            remotePort = 2224
            legacyDirectory = 'D:\Server\windows-relay'
        }
        rtx4090 = @{
            taskName = 'GAASD-RTX4090-SSH-Relay'
            cloudUser = 'gaasd-4090-relay'
            remotePort = 2225
            legacyDirectory = $null
        }
    }
    if ($Deployment.cloudHost -ne '49.232.60.144' -or $Deployment.cloudPort -ne 22) {
        throw 'This deployment supports only the registered Tencent SSH endpoint on port 22.'
    }
    $names = @($Deployment.relays.name)
    if ($names.Count -notin @(2,3) -or
        @($names | Sort-Object -Unique).Count -ne $names.Count -or
        'linux' -cnotin $names -or 'windows' -cnotin $names) {
        throw 'Expected linux and windows relays, with an optional rtx4090 relay.'
    }
    foreach ($relay in $Deployment.relays) {
        if ($relay.name -cnotin @('linux','windows','rtx4090')) { throw 'Unknown relay name.' }
        $assignment = $expected[$relay.name]
        if ($relay.taskName -ne $assignment.taskName -or
            $relay.cloudUser -cne $assignment.cloudUser -or
            $relay.remotePort -ne $assignment.remotePort) {
            throw "Reserved assignment mismatch for $($relay.name); refusing to change another tunnel."
        }
        if ($relay.targetHost -notmatch '\A[A-Za-z0-9.-]+\z' -or
            $relay.targetPort -lt 1 -or $relay.targetPort -gt 65535) {
            throw 'Invalid relay target.'
        }
        if ($relay.name -eq 'windows' -and
            ($relay.targetHost -ne '127.0.0.1' -or $relay.targetPort -ne 22)) {
            throw 'The Windows relay must point to its local loopback SSH service.'
        }
        if ($relay.name -eq 'rtx4090' -and
            ($relay.targetHost -ne '192.168.1.19' -or $relay.targetPort -ne 22)) {
            throw 'The RTX 4090 relay must point to 192.168.1.19:22.'
        }
        if ($relay.legacyDirectory -and
            [IO.Path]::GetFullPath($relay.legacyDirectory).TrimEnd('\') -ne $assignment.legacyDirectory) {
            throw 'Unexpected legacy directory; refusing to stop unrelated SSH processes.'
        }
    }
}

function Get-RelayInstallPlan($Deployment, $Installed, [string[]]$Names) {
    Assert-RelayDeployment $Deployment
    $selected = @($Deployment.relays)
    $preserved = @()
    if ($Names.Count -gt 0) {
        if (@($Names | Sort-Object -Unique).Count -ne $Names.Count) { throw 'Duplicate selected relay.' }
        foreach ($name in $Names) {
            if ($name -cnotin @($Deployment.relays.name)) { throw "No deployment configuration for $name" }
        }
        if ($null -eq $Installed) { throw 'Selective install requires an existing managed runtime.' }
        Assert-RelayDeployment $Installed
        $selected = @($Deployment.relays | Where-Object { $_.name -cin $Names })
        $preserved = @($Installed.relays | Where-Object { $_.name -cnotin $Names })
    } elseif ($null -ne $Installed) {
        Assert-RelayDeployment $Installed
        if (@($Installed.relays | Where-Object { $_.name -cnotin @($Deployment.relays.name) }).Count) {
            throw 'Deployment omits an installed relay; use -Name for a selective update.'
        }
    }
    $merged = [pscustomobject]@{
        cloudHost=$Deployment.cloudHost; cloudPort=$Deployment.cloudPort
        relays=@($preserved) + @($selected)
    }
    Assert-RelayDeployment $merged
    [pscustomobject]@{ Selected=$selected; Preserved=$preserved }
}

function Assert-Administrator {
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Run this command in an administrator PowerShell window.'
    }
}

function Set-ProtectedAcl([string]$Path, [bool]$AllowUsersRead = $false) {
    $item = Get-Item -LiteralPath $Path
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "Refusing reparse point: $Path"
    }
    $systemSid = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
    $adminSid = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
    if ($item.PSIsContainer) {
        $acl = [Security.AccessControl.DirectorySecurity]::new()
        $inheritance = [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
    } else {
        $acl = [Security.AccessControl.FileSecurity]::new()
        $inheritance = [Security.AccessControl.InheritanceFlags]::None
    }
    $acl.SetOwner($systemSid)
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in @($systemSid, $adminSid)) {
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
            $sid, 'FullControl', $inheritance, 'None', 'Allow'))
    }
    if ($AllowUsersRead) {
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
            [Security.Principal.SecurityIdentifier]::new('S-1-5-32-545'),
            'ReadAndExecute', $inheritance, 'None', 'Allow'))
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}

function Get-RelayDefinitions {
    $path = Join-Path $script:RuntimeRoot 'relays.json'
    if (-not (Test-Path $path)) { throw 'Relays have not been installed.' }
    (Get-Content -Raw -LiteralPath $path | ConvertFrom-Json).relays
}

function Stop-OwnedSsh([string]$ConfigPath) {
    Get-CimInstance Win32_Process -Filter "Name = 'ssh.exe'" |
        Where-Object { $_.CommandLine -and $_.CommandLine.Contains($ConfigPath) } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
