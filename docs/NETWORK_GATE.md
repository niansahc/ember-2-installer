# Fresh-install network capture gate

Runs the shipped Windows installer end to end on a clean Windows 11 VirtualBox guest, records every outbound network destination, and fails if anything contacted is missing from the declared download list, [`network-destinations.json`](network-destinations.json).

## What it proves, and what it does not

**What it proves:** on one clean Windows 11 guest, with default choices, every DNS name the guest looked up and every connection it opened is accounted for. That includes child processes and any tools the installer drives (winget and the installers it runs, git, pip, npm, the Ollama server).

**What it does not prove:**
- **Docker.** The guest has no real Docker (see below), so the Docker Desktop download and the image pull for `docker-compose.yml` are not captured. They are listed as **declared but not captured**, and the gate checks that every registry host for every compose image is declared.
- **Untaken paths.** Tailscale, vision models, update flows and electron-updater are not exercised in the default run.
- **Mac and Linux.** Not covered.
- **Data in transit.** The gate records names and IPs only. It does not inspect what was sent; TLS hides it.

## How it captures

| Layer | Tool | Why |
|---|---|---|
| Every frame on the guest's NIC | VirtualBox NIC trace (`VBoxManage modifyvm --nictrace1`) | Recorded by the hypervisor, outside the guest. Nothing in the guest can bypass or alter it: not a child process, a service, the Ollama server or Delivery Optimization. Survives guest reboots and installs nothing in the guest. Loopback traffic (local API, API key) never reaches the NIC. |
| DNS name ↔ IP, TLS SNI | tshark (Wireshark) on the host | Reassembles the multi-segment TLS ClientHellos that Chromium and Electron send (post-quantum key share), and decodes QUIC Initial SNI. |
| Which process asked | Sysmon in the guest: EID 1 (process create), EID 3 (network connect), EID 22 (DNS query) | Separates Windows background traffic from installer traffic, and ties each name to a process image. |

Alternatives that were rejected:
- **pktmon / netsh trace:** no DNS-to-process mapping, ETL conversion, gaps across reboots.
- **An HTTP proxy:** only proxy-aware clients use it, and it changes their behaviour.
- **Firewall logging:** IPs only.

## SearXNG on the host, Docker shim in the guest

Docker Desktop inside a VirtualBox guest needs nested WSL2, which has been unreliable. Instead:

- **On the host,** SearXNG runs from the ember-2 checkout (`docker compose up -d`) on `127.0.0.1:8888`. VirtualBox NAT exposes host loopback to the guest as `10.0.2.2`.
- **In the guest,** `netsh interface portproxy` forwards `127.0.0.1:8888` to `10.0.2.2:8888`. The backend's hardcoded `SEARXNG_BASE_URL` (`ember-2/src/core/config.py`) therefore reaches the host unchanged.
- **Also in the guest,** `scripts/netgate/guest/docker.cmd` sits on the machine PATH. The installer's `run()` uses `shell:true`, so `docker` resolves to it. It answers `--version`, `info`, `compose up -d` and `compose ps --status running -q` from a probe of `http://127.0.0.1:8888`, and fails on anything else.
- **The installer binary and its defaults are unchanged.** Real users never see the shim or the proxy. The binary under test is the release build.

The only NAT-subnet destinations the guest may reach are listed in `scripts/netgate/harness.json`: SearXNG, NAT DNS and NAT DHCP. Any other `10.0.2.x` flow fails the gate, for example the guest touching a host service on port 8000.

## Pass / fail

`npm run netgate:analyze -- <runDir>` exits with 0 for pass, 1 for fail, 2 for an invalid capture. It writes `gate-report.md` and `gate-result.json` into the run directory.

**FAIL** when any of these happens:
- **`undeclared`:** a name was looked up by DNS, seen as TLS SNI or an HTTP Host header, or logged by Sysmon, and it is not declared, not in `os-noise.json`, and not a reverse lookup or single-label name.
- **`os-noise-from-installer`:** a name that only `os-noise.json` covers was queried, or connected to, by the installer set. The installer set is the Sysmon descendants of `Ember Setup*`, plus the tool images listed in `harness.json`.
- **`direct-ip`:** a public-IP connection that no DNS answer or SNI names.
- **`unexpected-local-flow`:** a flow to a NAT-subnet address or port that is not a harness service.
- **`compose-registry-undeclared`:** a registry host for an image in the installed `docker-compose.yml` is not declared.

**INVALID** means the capture cannot be trusted, and it outranks fail. It happens when:
- the pcap has no DNS traffic,
- the Sysmon log is empty,
- `docker-compose.yml` was not collected, or
- a host marked `gateRun: required` (github.com, pypi.org, registry.npmjs.org, registry.ollama.ai) was never observed, which means the install did not complete.

**Informational:** declared hosts that could be exercised but were not observed, and declared-but-not-captured hosts.

When a gate run fails, decide each failing name in a reviewed commit:
- if it is a legitimate destination, declare it in `network-destinations.json` (with its source), or
- if it should not happen, fix the installer.

Never add a name to `os-noise.json` to make a failing gate pass.

## Privacy

- **The guest is throwaway.** It gets a fresh default vault (`C:\EmberVault`) and a key generated inside it. No real vault content and no host `.env` values enter it.
- **Shares:**
  - The guest sees only two shared folders: `C:\netgate\share` (read-only: installer exe, guest scripts, Sysmon) and `C:\netgate\out` (writable, collection only).
  - Never share `C:\dev\Ember-2`, a vault, or a home directory.
  - Shared clipboard and drag-and-drop are off.
