# Scalability & High Availability

## What changed

| Gap | What's now real |
|---|---|
| MongoDB single container, no replica set | `docker-compose.yml`'s `mongodb` service now runs as a genuine single-node replica set (`rs0`), auto-initiated by a one-shot `mongodb-init-replicaset` service. Unlocks multi-document transactions and change streams, which a standalone instance can't support at all — and exercises the exact connection-string shape (`?replicaSet=rs0`) production will use. |
| No autoscaling configuration | `k8s/backend-hpa.yaml` — a real HorizontalPodAutoscaler for the Deployment added in the CI/CD item, scaling on CPU and memory. ECS equivalent documented below. |
| No CDN layer | Documented below — the frontend's nginx config already sets CDN-appropriate cache headers (see `nginx.conf`'s own comments); a CDN just needs to be pointed at it. Same for the S3 uploads bucket added in the File Storage item. |
| No documented multi-region architecture | Documented below, building directly on the region-routing infrastructure (Data Residency item) and disaster-recovery tooling (Backup/DR item) already in this backlog. |

## MongoDB replica set

**Local dev** (`docker-compose.yml`): single-node replica set — real replica-set behavior, minimal
resource overhead, safe to leave running continuously.

**Production**: a single-node replica set has zero failover capability — it's the same single point of
failure as a standalone instance, just with transaction support unlocked. A real production topology
needs at least 3 nodes (a primary plus two secondaries, so the loss of any one node still leaves a
majority able to elect a new primary and keep accepting writes). Two paths:

- **Managed (recommended for most teams)**: MongoDB Atlas (or a cloud provider's managed MongoDB-
  compatible service) — replica set failover, backups, and patching are the provider's problem, not
  yours. Just point `MONGODB_URI` at it.
- **Self-hosted**: run 3+ `mongod` instances (across separate hosts/availability zones — replicas on
  the same physical host defeats the purpose) with keyfile authentication between them, `rs.initiate()`
  with all 3 members, and your own monitoring for replica lag and failover events. Meaningfully more
  operational burden than the managed path; only worth it for teams with a specific reason to
  self-host (data residency requirements the region-routing infrastructure below doesn't yet cover for
  a specific region, cost at very large scale, etc.).

Either way, `MONGODB_URI` simply becomes a real multi-host connection string
(`mongodb://host1,host2,host3/prowosma?replicaSet=rs0` for self-hosted, or Atlas's own `mongodb+srv://`
connection string) — no application code change, since the driver already handles replica-set topology
discovery and automatic failover to whichever member is currently primary.

## Autoscaling

**Kubernetes**: `k8s/backend-hpa.yaml` — see that file's own comments for the specific scale-up/down
behavior and why `minReplicas: 2`.

**ECS** (if that's the chosen target instead): ECS Service Auto Scaling via an Application Auto Scaling
target and a target-tracking policy — the ECS equivalent of the HPA above. Example Terraform:

```hcl
resource "aws_appautoscaling_target" "backend" {
  max_capacity       = 10
  min_capacity       = 2
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.backend.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "backend_cpu" {
  name               = "prowosma-backend-cpu-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.backend.resource_id
  scalable_dimension = aws_appautoscaling_target.backend.scalable_dimension
  service_namespace  = aws_appautoscaling_target.backend.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value = 70
  }
}
```

Not applied anywhere in this change (no ECS cluster/service exists yet to attach it to — see the
CI/CD item's own note on the deployment target being undecided) — a real starting point for whoever
provisions the ECS side, once that decision is made.

## CDN

**Static frontend assets**: `nginx.conf` already sets `Cache-Control: public, immutable` on hashed
build assets (safe to cache aggressively — Vite fingerprints every filename, so a new deploy always
produces new filenames rather than silently serving stale JS) and `no-cache` on `index.html` (the one
file that must always be revalidated, since it's how the browser discovers a new deploy). A CDN just
needs to sit in front of that and respect those headers — no application change needed. Example
(CloudFront, pointed at the nginx container/ALB as its origin):

```hcl
resource "aws_cloudfront_distribution" "frontend" {
  origin {
    domain_name = aws_lb.frontend.dns_name
    origin_id   = "prowosma-frontend"
    custom_origin_config {
      http_port              = 80
      https_port              = 443
      origin_protocol_policy  = "http-only"  # ALB terminates TLS separately; adjust if not
      origin_ssl_protocols    = ["TLSv1.2"]
    }
  }
  default_cache_behavior {
    target_origin_id       = "prowosma-frontend"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods         = ["GET", "HEAD"]
    cached_methods           = ["GET", "HEAD"]
    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }
    # Respects the origin's own Cache-Control headers (set in nginx.conf)
    # rather than overriding them here — the origin is already the source
    # of truth for what should and shouldn't be cached.
    min_ttl     = 0
    default_ttl = 0
    max_ttl     = 31536000
  }
  # ... restrictions, viewer_certificate, enabled=true, etc. omitted —
  # this is a starting point, not a complete distribution config.
}
```

**Uploaded file attachments** (S3, from the File Storage item): same principle — a CDN in front of the
S3 bucket, using [Origin Access Control](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html)
so the bucket itself stays private and is only reachable through CloudFront. This changes
`FileStorageService.presignedDownloadUrl()`'s URL to point at the CloudFront domain instead of the S3
bucket directly (CloudFront supports signed URLs the same way S3 presigned URLs work) — not
implemented in this change since it depends on a real CloudFront distribution existing first, but the
application-side hook (that one method) is exactly where this would plug in once it does.

## Multi-region architecture (active/passive)

Given MongoDB's architecture (single-primary replica sets, not true multi-master), **active/passive is
the realistic, achievable pattern** — active/active would require either a very different database
choice or an application-level conflict-resolution strategy neither this codebase nor most teams
actually need. Building on infrastructure already in this backlog:

1. **Primary region**: a full stack (backend + MongoDB replica set) running and serving traffic.
2. **Secondary region**: MongoDB replica set members can extend into a second region as "read-only
   replicas with priority 0" — never elected primary automatically, but immediately promotable during a
   real regional outage, and continuously replicating so they're not stale.
3. **Data residency routing** (see that item's own doc, `docs/DATA_RESIDENCY.md`): the
   `RegionRoutingMongoDatabaseFactory` built there is the SAME mechanism that would route specific
   workspaces' data to a specific region's cluster for a true active/active-per-tenant setup (different
   tenants pinned to different primary regions, each region passive for the others) — a middle ground
   between full active/passive and full active/active that fits this application's actual tenancy model
   (each workspace's data is already logically isolated) better than either extreme.
4. **Failover procedure**: this is exactly what `docs/DISASTER_RECOVERY.md`'s restore-drill tooling and
   RTO/RPO measurement approach already covers — a regional failover is a specific case of the same
   "how fast can we actually recover, measured, not estimated" discipline established there, not a
   separate concern.

**Not implemented as running infrastructure in this change** — same reasoning as the CDN and ECS
autoscaling examples above: a real multi-region deployment requires an actual second region's
infrastructure to exist, which depends on the deployment target decision this whole set of "target-
dependent" items has been honest about not being able to make on someone else's behalf. What IS real:
every piece of application-level infrastructure a multi-region setup would actually route through
(region-aware data routing, measured backup/restore tooling, health-check-gated rolling
deployments) already exists in this codebase as of this backlog, ready for a real second region to be
pointed at them.
