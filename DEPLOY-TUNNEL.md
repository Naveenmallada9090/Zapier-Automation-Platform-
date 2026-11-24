# Free public URL, no account and no card (Cloudflare Tunnel)

If Oracle/Render need a card you don't have, this is the zero-cost way to get a real
`https://` address for the app. The stack keeps running on this computer in Docker; Cloudflare
just forwards a public hostname to it.

**Trade-offs:** the computer must be on, and the address changes every time the tunnel starts.
A permanent address needs any domain (~₹100/year) plus a free Cloudflare account.

## Start it

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start-tunnel.ps1
```

It takes about 2 minutes and prints something like:

```
   public url: https://quiet-river-1234.trycloudflare.com
   https://quiet-river-1234.trycloudflare.com/            -> 200
   https://quiet-river-1234.trycloudflare.com/health      -> 200
   https://quiet-river-1234.trycloudflare.com/api/v1/user -> 403
```

Open that url. Anyone with the link can use the app, from any network.

## What it changes

| File | Change |
|---|---|
| `.env` | `DOMAIN=:80` so Caddy answers any host name on port 80 |
| `.env` | `NEXT_PUBLIC_BACKEND_URL` / `NEXT_PUBLIC_HOOKS_URL` = the public url |
| frontend image | rebuilt, because those values are compiled in at build time |

Nothing is committed: `.env` is gitignored.

## Stop it

```powershell
docker compose -f docker-compose.yml -f docker-compose.tunnel.yml stop tunnel
```

The url dies immediately. Run the script again for a new one (it rebuilds the frontend, ~1 min
with the build cache).

## Back to plain local use

```powershell
# in .env
DOMAIN=
PUBLIC_URL=http://localhost
NEXT_PUBLIC_BACKEND_URL=http://localhost:3000
NEXT_PUBLIC_HOOKS_URL=http://localhost:3002

docker compose build frontend
docker compose up -d
```

Then use `http://localhost:3001` directly again.

## Doing it by hand / on linux

```bash
# 1. caddy must answer any host name
sed -i 's|^DOMAIN=.*|DOMAIN=:80|' .env
docker compose up -d --force-recreate caddy

# 2. start the tunnel and copy the url it prints
docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d tunnel
docker compose -f docker-compose.yml -f docker-compose.tunnel.yml logs tunnel | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | head -1

# 3. put that url in .env for both NEXT_PUBLIC_* values, then
docker compose build frontend && docker compose up -d frontend
```

## Limits of a quick tunnel

- The url is random, changes on every start, and Cloudflare does not guarantee uptime.
- No custom hostname, no access control: whoever has the url gets in. Keep `SOLANA_DRY_RUN=true`.
- It is fine for demos and for yourself. For something permanent, a domain + an `A` record to a
  real server (`DEPLOY-ORACLE.md`) is the correct setup.

## Note on the "orphan container" warning

Plain `docker compose up` / `ps` does not know about the tunnel service, so Compose prints
`Found orphan containers (zapier-tunnel-1)`. Nothing is broken; stop the tunnel with the two-file
command above before going back to local-only mode.
