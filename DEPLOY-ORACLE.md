# Deploying on Oracle Cloud (Always Free)

> **This path needs a Visa/Mastercard for the signup check** (never charged). If you only have a
> RuPay card, use [DEPLOY.md](DEPLOY.md) instead: Vercel + Render + Supabase + GitHub Actions, no
> card, nothing on your PC.

Runs the whole stack — frontend, API, hooks, processor, worker, Postgres, Kafka, Caddy — on one
ARM VM, for **$0/month**. No platform limits: nothing sleeps, nothing expires, no paid workers.

Everything below already exists in this repo (`docker-compose.yml`, `Caddyfile`,
`scripts/setup-oracle.sh`). Nothing else to install or code.

## What you need

- An Oracle Cloud account. A credit/debit card is required for identity verification only —
  Always Free resources are never charged.
- Your SSH public key (`~/.ssh/id_ed25519.pub`) — or let Oracle generate a key pair for you.
- About 30 minutes, most of it waiting for the first build.

---

## 1. Create the VM

Oracle Console → **Compute → Instances → Create instance**

| Field | Value |
|---|---|
| Name | `zapier` |
| Image | **Canonical Ubuntu 24.04** (aarch64) |
| Shape | **Ampere → VM.Standard.A1.Flex** |
| OCPUs | **2** |
| Memory | **12 GB** |
| Boot volume | 50 GB is fine (Always Free allows 200 GB total) |
| Assign public IPv4 | **Yes** |
| SSH keys | paste your public key, or download the generated private key |

Create it and wait for **RUNNING**. Note the **Public IP address**.

Always Free currently gives 2 OCPU / 12 GB of A1 (it used to be 4 / 24 — if the console still
offers that on your account, take it). Either size is plenty: the stack idles at ~2–3 GB.

> **"Out of host capacity"** is common for A1.Flex. Retry in a few hours, try a different
> availability domain, or upgrade the account to *Pay As You Go* (Always Free resources stay free,
> and capacity is easier to get).

## 2. Open ports 80 and 443 in the console

Console → **Networking → Virtual Cloud Networks → your VCN → Security Lists → Default Security
List → Add Ingress Rules**

| Source CIDR | IP Protocol | Destination Port Range |
|---|---|---|
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

(Port 22 is already open. If you use a Network Security Group instead of a security list, add the
same two rules there.)

This alone is **not** enough — Oracle's Ubuntu image also blocks everything except SSH with
`iptables`. The setup script fixes that in step 4.

## 3. Connect

```bash
ssh -i /path/to/private-key ubuntu@<PUBLIC_IP>
```

The user on Oracle's Ubuntu images is `ubuntu`, not `root`.

## 4. Install Docker and open the firewall

```bash
git clone https://github.com/Naveenmallada9090/zapier.git
cd zapier
bash scripts/setup-oracle.sh
```

The script installs Docker + Compose, adds you to the `docker` group, and inserts the 80/443
accept rules into `iptables` (and persists them across reboots).

Then **log out and back in** (or `newgrp docker`) so `docker` works without `sudo`.

## 5. Fill in `.env`

```bash
cp .env.example .env
nano .env
```

### Option A — no domain yet (plain HTTP on the IP)

Works immediately, but browsers show "Not secure" and tokens travel in clear text. Fine for a
quick test, not for real users.

```env
DOMAIN=http://<PUBLIC_IP>
PUBLIC_URL=http://<PUBLIC_IP>
NEXT_PUBLIC_BACKEND_URL=http://<PUBLIC_IP>
NEXT_PUBLIC_HOOKS_URL=http://<PUBLIC_IP>
```

The `http://` prefix matters. With a bare IP (`DOMAIN=<PUBLIC_IP>`) Caddy tries HTTPS with a
self-signed certificate, and every browser refuses to load the app.

### Option B — real domain (recommended, HTTPS for free)

Point an `A` record at the public IP first (`zapier.example.com → <PUBLIC_IP>`), wait a minute,
then:

