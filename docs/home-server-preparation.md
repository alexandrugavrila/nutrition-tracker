# Home server deployment preparation

Status (2026-10-18): VM 102 is installed and reachable as
`alex@192.168.1.24`, DNS `nutrition.internal`. Docker 29.9.1 and Compose 5.6.0
are installed; Docker and SSH are running. Application deployment has not begun.
HTTPS is deferred by the owner to a separate homelab project.

## Verified guest and recovery destination

- Proxmox guest: nutrition, 2 vCPU, 4096 MiB RAM, 40 GiB disk on local-lvm,
  vmbr0; MAC BC:24:11:C6:AD:07. Creation had onboot=0; enable boot startup only
  after deployment validation. Existing HAOS/UniFi VMs remain untouched.
- Debian 13 installed; /etc/os-release reports 13.7 after installation updates.
  Installer SHA-256 matched Debian's HTTPS-served published SHA256SUMS:
  `65273beed27b2df543b68b65630ba525cfbad8df2b12035732b2dff87d6664e7`.
- SSH ED25519 fingerprint verified against the guest console:
  `SHA256:7lxOmjFXBUGDW/ZVlWNLS58JgVh+P6kOME04sEA18Gs`.
  Existing laptop key authenticates alex; SSH offers publickey only. Root,
  password and keyboard-interactive login disabled. Sudo still requires the
  owner's password; no Docker-group or passwordless-sudo access was granted.
- QEMU guest agent active. Guest has approximately 34 GiB available disk space.
- /opt/nutrition: alex:alex, 0750. Its backups and release-evidence directories:
  alex:alex, 0700. No application database exists on the guest yet.
- Owner selected laptop backup destination:
  `C:/Workspace/projects/apps/nutrition-tracker/_server-backups/nutrition`.
  Folder created outside Git worktrees; manual transfer/checksum/restore procedure
  documented there. Scheduled NAS backups are future work, not active protection.
- DNS from laptop resolves nutrition.internal to 192.168.1.24. Restricted VLAN
  and Tailscale access policy remain unvalidated. No application ports opened yet.

The inventory below retains earlier planning observations for traceability;
this verified section supersedes earlier unknown/allocation statuses.

## Proposed topology

Use a dedicated QEMU Linux VM under the existing Proxmox host. Install Docker
Engine/Compose inside that guest, not on the hypervisor. Starting sizing proposal:
2 vCPU, 4 GiB RAM, 40 GiB disk, subject to the host inventory and backup capacity.
Reserve a guest LAN address and a DNS name such as `nutrition.internal`; the
application name must point at the guest, not the Proxmox management host.

The owner deferred Caddy/HTTPS to a separate homelab project on 2026-10-18.
Use private HTTP for this installation; HTTPS gates remain explicitly deferred.
The retained Caddy example is future reference, not a deployment dependency.

After verifying/reserving the guest address, configure `.env.production`:

```dotenv
ENVIRONMENT=production
PROD_HTTP_BIND_ADDRESS=192.168.1.24
PROD_HTTP_PORT=80
CORS_ALLOW_ORIGINS=http://nutrition.internal
SESSION_SECURE_COOKIE=false
ALLOW_INSECURE_HTTP=true
DB_AUTO_CREATE=false
```

The address above is a proposal, not allocated. Bind only the verified guest IPv4
address. HTTP exposes credentials/session traffic without encryption. Keep origin
checks and HttpOnly/SameSite cookies; do not switch to development mode. Publish
only the edge port; database/backend ports remain internal. OPNsense inter-VLAN
rules must deny Guest/IoT/Quarantine access. Same-subnet traffic does not traverse
the router, so validate guest/Proxmox filtering as well. Existing Tailscale routes
may permit access; inspect those policies before claiming LAN-only reachability.
No WAN forwarding is part of this deployment.

For the later HTTPS project, restore `SESSION_SECURE_COOKIE=true`,
`ALLOW_INSECURE_HTTP=false`, an HTTPS origin, and loopback edge binding behind the
TLS proxy. Test trusted-client login and forwarding before reopening access.

See [VM provisioning steps](home-vm-provisioning.md) for the next console actions.

## Inventory and access needed

User-provided console inventory on 2026-10-17 confirms:

| Item | Observed |
|---|---|
| Proxmox | pve-manager 9.1.9; running kernel 7.0.2-2-pve |
| Architecture | x86_64 (use linux/amd64 application images) |
| Memory | 15 GiB total, 12 GiB currently available; 8 GiB unused swap |
| Root filesystem | 94 GiB total, 78 GiB available |
| local storage | Directory, active, approximately 77.5 GiB available |
| local-lvm | LVM thin pool, active, approximately 307.4 GiB available |
| VM 100 | haos, running, 4096 MiB RAM, 32 GiB boot disk |
| VM 101 | unifi, stopped, 4096 MiB RAM, 20 GiB boot disk |

The proposed 4 GiB app VM fits the observed memory and storage. Budget for the
stopped UniFi guest as well: HAOS + UniFi + nutrition would total 12 GiB of
configured guest RAM, leaving roughly 3 GiB of the reported memory for the host
and other use. Current free RAM is not a reservation. The follow-up inventory lists no containers and reports six logical CPUs.
Do not change either existing VM.

