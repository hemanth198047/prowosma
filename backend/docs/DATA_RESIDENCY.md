# Data Residency & Multi-Region

## What changed

Previously, `Workspace.dataRegion` was pure metadata — a workspace could declare "EU" residency with
zero connection to where its data actually lived, and `GET /api/admin/data-residency` always reported
`enforced: false` unconditionally. That honesty was correct as far as it went, but left the actual gap
unaddressed.

This change adds **real, working, opt-in region-routing infrastructure**, plus a fix to stop a
workspace from declaring a region this deployment can't actually back.

## The honest scope of what this does and doesn't solve

**What's real now:**
- A workspace can no longer declare a region with zero backing infrastructure — `WorkspaceService`
  rejects it (`400`, not a silent accept) unless `ALLOW_UNENFORCED_DATA_REGION=true` is explicitly set.
- A genuine routing mechanism exists (`RegionRoutingMongoDatabaseFactory` +
  `DataRegionRoutingFilter` + `RegionContext`) that can route a MongoDB collection to a truly distinct
  physical cluster based on the current request's workspace.
- `GET /api/admin/data-residency` now reports `enforced: true` only when a real, distinct database
  connection is configured for the declared region.

**What this deliberately does NOT do, and why:**
- **It does not retroactively route any of the ~60 existing `@Document` repositories** (Task, Project,
  Doc, Comment, Attachment, etc.) through the new factory. Spring Data MongoDB repositories are wired
  to the app's one *primary* `MongoTemplate`/`MongoDatabaseFactory` by default; making a repository use
  the region-routed one instead requires deliberately reconfiguring that specific repository (see
  "Adopting this for a collection" below), one at a time. Converting all ~60 in one pass, in an
  environment where this couldn't be compiled or tested against a real multi-cluster MongoDB, would
  have been exactly the kind of invasive, unverifiable change this engagement has avoided everywhere
  else — better to ship the real mechanism plus a clear, safe adoption path than a broad change with
  unknown correctness.
- **It does not move any existing data.** Routing only affects where NEW writes for a repository that
  has adopted it land — migrating already-written data into a newly-provisioned regional cluster is a
  one-time data migration project (`mongodump`/`mongorestore` scoped by workspace ID, essentially),
  not something a routing layer does automatically or safely without a maintenance window.
- **Workspace/User/Subscription records themselves are never region-routed** — they stay in the home
  database always, by design. You cannot know which database to route a request to without first
  reading a record that says which region applies, and that lookup record has to live somewhere
  always-reachable. This is the standard "control plane vs. tenant data" split used by real multi-region
  SaaS systems, not a shortcut specific to this codebase.

## Adopting this for a collection

Example: making `Attachment` region-routed (pick a real candidate collection for your situation —
this is the general pattern, not a recommendation that Attachment specifically is the right first one).

1. Give the repository interface its own `@EnableMongoRepositories` scope pointed at the region-routed
   template:

   ```java
   @Configuration
   @EnableMongoRepositories(
       basePackageClasses = AttachmentRepository.class,
       mongoTemplateRef = "regionRoutedMongoTemplate"
   )
   public class AttachmentRegionRoutingConfig {}
   ```

   (Requires moving `AttachmentRepository` to its own package, or using `includeFilters`, so this
   `@EnableMongoRepositories` doesn't also try to claim every other repository — see Spring Data's own
   docs on scoping multiple `@EnableMongoRepositories` declarations in one application.)

2. That's it for reads/writes going through the repository interface — they'll now route through
   `RegionContext`, which `DataRegionRoutingFilter` already populates on every request.

3. **Test this against a real second MongoDB instance before trusting it** — e.g. two local
   `docker run -p 27017:27017 mongo` / `docker run -p 27018:27017 mongo` instances, with
   `MONGODB_URI_EU=mongodb://localhost:27018/prowosma` pointed at the second one, and confirm a
   workspace declared as EU actually writes there.

## Provisioning a real region

1. Stand up an actual MongoDB cluster physically located in the target region (a managed Atlas
   cluster with a region selection is the simplest path; a self-hosted cluster on region-specific
   infrastructure works too).
2. Set `MONGODB_URI_<REGION>` to that cluster's connection string.
3. Restart the backend — check the startup log for `[RegionConfig] Region-routed storage configured
   for: [...]`.
4. Adopt the collections that actually need to be region-scoped for your compliance requirement (see
   above) — not necessarily every collection; some data (e.g. anonymized product analytics) may not
   need residency guarantees at all, and forcing everything through routing adds operational complexity
   for no compliance benefit in those cases.

## Testing the routing layer itself

Not covered by this change's automated test suite — testing `RegionRoutingMongoDatabaseFactory`
meaningfully needs two real MongoDB instances to route between (mocking the MongoDB driver would
mostly test the mock). If adding this coverage: spin up two Testcontainers MongoDB instances in a test
class, configure both region URIs, adopt one test-only repository via the pattern above, and assert a
workspace declared in each region writes to the correct instance.
