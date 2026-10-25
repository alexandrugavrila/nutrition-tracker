# Nutrition VM provisioning (prepared, not executed)

HTTPS is deferred by the owner. Current target: `http://nutrition.internal`.
Follow the homelab canonical `documentation/network.md`; archived settings are
not current authority. No changes to existing VM 100/101 are required.

## 1. Refresh inventory in the Proxmox node console

```sh
qm list
pct list
pvesh get /cluster/nextid
pvesm status
pvesm list local --content iso
ip -br addr
free -h
```

Confirm 102 is unused, `local-lvm` has capacity, and `vmbr0` is still Main LAN.
Verify the ISO against Debian's signed checksum manifest before installation;
the previously reported filename alone does not establish authenticity.
Confirm `192.168.1.24` is unassigned in OPNsense reservations, leases, and manual
host inventory. No ping response is not sufficient proof. Confirm current pool.

## 2. Create a stopped VM after those checks

The following assumes the previously reported ISO remains present and verified.
If the VM ID or ISO differs, revise the command before execution. Do not rerun
creation on an existing VM or delete an existing VM to make the ID available.

```sh
qm create 102 --name nutrition --ostype l26 --cores 2 --memory 4096 \
  --scsihw virtio-scsi-single --scsi0 local-lvm:40 \
  --net0 virtio,bridge=vmbr0 \
  --ide2 local:iso/debian-13.6.0-amd64-netinst.iso,media=cdrom \
  --boot 'order=scsi0;ide2' --agent enabled=1 --onboot 0
qm config 102
```

Record the generated `net0` MAC. In OPNsense's current DHCP host/reservation UI:

| Field | Value |
|---|---|
| Host | nutrition |
| Domain | internal |
| IPv4 | 192.168.1.24, only after availability verification |
| Hardware address | Generated VM net0 MAC |
| Description | Nutrition application VM |

Apply the reservation, then start `qm start 102` and use the Proxmox console.
Install Debian with hostname `nutrition`, domain `internal`, DHCP networking,
an ordinary sudo-capable user, SSH server and standard system utilities. No
desktop is needed. Keep passwords local. Install the guest agent and ensure
it runs. After installation, remove/eject installation media in Proxmox and
confirm boot from the disk. Enable startup after successful boot validation.

## 3. Establish key-based SSH

On the Windows client, obtain only the existing public key:

```powershell
Get-Content "$HOME/.ssh/id_ed25519.pub"
```

If missing, generate a key deliberately; never overwrite an existing key.
In the guest console, logged in as the chosen ordinary user:

```sh
mkdir -p ~/.ssh
chmod 700 ~/.ssh
nano ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

Paste the public key into authorized_keys. Record the host fingerprint from the
console, compare it at the first SSH connection, and verify a second session.
Then configure key-only SSH with root/password/keyboard-interactive login
disabled, validate with `sshd -t`, reload SSH and test again while retaining the
console. Never disable the working access path before testing its replacement.

## 4. Handoff and deployment gates

Provide the VM address, ordinary SSH username and confirmed host fingerprint;
no passwords/private keys. Once SSH works, the agent can install Docker/Compose,
configure the HTTP deployment and run the rehearsals. Select an off-host backup
destination before loading real data. Preserve guest and application configuration
alongside database backups, and perform an actual restore drill.

Validate DNS from Main, HTTP login/logout, two-account isolation, origin rejection,
restricted-VLAN policy and Tailscale reachability. The application remains in
production mode with the explicit private HTTP settings in
[home-server-preparation.md](home-server-preparation.md). Published immutable
images, CI, reviewed merge, dataset selection and staged adoption remain required.

Record the VM, reservation, access boundaries and backup procedure in the homelab
inventory only after validation. Do not mark HTTPS gates passed.

Command reference: https://pve.proxmox.com/pve-docs/qm.1.html