```env
DOMAIN=zapier.example.com
PUBLIC_URL=https://zapier.example.com
NEXT_PUBLIC_BACKEND_URL=https://zapier.example.com
NEXT_PUBLIC_HOOKS_URL=https://zapier.example.com
```

Caddy fetches and renews a Let's Encrypt certificate on first start. Ports 80 and 443 must be
reachable for that to work.

### Both options — the rest

```env
POSTGRES_PASSWORD=<strong password>
JWT_PASSWORD=<openssl rand -hex 32>
SMTP_ENDPOINT=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USERNAME=<brevo smtp login>
SMTP_PASSWORD=<brevo smtp key>
SMTP_FROM=<verified sender address>
SOL_PRIVATE_KEY=<base58 wallet secret>      # leave empty while dry-running
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_DRY_RUN=true                          # keep true until you mean to move real SOL
```

`NEXT_PUBLIC_*` values are compiled into the frontend at build time — if you change them later,
rebuild the frontend (`docker compose build frontend && docker compose up -d frontend`).

## 6. Start the stack

```bash
docker compose up -d --build
docker compose ps
```

First build takes ~5–10 minutes on 2 ARM cores (all images are multi-arch, so nothing needs
patching). You want all of `caddy, frontend, hooks, primary-backend, processor, worker` up and
`postgres, kafka` healthy. `migrate` runs once and exits with code 0 — that is correct.

## 7. Seed the database (once, on a fresh volume)

```bash
docker compose run --rm primary-backend npx ts-node prisma/seed.ts
```

Creates the `webhook` trigger and the `send-sol` / `email` actions.

## 8. Verify

```bash
curl http://<PUBLIC_IP>/health                      # {"status":"ok"}   (or https://domain/health)
curl -o /dev/null -s -w '%{http_code}\n' http://<PUBLIC_IP>/api/v1/user   # 403 = auth is on
```

Then in a browser:

1. Open the app, sign up with a real email.
2. Open the verification mail (check spam), click the link.
3. Sign in, create a Zap: webhook trigger → send SOL action.
4. `curl -X POST http://<PUBLIC_IP>/hooks/catch/<userId>/<zapId> -H 'content-type: application/json' -d '{"amount":"0.001"}'`
5. `docker compose logs --tail 20 worker` should show `[dry run] would send 0.001 SOL …`.

## Everyday commands

```bash
docker compose logs -f worker          # follow a service
docker compose restart caddy           # reload proxy config
docker compose down                    # stop, keep data
docker compose down -v                 # stop and delete the database
git pull && docker compose up -d --build   # deploy an update
docker compose exec -T postgres pg_dump -U postgres postgres > backup.sql   # backup
```

## How it is wired

```
internet :80/:443
      │
    caddy ── /api/*   → primary-backend:3000
      │    ── /hooks/* → hooks:3002
      │    ── /health  → primary-backend:3000
      │    ── rest     → frontend:3000
      │
  postgres, kafka  →  no host ports at all, containers only
  processor, worker →  no host ports, they poll Kafka
```

Only Caddy is reachable from outside. The debug ports (`3000/3001/3002`) are bound to
`127.0.0.1`, so they work over an SSH tunnel but not from the internet.

## Notes

- **Cost:** Always Free A1 + 200 GB block storage + 10 TB egress/month. No time limit.
- **RAM:** ~2–3 GB used; Kafka's heap is pinned to 512 MB in the compose file.
- **Idle reclamation:** Oracle may reclaim Always Free instances that stay idle for 7 days
  (95th-percentile CPU, network and memory all under 10%). This stack runs Kafka and a worker
  continuously, which usually keeps it out of that band. If you want extra safety, add a cron
  that curls `/health` every few minutes — it helps, though it is not a guarantee.
- **Rate limiting** is in-memory, which is correct for a single backend instance.
- **Keep `SOLANA_DRY_RUN=true`** until the wallet is funded and you actually want tokens to move.
