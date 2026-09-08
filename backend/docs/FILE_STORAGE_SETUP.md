# File Storage Setup — Local Disk, S3, and Malware Scanning

Attachments are stored via `FileStorageService`, which supports two backends selected entirely by
`FILE_STORAGE_PROVIDER` — **switching is a config change, never a code change.**

## Local disk (default)

Unchanged from before this change — files land under `FILE_UPLOAD_DIR` (default `uploads/`) on
whatever disk the backend container/host has. Fine for local dev and single-instance deployments;
does **not** survive a container restart without a persistent volume, and does not work at all across
multiple backend instances without a shared network filesystem.

## Amazon S3 (or any S3-compatible service)

```bash
FILE_STORAGE_PROVIDER=s3
FILE_STORAGE_S3_BUCKET=your-bucket-name
FILE_STORAGE_S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=...        # or use an IAM instance/task role instead — preferred in real AWS deployments
AWS_SECRET_ACCESS_KEY=...
```

These are the AWS SDK's own standard environment variables — the SDK's default credential provider
chain picks them up automatically; nothing app-specific about them. In a real AWS deployment (ECS,
EKS, EC2), prefer an IAM role attached to the compute resource over long-lived access keys — the SDK
picks that up automatically too, with nothing to set here at all beyond `FILE_STORAGE_PROVIDER=s3` and
the bucket/region.

Required bucket permissions for the credential/role used: `s3:PutObject`, `s3:GetObject`,
`s3:DeleteObject` on `arn:aws:s3:::your-bucket-name/*`.

Uploads are stored with `ServerSideEncryption.AES256` (SSE-S3) by default — encryption at rest with no
extra configuration needed.

Downloads: the app no longer proxies file bytes through itself when using S3 — `GET
/api/tasks/attachments/{fileName}` returns a `302` redirect to a short-lived (10-minute) presigned S3
URL instead, which the browser follows transparently. This scales better for large attachments than
routing every byte through the app server.

### S3-compatible services (MinIO, Cloudflare R2, Backblaze B2, DigitalOcean Spaces)

Add one more variable:

```bash
FILE_STORAGE_S3_ENDPOINT=http://localhost:9000   # MinIO example
```

Local MinIO for dev/testing (add to `docker-compose.yml` if wanted):

```yaml
minio:
  image: minio/minio:latest
  command: server /data --console-address ":9001"
  environment:
    MINIO_ROOT_USER: minioadmin
    MINIO_ROOT_PASSWORD: minioadmin
  ports:
    - "9000:9000"   # S3 API
    - "9001:9001"   # Web console
```
Then: `FILE_STORAGE_PROVIDER=s3`, `FILE_STORAGE_S3_ENDPOINT=http://localhost:9000`,
`FILE_STORAGE_S3_BUCKET=prowosma-dev`, `AWS_ACCESS_KEY_ID=minioadmin`,
`AWS_SECRET_ACCESS_KEY=minioadmin` — create the bucket once via the MinIO console at
`localhost:9001` or `mc mb local/prowosma-dev`.

## Malware scanning (ClamAV)

Off by default (`VIRUS_SCAN_PROVIDER=none` — every upload treated as clean, matching prior behavior
exactly). To enable:

```bash
VIRUS_SCAN_PROVIDER=clamav
CLAMAV_HOST=localhost
CLAMAV_PORT=3310
```

Local ClamAV for dev/testing (add to `docker-compose.yml` if wanted):

```yaml
clamav:
  image: clamav/clamav:1.3
  ports:
    - "3310:3310"
  # First startup downloads virus definitions — can take a few minutes;
  # the app's scan calls will error (and fail-open by default, see below)
  # until clamd finishes initializing.
```

**Fail-open vs. fail-closed:** if clamd is unreachable, `VIRUS_SCAN_FAIL_CLOSED=false` (default) logs a
warning and lets the upload through unscanned — appropriate while ClamAV is a defense-in-depth layer
rather than a hard requirement. Set `VIRUS_SCAN_FAIL_CLOSED=true` once it's a required control (e.g.
to satisfy a security review) — uploads are then rejected outright if scanning can't happen.

A second, independent layer blocks a small denylist of executable extensions
(`.exe .bat .cmd .sh .ps1 .msi .scr .jar .com .vbs`) regardless of scan result or provider — see
`FileStorageService.BLOCKED_EXTENSIONS`.

## Metrics

Visible at `/actuator/prometheus`:
- `file.upload.success{backend=local|s3}`
- `file.upload.blocked{reason=extension|virus}`
- `file.upload.scan-error` — scanner was unreachable (check whether this correlates with fail-open uploads you want to review)

## What this still doesn't cover

- **CDN in front of attachments** — tracked separately under the Scalability & High Availability item
  in the enterprise-readiness backlog, not duplicated here.
- **Antivirus definition freshness monitoring** — this integrates with whatever clamd instance you
  run; keeping its virus definitions updated (`freshclam`, usually automatic in the official image) is
  operational, not something this app manages.
- **Malware scanning of attachments already stored before this change was deployed** — only new
  uploads are scanned going forward; a one-time backfill scan of existing attachments is a separate,
  deployment-specific task if wanted.
