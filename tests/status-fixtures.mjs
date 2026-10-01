// Synthetic data for browser tests; no production snapshots or credentials.
export function sample(internal = false) {
  const now = Date.now() / 1000;
  const GiB = 1024 ** 3;
  const cores = internal ? 112 : 2;
  return {
    generated_at: now,
    checked_at: now,
    interval_seconds: 30,
    host: {
      name: internal ? "test-internal" : "test-cloud",
      os: "Ubuntu",
      logical_cpus: cores,
      uptime_seconds: 86400,
      boot_time: now - 86400,
      kernel: "test",
      architecture: "x86_64",
    },
    cpu: {
      percent: 12,
      load: [0.1, 0.2, 0.3],
      cores: Array.from({ length: cores }, (_, index) => ({
        index,
        percent: 12,
        iowait: 0,
        steal: 0,
      })),
    },
    memory: {
      total: (internal ? 2016 : 2) * GiB,
      percent: 25,
      available: GiB,
      free: GiB,
      in_use: GiB,
      cached: 0,
      buffers: 0,
    },
    swap: {
      total: GiB,
      free: GiB,
      used: 0,
      percent: 0,
      in_rate: 0,
      out_rate: 0,
    },
    filesystems: [
      {
        mount: "/",
        device: "/dev/test",
        filesystem: "ext4",
        kind: "local",
        total: 100 * GiB,
        free: 50 * GiB,
        used: 50 * GiB,
        percent: 50,
        inode_percent: 1,
      },
      { mount: "/remote", kind: "remote", note: "远程挂载不探测容量" },
    ],
    disk_io: [],
    network: [],
    temperatures: {},
    pressure: {},
    files: null,
    tcp: null,
    processes: {
      total: 1,
      visible: 1,
      states: { running: 1 },
      top: [
        {
          pid: 123,
          name: "test-worker",
          state: "running",
          cpu_percent: 1,
          rss: GiB,
        },
      ],
    },
    services: [
      {
        Id: internal ? "docker.service" : "nginx.service",
        ActiveState: "active",
        SubState: "running",
        UnitFileState: "enabled",
      },
    ],
    certificate: internal
      ? null
      : { valid: true, days_left: 60, expires_at: now + 60 * 86400 },
    backup: internal ? null : { updated_at: now, bytes: 100, copies: 2 },
    gpu: internal
      ? {
          available: true,
          expected_count: 8,
          devices: Array.from({ length: 8 }, (_, index) => ({
            index,
            uuid: `GPU-test-${index}`,
            name: "NVIDIA A100-SXM4-80GB",
            pci_bus: `${index}:00:00`,
            driver: "550.163.01",
            utilization_percent: index * 10,
            memory_activity_percent: 0,
            memory_total: 80 * GiB,
            memory_used: GiB,
            memory_free: 79 * GiB,
            temperature_c: 40,
            power_w: 60,
            power_limit_w: 400,
            fan_percent: null,
            performance_state: "P0",
          })),
          processes: [
            {
              gpu_uuid: "GPU-test-0",
              pid: 123,
              name: "python",
              memory_used: GiB,
            },
          ],
        }
      : null,
  };
}
