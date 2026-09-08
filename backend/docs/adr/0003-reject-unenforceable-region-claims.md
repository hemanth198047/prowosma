# ADR 0003: Reject a workspace's region declaration rather than accept an unenforceable promise

## Status
Accepted

## Context
Before this backlog, `Workspace.dataRegion` was pure metadata — a workspace could declare "EU"
residency with zero connection to whether this deployment had any EU infrastructure at all. Once
`RegionConfig` (ADR 0002) could determine which regions actually have backing infrastructure, a choice
emerged: keep accepting any declared region (simplicity), or start rejecting ones the deployment can't
back (honesty, at the cost of a harder-edged API).

## Decision
`WorkspaceService.update()` rejects a region declaration when no real infrastructure backs it, unless
`ALLOW_UNENFORCED_DATA_REGION=true` is explicitly set (an intentional escape hatch for a deployment
mid-migration to real regional infrastructure that wants to record customer intent ahead of
enforcement).

## Consequences
- **Positive**: it's no longer possible for a region dropdown to imply a compliance guarantee that
  doesn't exist — the exact problem the pre-existing code's own doc comment had already flagged as a
  concern.
- **Negative**: a deployment without any region-specific infrastructure configured can no longer offer
  ANY region selection at all (every region except "UNSET" is rejected) — a real UX/product trade-off,
  not just a technical one. Teams that want to collect "which region would you prefer" as a roadmap
  signal without implying it's active today should use `ALLOW_UNENFORCED_DATA_REGION=true` explicitly.
