# Starts a free public https url for the stack running on this machine.
#
#   powershell -ExecutionPolicy Bypass -File scripts\start-tunnel.ps1
#
# No account and no card: this is a Cloudflare "quick tunnel". The url changes every
# time it is started and stops working when the computer sleeps or the tunnel stops.
#
# What it does:
#   1. points caddy at "any host on port 80" (no https redirect to unknown host names)
#   2. starts the cloudflared container and reads the public url it prints
#   3. bakes that url into the frontend (NEXT_PUBLIC_*) and rebuilds it
#   4. checks the public url end to end

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$composeFiles = @("-f", "docker-compose.yml", "-f", "docker-compose.tunnel.yml")

function Read-Env {
    if (-not (Test-Path ".env")) { throw ".env is missing - copy .env.example to .env first" }
    $map = [ordered]@{}
    foreach ($line in [System.IO.File]::ReadAllLines((Resolve-Path ".env"))) {
        if ($line -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { $map[$matches[1]] = $matches[2] }
    }
    return $map
}

function Write-Env($map) {
    $lines = foreach ($key in $map.Keys) { "$key=$($map[$key])" }
    [System.IO.File]::WriteAllText((Join-Path $root ".env"), (($lines -join "`n") + "`n"))
}

Write-Host "== 1/4 caddy: answer any host name on port 80"
$envMap = Read-Env
$envMap["DOMAIN"] = ":80"
Write-Env $envMap
docker compose up -d --force-recreate caddy | Out-Null
if ($LASTEXITCODE -ne 0) { throw "could not start caddy" }

Write-Host "== 2/4 starting the tunnel"
docker compose @composeFiles up -d --force-recreate tunnel | Out-Null
if ($LASTEXITCODE -ne 0) { throw "could not start the tunnel" }

$url = $null
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Seconds 2
    $log = (docker compose @composeFiles logs --no-color tunnel 2>&1 | Out-String)
    $match = [regex]::Match($log, "https://[a-z0-9-]+\.trycloudflare\.com")
    if ($match.Success) { $url = $match.Value; break }
}
if (-not $url) {
    Write-Host "the tunnel did not print a url. logs:"
    docker compose @composeFiles logs --no-color tunnel
    throw "no public url"
}
Write-Host "   public url: $url"

Write-Host "== 3/4 baking the url into the frontend (1-2 minutes)"
$envMap = Read-Env
$envMap["NEXT_PUBLIC_BACKEND_URL"] = $url
$envMap["NEXT_PUBLIC_HOOKS_URL"] = $url
Write-Env $envMap
docker compose build frontend | Out-Null
if ($LASTEXITCODE -ne 0) { throw "frontend build failed" }
docker compose up -d frontend | Out-Null

Write-Host "== 4/4 checking it from the internet"
Start-Sleep -Seconds 8
$health = (curl.exe -s -o NUL -w "%{http_code}" "$url/health")
$page = (curl.exe -s -o NUL -w "%{http_code}" "$url/")
$api = (curl.exe -s -o NUL -w "%{http_code}" "$url/api/v1/user")

Write-Host ""
Write-Host "   $url/              -> $page  (expect 200, the app)"
Write-Host "   $url/health        -> $health  (expect 200)"
Write-Host "   $url/api/v1/user   -> $api  (expect 403, auth is on)"
Write-Host ""
Write-Host "open: $url"
Write-Host ""
Write-Host "the tunnel keeps running until you stop it:"
Write-Host "  docker compose $($composeFiles -join ' ') stop tunnel"
Write-Host "the url stops working then, and a new one is created next time you run this script."