Proposed app allocation: name `nutrition`, 2 vCPU, 4096 MiB RAM, 40 GiB virtual
disk on `local-lvm`. Proxmox currently suggests VM ID 102; recheck before creating it. Use bridge
`vmbr0` on the existing LAN, with a separate guest address. The root
filesystem's free space is separate from thin-pool capacity; keep headroom in
both and choose an off-host backup destination before real data is deployed.

Follow-up console inventory on 2026-10-17:

| Item | Observed / selected proposal |
|---|---|
| Containers | No entries returned by `pct list` |
| Logical CPUs | 6 |
| Suggested next VM ID | 102; not yet allocated |
| LAN bridge | vmbr0 |
| Proxmox host address | 192.168.1.20/24; must not be reused for the guest |
| Default gateway | 192.168.1.1 |
| Available installation media | local:iso/debian-13.6.0-amd64-netinst.iso |

The ISO filename is user-reported inventory, not verification of its origin or
checksum. Verify the installation media before use. The architecture matches
the host and the application's linux/amd64 image target.

The homelab canonical documentation (2026-10-18) confirms OPNsense owns DNS/DHCP,
UniFi VM 101 is operational (superseding the older stopped observation), and
Tailscale split DNS exists. Source: `C:/Workspace/projects/infrastructure/homelab/documentation/network.md`.

Pending: verify current DHCP ranges and address availability,
reserve a distinct guest address and create `nutrition.internal` pointing to it.
Do not infer that an address is available merely because it does not answer a
ping. Backup destination and authenticated administrative access to the future
guest also remain pending. No VM or network settings have been changed.

After reviewing the results, select the guest OS/template, VM ID, storage,
network bridge and reserved address. Configure an ordinary administrative guest
user with SSH-key access (password remains with the user). Record the host-key
fingerprint through the Proxmox console before the first SSH connection.
Creating the guest and installing services is a separate concrete provisioning
step; no resource allocation has yet been made.

The November 2025 dump is a candidate source for the first server installation.
Confirm it is the intended latest dataset before loading it. Preserve the dump
and use the already-reviewed disposable repair/rehearsal procedure; actual
production repair still requires review. Reuse the staged account cutover rather
than bypassing adoption just because the server VM is new.

## Release enforcement finding

Read-only GitHub API inspection on 2026-10-17 found the repository's canonical
name is `alexandrugavrila/nutrition-tracker`. Both `main` and `development` report
`protected: false`, required status enforcement `off`, and no required contexts.
The sole repository ruleset (`default`, ID 16802547) is disabled and contains only
branch-deletion/non-fast-forward rules. It does not enforce the six release checks.

The updated `.github/BRANCH_PROTECTION.md` is the desired contract. A repository
administrator must configure it and verify the actual named checks before merging.
The available GitHub connector supports reading these settings, not changing them.
No GitHub setting was changed during this inspection.

## References

- [Proxmox Linux containers guide: Docker in a QEMU VM](https://pve.proxmox.com/wiki/Linux_Container)
- [Caddy local HTTPS and client trust](https://caddyserver.com/docs/automatic-https)
- [Caddy tls internal directive](https://caddyserver.com/docs/caddyfile/directives/tls)
- [Release cutover runbook](release-cutover.md)

## Preparation validation (2026-10-17)

- Focused configuration/release tests: 36 passed, including digest-only pull
  behavior, paired arguments and rejection of mutable tags.
- Migrated PostgreSQL suite: 238 passed; authenticated API: 3 passed.
- Frontend: 77 tests passed; all 9 browser workflows passed. Evidence is in
  the local `wrapup-e2e.log` and `wrapup-frontend.log` files.
- Caddy accepted the proposed example with `caddy validate` in a disposable
  container. This validates syntax, not DNS, client trust or actual server ingress.
- The attempted end-to-end private-registry digest rehearsal was blocked by
  Docker Desktop daemon access to the temporary loopback registry (IPv6 timeout,
  then IPv4 connection refusal). Both temporary registries were removed; no
  daemon settings were changed. Published-digest end-to-end validation remains
  pending until release images are available from a reachable registry.
- The original dirty feature worktree's six file checksums remain unchanged.
- No application schema/API changes were made. Isolated runners were used instead
  of branch database synchronization wrappers to avoid application database access.

## Private HTTP preparation validation (2026-10-18)

- 14 focused transport/Compose/maintenance checks passed. Production defaults
  still reject insecure cookies without explicit opt-in; private HTTP requires
  concrete HTTP origins. Compose forwards both flags and the selected bind IP.
- Migration-created disposable PostgreSQL suite: 244 passed, 3 E2E deselected.
- Authenticated API: 3 passed; Chromium browser: 9 passed; frontend units: 77 passed.
- Logs: `wrapup-http-e2e.log`, `wrapup-http-frontend.log` (local ignored evidence).
- Existing browser runner uses the test environment; production transport settings
  were verified separately. Exact published-image HTTP/server validation is still
  pending and these results do not establish network/firewall isolation.
- Disposable database container/volume/network cleaned up. Original feature
  worktree's six recorded checksums unchanged. No application database accessed.
- Repository audit still reports the pre-existing unrelated migration-drift
  worktree naming mismatch. No attempt was made to rename or remove that worktree.
- VM, DNS and SSH instructions are prepared only; server provisioning awaits
  refreshed allocation information and console/key-based access.
