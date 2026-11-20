# Deploying the "AI Meeting Assistant + client feedback" release to the Hostinger VPS

This release is the `feature/universal-meeting-assistant` branch (merged with `design/unslop-pass`).
Production is updated by **prowosma-ops**: its timer deploys whatever is on `main` within about 2 minutes.
So **prepare the server first, then put the code on `main`**. Steps 2–6 change nothing users can see.

Everything below runs **on the VPS as root** (`ssh root@<vps>`), except step 7.

---

## What is new for the server

| Need | Why | Without it |
|---|---|---|
| **ffmpeg** (with ffprobe) | The backend splits long recordings into pieces | Long recordings are sent in one piece and can fail |
| **Speech-to-text service** (new, port 8765, local only) | Turns meeting recordings into text | Recording / uploading audio doesn't work (transcript import, Fireflies, Meet and Teams still do) |
| **New backend settings** | Point to the speech service; desktop notifications | See step 5 |
| **Bigger upload limit in nginx** | Recording pieces and uploaded recordings | Uploads fail with "413 Request Entity Too Large" |

No new database setup: new collections and indexes are created by the backend on start. No existing data is changed.
No new frontend build settings (`frontend.env` stays as it is).

---

## 1. Check the server has room

```bash
free -h; nproc; df -h /
```

- **RAM**: the speech service with the `small` model uses about 1.5 GB while transcribing, next to the backend (up to 1 GB),
  MongoDB and nginx, and the builds prowosma-ops runs during a deploy. **8 GB is comfortable; 4 GB works with swap**
  (and consider `STT_MODEL=base`). Under 4 GB, use a hosted speech service instead (see the end of this page).
- **Disk**: about 2 GB free for the Python packages and the model.
- If there is no swap (`swapon --show` prints nothing) and RAM is 4 GB or less:
  ```bash
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  ```

## 2. Stop automatic deploys while you prepare

```bash
prowosma-ops pause
prowosma-ops status
```

## 3. Install ffmpeg

```bash
apt update && apt install -y ffmpeg
ffmpeg -version | head -1 && ffprobe -version | head -1
```

## 4. Install the speech-to-text service

**a. Python** (needs 3.10, 3.11 or 3.12):
```bash
python3 --version
apt install -y python3-venv          # on Ubuntu 24.04 this may be called python3.12-venv
```

**b. Copy the server files.** From your Windows machine, in the project folder (after pulling the branch):
```powershell
scp tools\stt-server\server.py tools\stt-server\requirements.txt root@<vps>:/tmp/
```
Then on the VPS:
```bash
mkdir -p /opt/prowosma/stt-server/models
mv /tmp/server.py /tmp/requirements.txt /opt/prowosma/stt-server/
```

**c. Python environment and packages** (a few minutes):
```bash
cd /opt/prowosma/stt-server
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt
```

**d. The service.** It runs as the same user as the backend. Check that user's name:
```bash
systemctl show -p User prowosma-backend
```
If it isn't `prowosma`, change `User=` in the file below.
```bash
cp /path/to/prowosma-ops/systemd/prowosma-stt.service.example /etc/systemd/system/prowosma-stt.service
#   (or create it with nano and paste the file's contents)
chown -R prowosma:prowosma /opt/prowosma/stt-server
systemctl daemon-reload
systemctl enable --now prowosma-stt
```

**e. Check it**:
```bash
systemctl status prowosma-stt --no-pager
curl -s http://127.0.0.1:8765/health
#   {"status":"ok","model":"small","device":"cpu","loaded":false,...}
```
`loaded:false` is normal: the model (~500 MB) downloads from huggingface.co on the first transcription and is kept
in `/opt/prowosma/stt-server/models`. To download it now instead of during the first meeting:
```bash
ffmpeg -f lavfi -i "sine=frequency=440:duration=2" -ac 1 -ar 16000 /tmp/beep.wav -y -loglevel error
curl -s -F file=@/tmp/beep.wav -F model=small http://127.0.0.1:8765/v1/audio/transcriptions
curl -s http://127.0.0.1:8765/health      # now "loaded":true
```
(A beep has no words, so an empty text is the right answer.)

The service listens on 127.0.0.1 only, so it is not reachable from the internet and needs no key.

## 5. Add the new backend settings

Find the backend's environment file:
```bash
systemctl cat prowosma-backend | grep EnvironmentFile
```
(usually `/opt/prowosma/backend/.env`). Make a copy, then add the lines:
```bash
cp /opt/prowosma/backend/.env /opt/prowosma/backend/.env.before-release
nano /opt/prowosma/backend/.env
```
```
# AI Meeting Assistant - speech-to-text on this server
UMA_STT_BASE_URL=http://127.0.0.1:8765
UMA_STT_MODEL=small
# UMA_STT_LANGUAGE=en          # optional: force a language instead of detecting it

# Desktop / phone notifications (generate once: npx web-push generate-vapid-keys)
VAPID_PUBLIC_KEY=<public key>
VAPID_PRIVATE_KEY=<private key>
VAPID_SUBJECT=mailto:<an address you read>

# Production: only the real site may call the API (localhost is for development)
APP_CORS_ALLOW_ANY_LOCALHOST=false
```
- Generate the VAPID keys on any computer with Node (`npx web-push generate-vapid-keys`). Keep the private key secret
  and **never change the keys later** (everyone would have to turn notifications on again).
  If production already has `VAPID_...` lines, keep the existing ones.
