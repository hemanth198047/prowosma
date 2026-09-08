package com.prowosma.backend.service;

import com.prowosma.backend.config.region.RegionConfig;
import com.prowosma.backend.model.TeamMember;
import com.prowosma.backend.model.Workspace;
import com.prowosma.backend.repository.TeamMemberRepository;
import com.prowosma.backend.repository.UserRepository;
import com.prowosma.backend.repository.WorkspaceRepository;
import com.prowosma.backend.service.ActivityLogService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class WorkspaceService {

    private final WorkspaceRepository workspaceRepository;
    private final ActivityLogService activityLogService;
    private final RegionConfig regionConfig;
    private final TeamMemberRepository teamMemberRepository;
    private final UserRepository userRepository;

    @org.springframework.beans.factory.annotation.Value("${data-region.allow-unenforced:false}")
    private boolean allowUnenforcedDataRegion;

    public List<Workspace> getByOwnerEmail(String email) {
        return workspaceRepository.findByOwnerEmail(email);
    }

    public List<Workspace> getByOrganizationId(String organizationId) {
        return workspaceRepository.findByOrganizationId(organizationId);
    }

    public Workspace getById(String id) {
        return workspaceRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Workspace not found: " + id));
    }

    public Workspace create(Workspace workspace, String ownerEmail) {
        workspace.setOwnerEmail(ownerEmail);
        workspace.setCreatedAt(LocalDateTime.now());
        workspace.setUpdatedAt(LocalDateTime.now());
        // Set default notif prefs
        workspace.setNotifPrefs(Map.of(
                "taskOverdue", true,
                "taskAssigned", true,
                "goalAchieved", true,
                "projectCompleted", true,
                "weeklyDigest", false
        ));
        Workspace saved = workspaceRepository.save(workspace);
        saved.setOrganizationId(saved.getId());
        Workspace finalSaved = workspaceRepository.save(saved);
        activityLogService.log("WORKSPACE", finalSaved.getId(), finalSaved.getName(),
                "CREATED", null, finalSaved.getName(), null);

        // Give the owner an explicit TeamMember record (role="OWNER") so
        // they're visible in team listings and resolvable via
        // /api/team/by-email — previously the owner had NO TeamMember row
        // at all (their access was purely inferred from
        // Workspace.ownerEmail in RoleGuardFilter), which meant nothing in
        // the UI could show "you are the Owner" and the owner didn't even
        // appear in their own team member list.
        if (!teamMemberRepository.existsByEmailAndOrganizationId(ownerEmail, finalSaved.getId())) {
            TeamMember owner = new TeamMember();
            owner.setOrganizationId(finalSaved.getId());
            owner.setEmail(ownerEmail);
            owner.setName(userRepository.findByEmail(ownerEmail).map(u -> u.getName()).orElse(ownerEmail));
            owner.setRole("OWNER");
            owner.setColor("#" + String.format("%06x", (ownerEmail.hashCode() & 0xffffff) | 0x400000));
            teamMemberRepository.save(owner);
        }
        return finalSaved;
    }

    public Workspace update(String id, Workspace updated) {
        Workspace existing = getById(id);
        if (updated.getName() != null && !updated.getName().isBlank())
            existing.setName(updated.getName());
        if (updated.getLogoUrl() != null)
            existing.setLogoUrl(updated.getLogoUrl().isBlank() ? null : updated.getLogoUrl());
        if (updated.getTimezone() != null)
            existing.setTimezone(updated.getTimezone());
        if (updated.getDateFormat() != null)
            existing.setDateFormat(updated.getDateFormat());
        if (updated.getNotifPrefs() != null)
            existing.setNotifPrefs(updated.getNotifPrefs());
        if (updated.getDataRegion() != null && !updated.getDataRegion().equals(existing.getDataRegion())) {
            String requested = updated.getDataRegion();
            // The honesty fix: previously a workspace could declare ANY
            // region here — "EU", "APAC", whatever — with zero connection
            // to whether this deployment has any actual infrastructure in
            // that region, which is exactly the "region dropdown implying
            // compliance that isn't real" problem Workspace.dataRegion's
            // own doc comment warned about. Now: declaring a region this
            // deployment can't actually back (see RegionConfig —
            // MONGODB_URI_<region> not configured) is rejected outright,
            // UNLESS it's "UNSET" (always allowed — declaring nothing is
            // honest) or the operator has explicitly allowed advisory-only
            // declarations via ALLOW_UNENFORCED_DATA_REGION=true (e.g. a
            // deployment that's mid-migration to real regional
            // infrastructure and wants to record customer intent ahead of
            // enforcement actually landing — an explicit opt-in, not a
            // silent default).
            if (!"UNSET".equals(requested) && !regionConfig.canEnforce(requested) && !allowUnenforcedDataRegion) {
                throw new IllegalArgumentException(
                    "This deployment has no configured infrastructure for region '" + requested + "' " +
                    "(no MONGODB_URI_" + requested + " is set), so it cannot honestly promise data " +
                    "residency there. Configure that region's database connection first, or set " +
                    "ALLOW_UNENFORCED_DATA_REGION=true to record this as an advisory-only declaration " +
                    "instead of a rejected one — see docs/DATA_RESIDENCY.md.");
            }
            // Compliance-relevant change — audit logged like any other
            // security-adjacent setting. Note this only changes the
            // *declared* region; see Workspace.dataRegion's doc comment for
            // why it doesn't (and currently can't) move any actual data.
            activityLogService.log("WORKSPACE", id, existing.getName(),
                    "DATA_REGION_CHANGED", existing.getDataRegion(), updated.getDataRegion(), null);
            existing.setDataRegion(updated.getDataRegion());
        }
        existing.setUpdatedAt(LocalDateTime.now());
        return workspaceRepository.save(existing);
    }

    public void delete(String id) {
        // Was logged twice here (copy-paste duplicate) — every workspace
        // deletion wrote two identical activity_logs rows for the same
        // event. Harmless to correctness, but noisy for anyone auditing
        // deletions and worth fixing while already in this method.
        activityLogService.log("WORKSPACE", id, id, "DELETED", null, null, null);
        workspaceRepository.deleteById(id);
    }
}