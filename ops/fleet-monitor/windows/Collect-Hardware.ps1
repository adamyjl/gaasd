param([switch]$Once)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$root='C:\ProgramData\GAASD-Monitor'
$previous=$null
$inventory=$null
$inventoryAt=0
$started=[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$lock=[IO.File]::Open((Join-Path $root 'collector.lock'),'OpenOrCreate','ReadWrite','None')
function Stamp { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()/1000.0 }
function Query([string]$Class,[string]$Namespace='root/cimv2'){
    try { @(Get-CimInstance -ClassName $Class -Namespace $Namespace -OperationTimeoutSec 5 -ErrorAction Stop) }
    catch { @() }
}
function Numeric($value,$factor=1){
    $n=0.0
    if([double]::TryParse([string]$value,[Globalization.NumberStyles]::Float,[Globalization.CultureInfo]::InvariantCulture,[ref]$n) -and
       -not [double]::IsNaN($n) -and -not [double]::IsInfinity($n) -and $n -ge 0){$n*$factor}else{$null}
}
function Rate($current,$old,$seconds){
    if($null -eq $current -or $null -eq $old -or $seconds -le 0 -or $current -lt $old){return $null}
    [Math]::Round(($current-$old)/$seconds,3)
}
function Inventory {
    $system=Query Win32_ComputerSystem | Select-Object -First 1
    $os=Query Win32_OperatingSystem | Select-Object -First 1
    $cpu=Query Win32_Processor | Select-Object -First 1
    $board=Query Win32_BaseBoard | Select-Object -First 1
    $disks=@(Query Win32_DiskDrive | ForEach-Object {
        @{name=$_.DeviceID;model=$_.Model;size=[double]$_.Size;interface=$_.InterfaceType;temperature_c=$null}
    })
    try {
        $physical=@(Get-PhysicalDisk -ErrorAction Stop)
        foreach($disk in $disks){
            $match=$physical | Where-Object {$disk.name -eq ('\\.\PHYSICALDRIVE'+$_.DeviceId)} | Select-Object -First 1
            if($match){
                $health=$match | Get-StorageReliabilityCounter -ErrorAction Stop
                if($health.Temperature -gt 0){$disk.temperature_c=[double]$health.Temperature}
                $disk.health=[string]$match.HealthStatus
            }
        }
    } catch {}
    $thermal=@(Query MSAcpi_ThermalZoneTemperature 'root/WMI' | ForEach-Object {
        if($_.CurrentTemperature -gt 2000 -and $_.CurrentTemperature -lt 4500){
            @{label=$_.InstanceName;current=[Math]::Round($_.CurrentTemperature/10.0-273.15,1);high=$null;critical=$null}
        }
    })
    @{
        os=$os.Caption;kernel=$os.Version;boot_time=([DateTimeOffset]$os.LastBootUpTime).ToUnixTimeSeconds()
        memory_total=[double]$system.TotalPhysicalMemory;logical=[int]$system.NumberOfLogicalProcessors
        physical=[int]$cpu.NumberOfCores;frequency=[double]$cpu.MaxClockSpeed
        hardware=@{
            cpu_model=$cpu.Name;manufacturer=$system.Manufacturer;model=$system.Model;board=$board.Product
            memory_modules=@(Query Win32_PhysicalMemory | ForEach-Object {@{model=([string]$_.PartNumber).Trim();capacity=[double]$_.Capacity;speed_mhz=$_.Speed}})
            disks=$disks
            network_adapters=@(Query Win32_NetworkAdapter | Where-Object {$_.PhysicalAdapter} | ForEach-Object {@{name=$_.Name;speed=$_.Speed}})
            note='ACPI thermal zones are not CPU package/core sensors. Per-process network byte rates are not provided by Windows counters.'
        }
        temperatures=@{acpi=$thermal;disks=@($disks | Where-Object {$null -ne $_.temperature_c} | ForEach-Object {@{label=$_.model;current=$_.temperature_c;high=$null;critical=$null}})}
    }
}
function Gpu {
    $devices=@();$processes=@();$available=$false
    try {
        $lines=& "$env:WINDIR\System32\nvidia-smi.exe" '--query-gpu=index,uuid,name,pci.bus_id,driver_version,utilization.gpu,utilization.memory,memory.total,memory.used,memory.free,temperature.gpu,power.draw,power.limit,fan.speed,pstate' '--format=csv,noheader,nounits' 2>$null
        if($LASTEXITCODE -ne 0){throw 'GPU query failed'}
        foreach($line in $lines){
            $v=@($line.Split(',')|ForEach-Object{$_.Trim()})
            if($v.Count -ne 15){continue}
            $devices+=@{index=[int]$v[0];uuid=$v[1];name=$v[2];pci_bus=$v[3];driver=$v[4];utilization_percent=(Numeric $v[5]);memory_activity_percent=(Numeric $v[6]);memory_total=(Numeric $v[7] 1048576);memory_used=(Numeric $v[8] 1048576);memory_free=(Numeric $v[9] 1048576);temperature_c=(Numeric $v[10]);power_w=(Numeric $v[11]);power_limit_w=(Numeric $v[12]);fan_percent=(Numeric $v[13]);performance_state=$v[14]}
        }
        $available=$devices.Count -gt 0
    } catch {}
    @{available=$available;expected_count=1;devices=$devices;processes=$processes;note=$(if($available){$null}else{'NVIDIA telemetry unavailable'});process_note='Windows WDDM process GPU usage is shown in the software resource table; unavailable memory values are not zero.'}
}
try {
    do {
        $cycle=[Diagnostics.Stopwatch]::StartNew()
        try {
            $now=Stamp
            if(-not $inventory -or $now-$inventoryAt -ge 60){$inventory=Inventory;$inventoryAt=$now}
            $rawCpu=@(Query Win32_PerfRawData_PerfOS_Processor | Where-Object {$_.Name -ne '_Total'})
            $cores=@()
            $cpuState=@{}
            foreach($core in $rawCpu){
                $entry=@{idle=[double]$core.PercentProcessorTime;stamp=[double]$core.Timestamp_Sys100NS}
                $cpuState[$core.Name]=$entry
                $pct=$null
                if($previous -and $previous.cpu.ContainsKey($core.Name)){
                    $old=$previous.cpu[$core.Name];$delta=$entry.stamp-$old.stamp
                    if($delta -gt 0 -and $entry.idle -ge $old.idle){$pct=[Math]::Round([Math]::Max(0,[Math]::Min(100,100*(1-($entry.idle-$old.idle)/$delta))),1)}
                }
                $cores+=@{index=[int]$core.Name;percent=$pct;iowait=$null;steal=$null}
            }
            $cpuPercent=$null
            if($cores.Count -and @($cores|Where-Object{$null -eq $_.percent}).Count -eq 0){$cpuPercent=[Math]::Round((($cores|ForEach-Object{[double]$_.percent})|Measure-Object -Average).Average,1)}
            $elapsed=if($previous){$now-$previous.stamp}else{0}
            $os=Query Win32_OperatingSystem | Select-Object -First 1
            $total=[double]$inventory.memory_total;$free=[double]$os.FreePhysicalMemory*1024
            $swapItems=@(Query Win32_PageFileUsage)
            $swapTotal=($swapItems|Measure-Object AllocatedBaseSize -Sum).Sum*1048576
            $swapUsed=($swapItems|Measure-Object CurrentUsage -Sum).Sum*1048576
            $network=@();$netState=@{}
            foreach($nic in (Query Win32_PerfRawData_Tcpip_NetworkInterface)){
                $entry=@{rx=[double]$nic.BytesReceivedPersec;tx=[double]$nic.BytesSentPersec}
                $netState[$nic.Name]=$entry
                $old=if($previous -and $previous.net.ContainsKey($nic.Name)){$previous.net[$nic.Name]}else{@{}}
                $network+=@{name=$nic.Name;is_up=$nic.CurrentBandwidth -gt 0;mtu=$null;addresses=@();bytes_recv=$entry.rx;bytes_sent=$entry.tx;rx_rate=(Rate $entry.rx $old.rx $elapsed);tx_rate=(Rate $entry.tx $old.tx $elapsed);errin=[double]$nic.PacketsReceivedErrors;errout=[double]$nic.PacketsOutboundErrors;dropin=[double]$nic.PacketsReceivedDiscarded;dropout=[double]$nic.PacketsOutboundDiscarded}
            }
            $filesystems=@(Query Win32_LogicalDisk|Where-Object{$_.DriveType -eq 3}|ForEach-Object{
                $capacity=[double]$_.Size;$available=[double]$_.FreeSpace
                @{mount=$_.DeviceID;device=$_.DeviceID;filesystem=$_.FileSystem;kind='local';total=$capacity;free=$available;used=$capacity-$available;percent=$(if($capacity){[Math]::Round(100*($capacity-$available)/$capacity,1)}else{$null});inode_percent=$null}
            })
            $diskIo=@(Query Win32_PerfFormattedData_PerfDisk_PhysicalDisk|Where-Object{$_.Name -ne '_Total'}|ForEach-Object{
                @{name=$_.Name;read_rate=[double]$_.DiskReadBytesPersec;write_rate=[double]$_.DiskWriteBytesPersec;read_iops=[double]$_.DiskReadsPersec;write_iops=[double]$_.DiskWritesPersec;busy_percent=[Math]::Min(100,[double]$_.PercentDiskTime)}
            })
            $gpuEngine=@{}
            foreach($engine in (Query Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine)){
                if($engine.Name -match '^pid_(\d+)_'){
                    $key=$Matches[1];$v=[double]$engine.UtilizationPercentage
                    if(-not $gpuEngine.ContainsKey($key) -or $v -gt $gpuEngine[$key]){$gpuEngine[$key]=[Math]::Min(100,$v)}
                }
            }
            $gpuMemory=@{}
            foreach($gm in (Query Win32_PerfFormattedData_GPUPerformanceCounters_GPUProcessMemory)){
                if($gm.Name -match '^pid_(\d+)_'){$gpuMemory[$Matches[1]]=[double]$gm.DedicatedUsage}
            }
            $procIo=@{}
            foreach($p in (Query Win32_PerfFormattedData_PerfProc_Process)){
                $procIo[[string]$p.IDProcess]=@{read_rate=[double]$p.IOReadBytesPersec;write_rate=[double]$p.IOWriteBytesPersec}
            }
            $processes=@();$procState=@{}
            foreach($p in (Get-Process)){
                try {
                    $identity=[string]$p.Id+'|'+$p.StartTime.ToFileTimeUtc()
                    $cpuSeconds=$p.TotalProcessorTime.TotalSeconds
                    $procState[$identity]=$cpuSeconds
                    $old=if($previous -and $previous.processes.ContainsKey($identity)){$previous.processes[$identity]}else{$null}
                    $ratio=Rate $cpuSeconds $old $elapsed
                    $key=[string]$p.Id
                    $processes+=[pscustomobject]@{pid=$p.Id;name=$p.ProcessName;state='running';rss=[double]$p.WorkingSet64;cpu_percent=$(if($null -ne $ratio){[Math]::Min(100,[Math]::Round($ratio*100/[Math]::Max(1,$inventory.logical),1))}else{$null});gpu_percent=$gpuEngine[$key];gpu_memory=$gpuMemory[$key];io_read_rate=$procIo[$key].read_rate;io_write_rate=$procIo[$key].write_rate}
                } catch {}
            }
            $top=@(@($processes|Sort-Object cpu_percent -Descending|Select-Object -First 8)+@($processes|Sort-Object rss -Descending|Select-Object -First 8)+@($processes|Where-Object{$_.gpu_percent -gt 0}|Sort-Object gpu_percent -Descending|Select-Object -First 8)+@($processes|Sort-Object io_write_rate -Descending|Select-Object -First 8)|Sort-Object -Property { $_.pid } -Unique)
            $services=@(Get-Service sshd,WlanSvc,ZeroTierOneService -ErrorAction SilentlyContinue|ForEach-Object{@{Id=$_.Name;ActiveState=$(if($_.Status -eq 'Running'){'active'}else{'inactive'});SubState=[string]$_.Status;UnitFileState=[string]$_.StartType}})
            $latency=@{kind='icmp';direction='Windows -> Tencent public';checked_at=$now;rtt_ms=$null}
            try{
                $ping=New-Object Net.NetworkInformation.Ping
                $reply=$ping.Send('49.232.60.144',2000)
                if($reply.Status -eq 'Success'){$latency.rtt_ms=[double]$reply.RoundtripTime}
                $ping.Dispose()
            }catch{}
            $data=@{
                generated_at=(Stamp);sample_seconds=[Math]::Round($elapsed,1);interval_seconds=30;collector_started_at=$started
                host=@{name=$env:COMPUTERNAME;os=$inventory.os;kernel=$inventory.kernel;architecture=$env:PROCESSOR_ARCHITECTURE;boot_time=$inventory.boot_time;uptime_seconds=[int]($now-$inventory.boot_time);logical_cpus=$inventory.logical;physical_cpus=$inventory.physical;frequency_mhz=$inventory.frequency}
                cpu=@{percent=$cpuPercent;cores=$cores;load=$null}
                memory=@{total=$total;available=$free;free=$null;in_use=$total-$free;percent=[Math]::Round(100*($total-$free)/$total,1);cached=$null;buffers=$null}
                swap=@{total=$swapTotal;used=$swapUsed;free=$swapTotal-$swapUsed;percent=$(if($swapTotal){100*$swapUsed/$swapTotal}else{0});in_rate=$null;out_rate=$null}
                network=$network;filesystems=$filesystems;disk_io=$diskIo;hardware=$inventory.hardware;temperatures=$inventory.temperatures
                processes=@{total=@(Get-Process).Count;visible=$processes.Count;states=@{running=$processes.Count};top=$top}
                gpu=(Gpu);services=$services;checked_at=$inventoryAt;pressure=@{};tcp=$null;files=$null;certificate=$null;backup=$null;latency=$latency
            }
            $previous=@{stamp=$now;cpu=$cpuState;net=$netState;processes=$procState}
            $json=ConvertTo-Json -InputObject $data -Depth 10 -Compress
            [IO.File]::WriteAllText((Join-Path $root 'latest.next'),$json,[Text.UTF8Encoding]::new($false))
            $destination=Join-Path $root 'latest.json'
            if(Test-Path -LiteralPath $destination){[IO.File]::Replace((Join-Path $root 'latest.next'),$destination,(Join-Path $root 'latest.previous'))}else{[IO.File]::Move((Join-Path $root 'latest.next'),$destination)}
        } catch {
            $log=Join-Path $root 'collector.log'
            if((Test-Path $log) -and (Get-Item $log).Length -gt 1048576){Move-Item -LiteralPath $log -Destination ($log+'.1') -Force}
            Add-Content -LiteralPath $log -Value ((Get-Date -Format o)+' '+$_.Exception.Message+' '+$_.ScriptStackTrace) -Encoding UTF8
            if($Once){throw}
        }
        if(-not $Once){Start-Sleep -Seconds ([Math]::Max(1,30-[int]$cycle.Elapsed.TotalSeconds))}
    } while(-not $Once)
} finally {$lock.Dispose()}
