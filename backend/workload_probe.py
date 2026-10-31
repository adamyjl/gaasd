"""Bounded, read-only task evidence. No environment, arbitrary commands or raw logs."""

import glob
import json
import os
import re
import subprocess
import time
from pathlib import Path

import psutil

SAFE_OPTIONS = {
    "model",
    "cfg_file",
    "config",
    "agent",
    "agent-config",
    "checkpoint",
    "pretrained_model",
    "extra_tag",
    "epochs",
    "batch_size",
    "workers",
    "launcher",
    "local-rank",
    "gpu",
    "gpu-rank",
    "port",
    "runtime",
    "routes",
    "name",
    "experiment_name",
    "agent.is_training",
    "agent.checkpoint_path",
    "train_test_split",
}
SECRET = re.compile(r"(?i)(password|passwd|token|secret|credential|api.?key|authorization)")


def safe_text(value, limit=180):
    value = str(value)
    value = re.sub(r"https?://\S+", "[URL omitted]", value)
    value = re.sub(r"[A-Za-z0-9_+/=-]{45,}", "[opaque value omitted]", value)
    value = re.sub(r"[\x00-\x1f\x7f]", " ", value)
    return value[:limit]


def command_summary(args):
    """Keep program/script names and selected workload options, never shell bodies."""
    output = []
    expect = None
    for index, arg in enumerate(args[:100]):
        if index == 0:
            output.append(Path(arg).name)
            continue
        if expect:
            if not SECRET.search(arg):
                output.append(expect + "=" + safe_text(arg.split("/")[-1]))
            expect = None
            continue
        if SECRET.search(arg):
            continue
        if "=" in arg:
            name, value = arg.lstrip("-").split("=", 1)
            if name in SAFE_OPTIONS:
                output.append(name + "=" + safe_text(value.split("/")[-1]))
        elif arg.lstrip("-") in SAFE_OPTIONS:
            expect = arg.lstrip("-")
        elif re.fullmatch(r"[\w./+-]+\.(py|sh|yaml)", arg):
            output.append(Path(arg).name)
        elif arg in {"torch.distributed.launch", "torch.distributed.run"}:
            output.append(arg)
    return output[:24]


def log_progress(proc):
    """Only read small regular local task logs; return progress lines, not free text."""
    candidates = []
    try:
        cwd = Path(proc.cwd()).resolve()
        if cwd == Path("/") or str(cwd).startswith(("/etc", "/proc", "/sys", "/root")):
            return []
        stdout = Path(os.readlink("/proc/%s/fd/1" % proc.pid))
        if stdout.suffix in {".log", ".txt"} and cwd in stdout.parents:
            candidates.append(stdout)
        # Project-owned launcher files and OpenPCDet's two known training directories.
        patterns = [str(cwd / "logs/launcher.log")]
        if cwd.name == "tools" and cwd.parent.name == "OpenPCDet":
            args = proc.cmdline()
            if "--extra_tag" in args and "--cfg_file" in args:
                tag = args[args.index("--extra_tag") + 1]
                cfg = Path(args[args.index("--cfg_file") + 1]).stem
                if re.fullmatch(r"[\w.-]+", tag) and re.fullmatch(r"[\w.-]+", cfg):
                    patterns.append(str(cwd.parent / "output" / cfg / tag / "log_train*.txt"))
        for pattern in patterns:
            candidates.extend(Path(p) for p in glob.glob(pattern)[:20])
        candidates = sorted(set(candidates), key=lambda p: p.stat().st_mtime, reverse=True)
        result = []
        for path in candidates[:1]:
            if not path.is_file() or path.is_symlink():
                continue
            with path.open("rb") as handle:
                handle.seek(max(0, path.stat().st_size - 6000))
                lines = handle.read(6000).decode("utf-8", errors="replace").splitlines()
            selected = []
            for line in lines:
                if SECRET.search(line):
                    continue
                # Extract numeric progress / status only. Do not transmit log prose/prompts.
                if line.startswith("{"):
                    try:
                        row = json.loads(line)
                        clean = {
                            k: row[k]
                            for k in (
                                "status",
                                "recorded",
                                "planned",
                                "physical_complete",
                                "formal",
                            )
                            if k in row and isinstance(row[k], (int, float, bool, str))
                        }
                        if clean:
                            selected.append(safe_text(json.dumps(clean), 260))
                    except ValueError:
                        pass
                else:
                    matches = re.findall(
                        r"(?i)(?:epoch[: ]+\d+(?:/\d+)?|acc_iter=\d+|cur_iter=\d+/\d+|loss=[\d.]+|EPOCH \d+ EVALUATION|Performance of EPOCH \d+|Evaluation done|Generate label finished)",
                        line,
                    )
                    if matches:
                        selected.append(" / ".join(matches)[:220])
            result.append(
                dict(file=path.name, updated_at=path.stat().st_mtime, progress=selected[-4:])
            )
        return result
    except (OSError, psutil.Error, ValueError, IndexError):
        return []