- **What leaves the guest:** `collect.ps1` copies out only the Sysmon log and the installed `docker-compose.yml`.
- **Where the raw captures live:** the pcap and Sysmon log stay in `C:\netgate\captures\<runId>`, outside the repo.
- **What the reports carry:** hostnames, IPs, ports, process image basenames and counts, never command lines or paths.
- **Do not screenshot or record the install log in the guest.** The `apikey` step prints the generated key there.

## One-off setup

These need admin rights or a GUI on the host, so Chas does them.

1. **Install VirtualBox** 7.x and its Extension Pack. If the VM later shows the green turtle icon (running through Hyper-V and slow), turn off Core isolation › Memory integrity and the Virtual Machine Platform feature, then reboot. This step is optional; it only affects speed.
2. **Install Wireshark** with **TShark** ticked. Npcap is not needed, because the gate only reads files.
3. **Download Sysmon** (Sysinternals) and put `Sysmon64.exe` in `C:\netgate\share\tools\`. Copy `scripts\netgate\guest\` to `C:\netgate\share\guest\`. Create `C:\netgate\out` and `C:\netgate\captures`.
4. **Download a Windows 11 ISO.** The Enterprise Evaluation is preferred: it has a local account and less consumer noise. The consumer ISO also works.
5. **Create the VM** `ember-netgate`:
   - type Windows 11 (64-bit), EFI, TPM 2.0, Secure Boot;
   - 8 GB RAM, 4 vCPU, a 100 GB dynamic disk;
   - adapter 1 on NAT;
   - unattended install with a throwaway local user and password;
   - Settings › General › Advanced: shared clipboard **Disabled**, drag-and-drop **Disabled**.
6. **Install Guest Additions** (Devices › Insert Guest Additions CD) in the guest, then reboot it.
7. **Add the shared folders:**
   - `share` → `C:\netgate\share`, read-only, auto-mount;
   - `out` → `C:\netgate\out`, writable, auto-mount.
8. **Prepare Windows in the guest:**
   - Run Windows Update until nothing is left, then pause updates for the longest period offered.
   - In a terminal, check `winget --version`. If it is missing, update App Installer from the Microsoft Store.
9. **Start SearXNG on the host:** start Docker Desktop, then run `docker compose up -d` in `C:\dev\Ember-2\ember-2`. Check that `http://127.0.0.1:8888` answers.
10. **Run the prepare script in the guest:** open an admin PowerShell and run `\\VBoxSvr\share\guest\prepare.ps1`. It must print `Sysmon OK`, `docker shim OK`, `SearXNG OK`, `winget OK` and `clean OK`.
11. **Take the snapshot:** shut the guest down and take snapshot `netgate-clean`.

Before each later run, step 9 must be true: SearXNG answering on the host.

## Run procedure

Re-runnable. Every run starts from `netgate-clean`.

1. **Build** the installer from the commit under test with `npm run build:win`, and copy `Ember Setup Setup <ver>.exe` from `C:\temp\ember-dist` into `C:\netgate\share\`. Never run it on the host.
2. **Start** the run: `powershell -File scripts\netgate\run-capture.ps1 -Phase start`. This restores the snapshot, starts the trace into `C:\netgate\captures\<runId>\guest.pcap`, and boots the VM.
3. **Install in the guest:** run the installer exe from `\\VBoxSvr\share`.
   - Let Prerequisites auto-install whatever is missing. Docker shows as installed (shim).
   - Keep the defaults, with these choices: model **qwen3:4b** (the same registry hosts as the default 8b, with a smaller pull), vision **off**, host **local only**.
   - Continue to Done, until the API reports healthy.
   - Do not click the in-app GitHub links.
4. **Collect in the guest:** open an admin PowerShell and run `\\VBoxSvr\share\guest\collect.ps1`.
5. **Stop** the run: `powershell -File scripts\netgate\run-capture.ps1 -Phase stop`. This powers off the VM, stops the trace, and copies `sysmon.evtx` and `docker-compose.yml` into the run directory.
6. **Analyze:** `npm run netgate:analyze -- C:\netgate\captures\<runId>`.

### Baseline run (to review os-noise)

Use `-Phase start -Baseline`. Boot the guest, leave it idle for about as long as an install takes, then run `collect.ps1` and stop the run. Analyze with `--baseline`. It never fails; it lists every observed name with its processes. Changes to `os-noise.json` go in as their own reviewed commit.

## Files

| Path | Role |
|---|---|
| `docs/network-destinations.json` | Declared download list. The source of truth. |
| `scripts/netgate/compare.cjs` | Classification and report (pure). |
| `scripts/netgate/extract.cjs` | tshark and wevtutil extraction. |
| `scripts/netgate/cli.cjs` | `netgate:analyze` entry point. |
| `scripts/netgate/harness.json` | NAT harness flows and installer-set rules. |
| `scripts/netgate/os-noise.json` | Windows background names (seed list; review with a baseline run). |
| `scripts/netgate/run-capture.ps1` | Host: snapshot restore, trace on and off, VM start and stop. |
| `scripts/netgate/guest/` | `prepare.ps1` (one-off), `collect.ps1` (per run), `docker.cmd` shim, `sysmon-netgate.xml`. |
| `tests/netgate/` | `npm run test:netgate`: gate logic with positive controls, plus a drift test that every host literal and winget id in `src/` is declared. |
