# prowosma-ops

One command pulls the latest code from GitHub, builds backend and frontend, deploys, restarts and
health-checks them — and rolls back by itself if the backend does not come up.

```
push to GitHub ──► timer (every 2 min) ──► prowosma-ops auto
                                           ├─ backup MongoDB (backup-db.sh)
                                           ├─ build backend jar → restart service → health check
                                           └─ build frontend → switch web root → reload nginx
```

Nothing is overwritten: every build goes into its own release folder and the live path is a symlink,
so rollback is instant. Your existing `/opt/prowosma` files are not touched except the two live paths
(jar and web root), and only if you set `ADOPT_EXISTING=true` — they are moved to a `legacy` release, never deleted.

## Install (once, as root, on the VPS)

```bash
unzip prowosma-ops.zip && cd prowosma-ops
./install.sh
nano /opt/prowosma-ops/prowosma-ops.conf     # repos, token, paths
nano /opt/prowosma-ops/frontend.env          # current production VITE_* values
prowosma-ops discover                        # shows how the server is set up (no secrets)
prowosma-ops check                           # must pass
prowosma-ops deploy --dry-run                # shows what would be deployed
prowosma-ops deploy                          # first real deploy (backs up the DB first)
systemctl enable --now prowosma-ops-auto.timer   # automatic from now on
```

Build tools needed on the server: `git`, JDK (same major version as the project), `node` + `npm`.
On a small VPS (< 2 GB RAM) add swap first, or Gradle/Vite builds can be killed:
`fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`

## Daily use

| Command | What it does |
|---|---|
| `prowosma-ops status` | live commit vs GitHub commit, service state, health |
| `prowosma-ops deploy` | deploy now (backend then frontend), only what changed |
| `prowosma-ops deploy backend --force` | rebuild and redeploy even if unchanged |
| `prowosma-ops deploy --ref v1.4.0` | deploy a tag / branch / commit |
| `prowosma-ops rollback [backend\|frontend]` | go back one release; auto-deploy skips the bad commit |
| `prowosma-ops pause` / `resume` | stop / allow automatic deploys (e.g. during maintenance) |
| `prowosma-ops logs backend` | follow the backend log (`nginx`, `ops` also work) |

Logs of every deploy: `/opt/prowosma-ops/data/logs/ops.log`; the timer's output is in `journalctl -u prowosma-ops-auto`.

## Safety built in

- Database backup before every backend deploy (aborts if it fails, unless `BACKUP_REQUIRED=false`).
- Health check after restart; on failure the previous jar is restored automatically and that commit is skipped until a newer one is pushed.
- Only one deploy runs at a time (lock). `ENCRYPTION_KEY`, `JWT_SECRET` and other backend settings live in your existing environment file and are never touched.
- The GitHub token is stored only in the root-only config file, and is passed to git through the environment, not the command line.
- Deploys from a branch deploy whatever is on it — protect `main` on GitHub (pull-request review) so only reviewed code reaches production.

## Docker instead of systemd

Set `RUNTIME="docker"`. The tool builds `prowosma-backend:<sha>` / `prowosma-frontend:<sha>`, tags them `:latest`,
and recreates the compose services. Your compose file must reference `image: prowosma-backend:latest` (and the frontend equivalent).
Rollback in docker mode goes back one version (`:previous`).

## Instant deploys instead of the 2-minute timer (optional)

Add a GitHub Actions job that SSHes in and runs `prowosma-ops auto` after each push to `main`. The timer can stay as a safety net.
