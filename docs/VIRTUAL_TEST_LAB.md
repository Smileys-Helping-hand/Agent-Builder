# Virtual Test Lab

Real virtual machines, in the app under **Lab**, for you and for the agents to
test what gets built. Nothing here is simulated: a VM is QEMU running a real
kernel and userland.

## How it runs on this PC

- **Backend:** QEMU inside WSL2 (`qemu-system-x86`, `qemu-utils`).
- **Speed:** WSL on this PC exposes `/dev/kvm` but not the CPU's virtualization
  flags (Windows 10 has no nested virtualization for AMD in WSL2), so the CPU is
  emulated (TCG). Real, but slow: a small Linux boots in about 4 minutes, a desktop
  in longer. The lab says which mode it is in.
- **To go faster:** run it on Windows 11 (WSL2 nested virtualization), or on a Linux
  host with KVM; the lab uses KVM automatically when the CPU flags are there.
- **Lifetime:** QEMU runs daemonized, so VMs survive the builder restarting; on start
  it finds them again by their pid files.
- **Setup (already done here):**
  `wsl -e apt-get install qemu-system-x86 qemu-utils xorriso grub-pc-bin grub-common mtools nasm debootstrap squashfs-tools`

## Using it

**Lab** → name a VM, choose an ISO, CPUs, memory, disk and network → **Create VM** →
**Start** → **Open console**: its live screen (keyboard, mouse, full screen,
Ctrl+Alt+Del, screenshots) and its serial terminal.

- **Snapshots:** live (memory and disk) while running, disk only while stopped.
- **ISOs:** from `data/vmlab/isos` (download by https address with a SHA-256), a
  build, or a project. Nothing outside those folders is accepted.
- **Limits:** 3 VMs running, 8 GB of memory, 4 CPUs each, 64 GB disks
  (`VMLAB_MAX_RUNNING`, `VMLAB_MAX_MEMORY_MB`, `VMLAB_MAX_CPUS`, `VMLAB_MAX_DISK_GB`).
- **Emergency stop** on the page, or `lab.stopAll` through Jarvis.

## Tests

**Run tests on it** runs profiles with no one at the keyboard: boot, login, terminal,
memory, CPU, storage, services, networking, packages, graphics and desktop, audio,
security, performance, stability, restart. Add your own: `POST /api/lab/profiles`.

Each step keeps what was expected, what happened, pass or fail, its output and
timing; screenshots and the serial log are kept with the run in
`data/vmlab/runs/<id>/`, and the run is in the evidence ledger, linked to its VM and
what it was run for. Leave feedback on a run and it is linked to it.

Steps talk to the guest through its **serial console**, so a system must offer one
(`console=ttyS0` on the kernel line) for command tests. The screen tests work from
screenshots and keyboard and mouse events through QEMU; they measure whether the
screen shows something, not what it means. There is no vision model judging a desktop.

From the command line:
`npx tsx scripts/vmlab-test-iso.ts <iso> --user nexus --password nexus --name NexusOS`

## Making a build pass it

A continuous-builder session can require its OS to boot and pass:

```
POST /api/agent/continuous/<session>/configure
{ "vmTest": { "buildCommand": "wsl.exe -e bash os/image/build-iso.sh",
              "iso": "os/image/out/nexusos.iso", "paths": ["os/image"],
              "profiles": ["boot","login","basics","services","network","packages","graphics","security"],
              "login": { "user": "nexus", "password": "nexus" } } }
```

After the other checks pass, the ISO is built, booted in a disposable VM and tested;
a failed step comes back as a failing check with its evidence, for the next step to
fix. While the listed folders have not changed, the last result stands.

## Isolation

- QEMU runs inside WSL, not on Windows. No host folder is shared into a guest.
- **Networking:** `isolated` (the default: user-mode NAT with `restrict=on`, no way
  out), `internet` (outbound only; the guest's view of its host is WSL's loopback, not
  Windows', so services on this PC stay out of reach), or `none`.
- Every QEMU listener binds to 127.0.0.1. The app reaches the screen and terminal
  through the builder's sockets with a token signed for that one VM, valid 12 hours.
- QEMU runs as root inside WSL. A guest escaping QEMU would be root in WSL, which can
  read Windows drives under `/mnt`. That is the boundary to keep in mind for
  untrusted images.
- Running time is capped (8 h by default); disposable VMs are deleted after their run
  and swept if left over. Everything is in the audit trail (`vm-event` in the ledger).

Tests: `npm run test:vmlab` (boots Alpine for real, about 10 minutes).