- Check `ENCRYPTION_KEY` is already set (it is an existing setting). Recording needs it, and **it must never change**:
  ```bash
  grep -c '^ENCRYPTION_KEY=.\+' /opt/prowosma/backend/.env      # must print 1
  ```
- "Keep me signed in" lasts 30 days by default. Change it with `JWT_REMEMBER_EXPIRATION_MS` (milliseconds) if the client wants another value.

Don't restart the backend now; the deploy in step 8 restarts it with these settings.

## 6. Raise the upload limit in nginx

Find the site that sends `/api` to the backend:
```bash
grep -RnE 'proxy_pass|client_max_body_size' /etc/nginx/sites-enabled /etc/nginx/conf.d
```
In that `server { ... }` block (the one with `proxy_pass` to the backend), add or change:
```nginx
    client_max_body_size 520m;     # recording pieces and uploaded recordings (the app's own limit is 500 MB)
    proxy_read_timeout   300s;     # large uploads
    proxy_send_timeout   300s;
```
Then:
```bash
nginx -t && systemctl reload nginx
```

## 7. Put the release on `main` (from your Windows machine)

Either open a pull request on GitHub from `feature/universal-meeting-assistant` to `main` and merge it, or push it directly.
`main` is already contained in the branch, so this is a fast-forward (git refuses otherwise):
```powershell
git fetch origin
git push origin origin/feature/universal-meeting-assistant:main
```
This does not touch your local `main`. Automatic deploys are paused (step 2), so nothing deploys yet.

## 8. Deploy and watch

On the VPS:
```bash
prowosma-ops deploy --dry-run      # should say it would deploy the new commit for backend and frontend
prowosma-ops deploy                # backs up MongoDB, builds, restarts, health-checks (several minutes)
```
If the backend doesn't come up healthy, prowosma-ops restores the previous version by itself and says so.
Follow the backend start with `prowosma-ops logs backend` in a second window if you like.

Then turn automatic deploys back on:
```bash
prowosma-ops resume
prowosma-ops status                # live = github, health: OK
```

## 9. Check it in the app

Sign in as an admin:
1. **Classic / New design**: user menu → Design. Dashboard shows the tabs (Projects / Goals / Tasks and Work / Insights / …).
2. **Meetings**: Admin Centre → Feature flags → turn on **AI Meeting Assistant (new)** for the workspace.
   Open **Meetings**. A "Setup needed" box lists anything still missing:
   - about speech-to-text → check step 4e and the `UMA_STT_...` lines (step 5);
   - "AI isn't turned on" → an admin sets a provider and key under **AI Settings** (summaries and action items use it).
   When the box is gone, record or upload a short test with two voices and check the text, summary and action items.
   Old notes are under Meetings → *Earlier meetings*.
3. **Notifications**: Profile → Notifications → *Turn on*, then *Send a test*. Works only over https.
4. **Channels**: create a private channel and send a direct message. **Projects**: pick team members, *Start working* timer.
5. **Editors** (if the client uses that role): an editor can clock in/out, use the project timer, log time and send messages,
   but can't create projects, tasks or channels.

Users don't need to clear anything: the new version loads on their next page load.

## If something is wrong

| Problem | What to do |
|---|---|
| The app misbehaves after the deploy | `prowosma-ops rollback` (backend and frontend go back one version). New data in new collections stays and is simply unused |
| Only meeting recording is the problem | Turn the *AI Meeting Assistant (new)* flag off, or `systemctl stop prowosma-stt` |
| "The speech-to-text server ... busy or unavailable" | `systemctl status prowosma-stt`, `journalctl -u prowosma-stt -n 100`, `curl http://127.0.0.1:8765/health` |
| Uploads fail with 413 | Step 6 wasn't applied to the server block that proxies `/api` |
| "Notifications aren't set up on the server yet" | The `VAPID_...` lines are missing, or the backend wasn't restarted after adding them |
| The server runs out of memory during transcription | Add swap (step 1) or set `STT_MODEL=base` in `/etc/systemd/system/prowosma-stt.service`, then `systemctl daemon-reload && systemctl restart prowosma-stt`, and `UMA_STT_MODEL=base` in the backend `.env` + `systemctl restart prowosma-backend` |

To undo the server preparation: `systemctl disable --now prowosma-stt`, restore `.env.before-release`, remove the nginx lines.

## Updating the speech service later

It is not part of the automatic deploy. When `tools/stt-server` changes, copy the two files again (step 4b),
re-run `.venv/bin/pip install -r requirements.txt` and `systemctl restart prowosma-stt`.

## Alternative: a hosted speech service instead of step 4

If the VPS is too small, use OpenAI (or any service with the same API). Audio then leaves your server — tell the client.
In the backend `.env`: `UMA_STT_BASE_URL=https://api.openai.com`, `UMA_STT_MODEL=whisper-1`, `UMA_STT_API_KEY=<key>`.