def query(fields, kind="gpu"):
    result = subprocess.run(
        ["nvidia-smi", "--query-" + kind + "=" + fields, "--format=csv,noheader,nounits"],
        capture_output=True,
        text=True,
        timeout=6,
        check=True,
    )
    return [line.split(", ") for line in result.stdout.strip().splitlines() if line.strip()]


def sample():
    start = time.time()
    samples = []
    for index in range(5):
        samples.append(query("index,uuid,name,utilization.gpu,memory.used,memory.total"))
        if index < 4:
            time.sleep(1)
    devices = []
    for row in samples[-1]:
        values = [float(r[3]) for s in samples for r in s if r[1] == row[1] and r[3].isdigit()]
        devices.append(
            dict(
                index=int(row[0]),
                uuid=row[1],
                name=row[2],
                utilization_samples=values,
                memory_used_mib=float(row[4]),
                memory_total_mib=float(row[5]),
            )
        )
    gpu_processes = query("gpu_uuid,pid,process_name,used_memory", "compute-apps")
    selected = {int(p[1]) for p in gpu_processes if p[1].isdigit()}
    # Include busy CPU-side evaluation workers, not just CUDA allocations.
    processes = list(psutil.process_iter(["pid", "name", "cpu_times"]))
    before = {p.pid: sum(p.info["cpu_times"][:2]) for p in processes if p.info.get("cpu_times")}
    tick = time.monotonic()
    time.sleep(1)
    cpu = {}
    for p in processes:
        try:
            cpu[p.pid] = max(
                0, (sum(p.cpu_times()[:2]) - before.get(p.pid, 0)) / (time.monotonic() - tick) * 100
            )
        except psutil.Error:
            continue
    selected.update(
        pid
        for pid in sorted(cpu, key=cpu.get, reverse=True)[:6]
        if cpu[pid] > 5 and pid != os.getpid()
    )
    records = []
    for pid in sorted(selected)[:32]:
        try:
            p = psutil.Process(pid)
            args = command_summary(p.cmdline())
            try:
                cwd = "/".join(Path(p.cwd()).parts[-3:])
            except psutil.Error:
                cwd = "不可读取"
            parent = p.parent()
            record = dict(
                pid=pid,
                owner=safe_text(p.username(), 40),
                elapsed_seconds=round(time.time() - p.create_time()),
                state=p.status(),
                cpu_percent=round(cpu.get(pid, 0), 1),
                command=args,
                project=safe_text(cwd),
                parent_command=command_summary(parent.cmdline()) if parent else [],
                gpus=[
                    dict(
                        index=next((d["index"] for d in devices if d["uuid"] == g[0]), None),
                        memory_mib=float(g[3]) if g[3].isdigit() else None,
                    )
                    for g in gpu_processes
                    if g[1] == str(pid)
                ],
                progress=log_progress(p),
            )
            records.append(record)
        except (psutil.Error, OSError, ValueError):
            continue
    return dict(
        sampled_at=time.time(),
        window_seconds=round(time.time() - start, 1),
        devices=devices,
        processes=records,
        note="仅短时采样；CPU 百分比按单核。进程环境、任意日志和凭据不采集；无权读取的证据缺失。",
    )


if __name__ == "__main__":
    if os.environ.get("SSH_ORIGINAL_COMMAND") != "workloads":
        raise SystemExit("Only workloads is permitted")
    print(json.dumps(sample(), ensure_ascii=True, allow_nan=False))
