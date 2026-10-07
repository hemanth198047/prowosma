package com.prowosma.backend.service;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.meetingassistant.MeetingUrlParser;
import com.prowosma.backend.meetingassistant.SessionStatus;
import com.prowosma.backend.model.*;
import com.prowosma.backend.repository.*;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.time.DateTimeException;
import java.time.Instant;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.regex.Pattern;

/**
 * Meeting Assistant — foundation: settings, platform connections, and meeting-session
 * lifecycle. Transcript collection, AI outputs and task creation are NOT part of this
 * class yet; sessions record what was requested and who may see it.
 */
@Service
@RequiredArgsConstructor
public class MeetingAssistantService {

    /** Automatic creation is stored as a setting but cannot be switched on until it exists. */
    public static final boolean AUTO_CREATION_AVAILABLE = false;
    public static final List<String> PROVIDERS = List.of("GOOGLE_MEET", "MS_TEAMS");
    private static final Set<String> ASSIGNABLE_ROLES = Set.of("OWNER", "ADMIN", "MEMBER");
    private static final Pattern LANG = Pattern.compile("^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$");
    private static final Pattern CONTROL = Pattern.compile("[\\p{Cntrl}]");

    private final MeetingSessionRepository sessions;
    private final MeetingAssistantSettingsRepository settingsRepo;
    private final MeetingIntegrationRepository integrations;
    private final WorkspaceContext workspaceContext;
    private final WorkspaceRepository workspaceRepository;
    private final TeamMemberRepository teamMemberRepository;
    private final ProjectRepository projectRepository;
    private final ActivityLogService activityLog;

    @Value("${app.meeting-assistant.dev-fixtures-enabled:false}")
    private boolean devFixtures;

    // ── errors ────────────────────────────────────────────────────────────────

    public static class MeetingAssistantException extends RuntimeException {
        private final HttpStatus status;
        private final String code;
        private final Map<String, Object> extras;

        public MeetingAssistantException(HttpStatus status, String code, String message) {
            this(status, code, message, Map.of());
        }
        public MeetingAssistantException(HttpStatus status, String code, String message, Map<String, Object> extras) {
            super(message);
            this.status = status; this.code = code; this.extras = extras;
        }
        public HttpStatus getStatus() { return status; }
        public String getCode() { return code; }
        public Map<String, Object> getExtras() { return extras; }
    }

    private static MeetingAssistantException err(HttpStatus s, String code, String msg) {
        return new MeetingAssistantException(s, code, msg);
    }

    // ── identity / access helpers ─────────────────────────────────────────────

    private String orgId() {
        String id = workspaceContext.getWorkspaceId();
        if (id == null || id.isBlank()) throw err(HttpStatus.BAD_REQUEST, "WORKSPACE_REQUIRED", "No workspace selected.");
        return id;
    }

    /** Same resolution rule as RoleGuardFilter: workspace owner first, then the TeamMember role. */
    public String roleOf(String email) {
        String org = orgId();
        Optional<Workspace> ws = workspaceRepository.findById(org);
        if (email != null && ws.isPresent() && email.equals(ws.get().getOwnerEmail())) return "OWNER";
        return teamMemberRepository.findAllByEmailAndOrganizationId(email, org).stream()
                .findFirst().map(TeamMember::getRole).orElse("NONE");
    }

    private static boolean isAdmin(String role) { return "OWNER".equals(role) || "ADMIN".equals(role); }

    /** Attendance never grants access: only the requester, admins, explicit shares, or workspace-wide visibility. */
    private boolean canAccess(MeetingSession s, String email, String role) {
        if (isAdmin(role)) return true;
        if (email != null && email.equalsIgnoreCase(s.getRequestedBy())) return true;
        if (s.getSharedWith() != null && s.getSharedWith().stream().anyMatch(e -> e.equalsIgnoreCase(email))) return true;
        return "WORKSPACE".equals(s.getVisibility()) && !"NONE".equals(role);
    }

    private boolean canManage(MeetingSession s, String email, String role) {
        return isAdmin(role) || (email != null && email.equalsIgnoreCase(s.getRequestedBy()));
    }

    // ── settings ──────────────────────────────────────────────────────────────

    public MeetingAssistantSettings getSettings() {
        String org = orgId();
        return settingsRepo.findByOrganizationId(org).orElseGet(() -> {
            MeetingAssistantSettings s = new MeetingAssistantSettings();
            s.setOrganizationId(org);
            return s;
        });
    }

    public MeetingAssistantSettings updateSettings(Map<String, Object> patch, String email) {
        MeetingAssistantSettings s = getSettings();

        if (patch.containsKey("assistantName")) {
            String n = CONTROL.matcher(String.valueOf(patch.get("assistantName"))).replaceAll("").trim();
            if (n.isEmpty() || n.length() > 60)
                throw err(HttpStatus.BAD_REQUEST, "INVALID_NAME", "The assistant name must be 1–60 characters.");
            s.setAssistantName(n);
        }
        if (patch.containsKey("sendRoles")) {
            Set<String> roles = new LinkedHashSet<>(List.of("OWNER", "ADMIN")); // admins can never be locked out
            if (!(patch.get("sendRoles") instanceof List<?> raw))
                throw err(HttpStatus.BAD_REQUEST, "INVALID_ROLES", "sendRoles must be a list.");
            for (Object r : raw) {
                String role = String.valueOf(r);
                if (!ASSIGNABLE_ROLES.contains(role))
                    throw err(HttpStatus.BAD_REQUEST, "INVALID_ROLES", "Unknown role: " + role);
                roles.add(role);
            }
            s.setSendRoles(new ArrayList<>(roles));
        }
        if (patch.containsKey("defaultVisibility")) {
            String v = String.valueOf(patch.get("defaultVisibility"));
            if (!v.equals("PRIVATE") && !v.equals("WORKSPACE"))
                throw err(HttpStatus.BAD_REQUEST, "INVALID_VISIBILITY", "Visibility must be PRIVATE or WORKSPACE.");
            s.setDefaultVisibility(v);
        }
        for (String f : List.of("autoCreateTasks", "autoCreateProjects")) {
            if (patch.containsKey(f)) {
                boolean on = Boolean.parseBoolean(String.valueOf(patch.get(f)));
                if (on && !AUTO_CREATION_AVAILABLE)
                    throw err(HttpStatus.CONFLICT, "NOT_AVAILABLE",
                            "Automatic creation isn't available yet. Generated items will be sent for review.");
                if (f.equals("autoCreateTasks")) s.setAutoCreateTasks(on); else s.setAutoCreateProjects(on);
            }
        }
        if (patch.containsKey("transcriptRetentionDays"))
            s.setTranscriptRetentionDays(intOf(patch, "transcriptRetentionDays", 1, 3650));
        if (patch.containsKey("generatedContentRetentionDays"))
            s.setGeneratedContentRetentionDays(intOf(patch, "generatedContentRetentionDays", 1, 3650));
        if (patch.containsKey("retainRawAudio"))
            s.setRetainRawAudio(Boolean.parseBoolean(String.valueOf(patch.get("retainRawAudio"))));
        if (patch.containsKey("rawAudioRetentionDays"))
            s.setRawAudioRetentionDays(intOf(patch, "rawAudioRetentionDays", 0, 90));
        if (!s.isRetainRawAudio()) s.setRawAudioRetentionDays(0);
        else if (s.getRawAudioRetentionDays() < 1)
            throw err(HttpStatus.BAD_REQUEST, "INVALID_RETENTION", "Choose how many days (1–90) raw audio is kept.");
        if (patch.containsKey("outputLanguage")) {
            String l = String.valueOf(patch.get("outputLanguage"));
            if (!LANG.matcher(l).matches())
                throw err(HttpStatus.BAD_REQUEST, "INVALID_LANGUAGE", "Use a language code such as en or pt-BR.");
            s.setOutputLanguage(l);
        }

        s.setUpdatedBy(email);
        s.setUpdatedAt(Instant.now());
        MeetingAssistantSettings saved = saveSettings(s);
        activityLog.log("MEETING_ASSISTANT", saved.getId(), "Meeting assistant settings", "UPDATED", null, null, email);
        return saved;
    }

    private MeetingAssistantSettings saveSettings(MeetingAssistantSettings s) {
        try {
            return settingsRepo.save(s);
        } catch (DuplicateKeyException race) {   // two admins saving first-time settings at once
            MeetingAssistantSettings existing = settingsRepo.findByOrganizationId(orgId()).orElseThrow(() -> race);
            s.setId(existing.getId());
            return settingsRepo.save(s);
        }
    }

    private static int intOf(Map<String, Object> m, String field, int min, int max) {
        try {
            int v = Integer.parseInt(String.valueOf(m.get(field)));
            if (v < min || v > max) throw new NumberFormatException();
            return v;
        } catch (NumberFormatException e) {
            throw err(HttpStatus.BAD_REQUEST, "INVALID_" + field.toUpperCase(Locale.ROOT),
                    field + " must be a whole number from " + min + " to " + max + ".");
        }
    }

    // ── platform connections ──────────────────────────────────────────────────

    private static String normalizeProvider(String p) {
        String n = p == null ? "" : p.trim().toUpperCase(Locale.ROOT).replace('-', '_');
        if (!PROVIDERS.contains(n)) throw err(HttpStatus.NOT_FOUND, "UNKNOWN_PROVIDER", "Unknown meeting platform.");
        return n;
    }

    private MeetingIntegration defaultIntegration(String provider) {
        MeetingIntegration i = new MeetingIntegration();
        i.setOrganizationId(orgId());
        i.setProvider(provider);
        i.setStatusMessage("Not connected.");
        return i;
    }

    public List<MeetingIntegration> listIntegrations() {
        Map<String, MeetingIntegration> byProvider = new HashMap<>();
        for (MeetingIntegration i : integrations.findByOrganizationId(orgId())) byProvider.put(i.getProvider(), i);
        List<MeetingIntegration> out = new ArrayList<>();
        for (String p : PROVIDERS) out.add(byProvider.getOrDefault(p, defaultIntegration(p)));
        return out;
    }

    private MeetingIntegration getOrCreateIntegration(String provider) {
        return integrations.findByOrganizationIdAndProvider(orgId(), provider).orElseGet(() -> {
            try {
                return integrations.save(defaultIntegration(provider));
            } catch (DuplicateKeyException race) {
                return integrations.findByOrganizationIdAndProvider(orgId(), provider).orElseThrow(() -> race);
            }
        });
    }

    public MeetingIntegration setEnabled(String providerRaw, boolean enabled, String email) {
        String provider = normalizeProvider(providerRaw);
        MeetingIntegration i = getOrCreateIntegration(provider);
        i.setEnabled(enabled);
        i.setUpdatedBy(email);
        i.setUpdatedAt(Instant.now());
        MeetingIntegration saved = integrations.save(i);
        activityLog.log("MEETING_PLATFORM", saved.getId(), provider, enabled ? "ENABLED" : "DISABLED", null, null, email);
        return saved;
    }

    /**
     * Honest health check. No platform sign-in exists yet, so this reports exactly that
     * rather than pretending to probe a connection.
     */
    public Map<String, Object> testConnection(String providerRaw, String email) {
        String provider = normalizeProvider(providerRaw);
        MeetingIntegration i = getOrCreateIntegration(provider);
        i.setLastCheckedAt(Instant.now());
        i.setUpdatedBy(email);
        i.setUpdatedAt(Instant.now());
        boolean connected = "CONNECTED".equals(i.getConnectionStatus());
        i.setStatusMessage(connected ? i.getStatusMessage()
                : "Platform sign-in isn't set up yet, so transcripts can't be fetched automatically.");
        integrations.save(i);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("provider", provider);
        out.put("healthy", false);
        out.put("connectionStatus", i.getConnectionStatus());
        out.put("message", i.getStatusMessage());
        out.put("checkedAt", i.getLastCheckedAt().toString());
        return out;
    }

    public MeetingIntegration disconnect(String providerRaw, String email) {
        String provider = normalizeProvider(providerRaw);
        MeetingIntegration i = getOrCreateIntegration(provider);
        // No tokens exist yet. Once OAuth lands this is also where tokens are revoked and wiped.
        i.setEnabled(false);
        i.setConnectionStatus("NOT_CONNECTED");
        i.setConnectedAccount(null);
        i.setGrantedScopes(new ArrayList<>());
        i.setStatusMessage("Disconnected.");
        i.setUpdatedBy(email);
        i.setUpdatedAt(Instant.now());
        MeetingIntegration saved = integrations.save(i);
        activityLog.log("MEETING_PLATFORM", saved.getId(), provider, "DISCONNECTED", null, null, email);
        return saved;
    }

    /** What the assistant can truly do right now — the UI derives its wording from this, nothing is assumed. */
    public Map<String, Object> capabilities() {
        MeetingAssistantSettings st = getSettings();
        List<Map<String, Object>> platforms = new ArrayList<>();
        for (MeetingIntegration i : listIntegrations()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("provider", i.getProvider());
            m.put("enabled", i.isEnabled());
            m.put("connectionStatus", i.getConnectionStatus());
            m.put("liveJoin", false);
            m.put("automaticTranscript", false);
            m.put("manualTranscriptUpload", false);
            platforms.add(m);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("assistantName", st.getAssistantName());
        out.put("platforms", platforms);
        out.put("devFixturesEnabled", devFixtures);
        out.put("note", "Meetings can be registered, but no transcript source is connected yet, so nothing is collected automatically.");
        return out;
    }

    // ── sessions ──────────────────────────────────────────────────────────────

    public record CreateRequest(String meetingUrl, String title, String projectId,
                                String scheduledFor, String timezone, Boolean simulated) {}

    public Map<String, Object> validateUrl(String url) {
        MeetingUrlParser.Result r = MeetingUrlParser.parse(url);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("valid", r.valid());
        if (r.valid()) {
            out.put("provider", r.platform().name());
            out.put("canonicalUrl", r.canonicalUrl());
            out.put("warning", r.warning());
            MeetingIntegration i = integrations.findByOrganizationIdAndProvider(orgId(), r.platform().name()).orElse(null);
            out.put("providerEnabled", i != null && i.isEnabled());
        } else {
            out.put("errorCode", r.errorCode());
            out.put("message", r.message());
        }
        return out;
    }

    private static String occurrenceToken(Instant scheduledFor) {
        return scheduledFor == null ? "NOW" : scheduledFor.truncatedTo(ChronoUnit.MINUTES).toString();
    }

    private static String activeKeyOf(String org, String provider, String meetingKey, Instant scheduledFor) {
        return org + "|" + provider + "|" + meetingKey + "|" + occurrenceToken(scheduledFor);
    }

    public MeetingSession createSession(CreateRequest req, String email) {
        String org = orgId();
        String role = roleOf(email);
        MeetingAssistantSettings st = getSettings();
        if (!st.getSendRoles().contains(role))
            throw err(HttpStatus.FORBIDDEN, "NOT_ALLOWED",
                    "Your role can't send the meeting assistant. Ask a workspace admin for access.");

        MeetingUrlParser.Result parsed = MeetingUrlParser.parse(req.meetingUrl());
        if (!parsed.valid()) throw err(HttpStatus.BAD_REQUEST, parsed.errorCode(), parsed.message());
        String provider = parsed.platform().name();

        MeetingIntegration integ = integrations.findByOrganizationIdAndProvider(org, provider).orElse(null);
        if (integ == null || !integ.isEnabled())
            throw err(HttpStatus.CONFLICT, "PROVIDER_DISABLED",
                    "This meeting platform isn't enabled. Ask an admin to turn it on under Integrations → Meeting Platforms.");

        String projectId = null;
        String projectMode = "DETECT";
        if (req.projectId() != null && !req.projectId().isBlank()) {
            Project p = projectRepository.findById(req.projectId())
                    .filter(x -> org.equals(x.getOrganizationId()))
                    .orElseThrow(() -> err(HttpStatus.BAD_REQUEST, "PROJECT_NOT_FOUND", "That project wasn't found in this workspace."));
            projectId = p.getId();
            projectMode = "SELECTED";
        }

        Instant now = Instant.now();
        Instant scheduledFor = null;
        if (req.scheduledFor() != null && !req.scheduledFor().isBlank()) {
            try {
                scheduledFor = Instant.parse(req.scheduledFor());
            } catch (DateTimeException e) {
                throw err(HttpStatus.BAD_REQUEST, "INVALID_SCHEDULE", "The scheduled time isn't valid.");
            }
            if (scheduledFor.isBefore(now.minus(2, ChronoUnit.MINUTES)))
                throw err(HttpStatus.BAD_REQUEST, "SCHEDULE_IN_PAST", "The scheduled time has already passed.");
            if (scheduledFor.isAfter(now.plus(365, ChronoUnit.DAYS)))
                throw err(HttpStatus.BAD_REQUEST, "SCHEDULE_TOO_FAR", "Meetings can be scheduled up to a year ahead.");
            if (scheduledFor.isBefore(now.plus(1, ChronoUnit.MINUTES))) scheduledFor = null; // effectively "now"
        }

        String tz = "UTC";
        if (req.timezone() != null && !req.timezone().isBlank()) {
            try { tz = ZoneId.of(req.timezone().trim()).getId(); }
            catch (DateTimeException e) { throw err(HttpStatus.BAD_REQUEST, "INVALID_TIMEZONE", "Unknown timezone."); }
        }

        String title = req.title() == null ? "" : CONTROL.matcher(req.title()).replaceAll("").trim();
        if (title.length() > 200) throw err(HttpStatus.BAD_REQUEST, "INVALID_TITLE", "The title can be up to 200 characters.");
        if (title.isEmpty()) title = ("GOOGLE_MEET".equals(provider) ? "Google Meet" : "Microsoft Teams") + " meeting";

        boolean simulated = Boolean.TRUE.equals(req.simulated());
        if (simulated) {
            if (!devFixtures) throw err(HttpStatus.BAD_REQUEST, "DEV_FIXTURES_DISABLED", "Simulated meetings are disabled on this server.");
            if (!isAdmin(role)) throw err(HttpStatus.FORBIDDEN, "NOT_ALLOWED", "Only admins can create simulated meetings.");
            title = "[SIMULATED] " + title;
        }

        MeetingSession s = new MeetingSession();
        s.setOrganizationId(org);
        s.setProvider(provider);
        s.setMeetingKey(parsed.meetingKey());
        s.setMeetingUrl(parsed.canonicalUrl());
        s.setTitle(title);
        s.setRequestedBy(email);
        s.setProjectMode(projectMode);
        s.setProjectId(projectId);
        s.setScheduledFor(scheduledFor);
        s.setTimezone(tz);
        s.setVisibility(st.getDefaultVisibility());
        s.setSimulated(simulated);
        s.setActiveKey(activeKeyOf(org, provider, parsed.meetingKey(), scheduledFor));
        SessionStatus initial = scheduledFor != null ? SessionStatus.SCHEDULED : SessionStatus.AWAITING_TRANSCRIPT;
        s.setStatus(initial.name());
        s.setStatusDetail(detailFor(initial));
        addHistory(s, null, initial.name(), email, "Requested");

        MeetingSession saved;
        try {
            saved = sessions.save(s);
        } catch (DuplicateKeyException dup) {
            throw duplicateError(s.getActiveKey(), email, role);
        }
        activityLog.log("MEETING_SESSION", saved.getId(), saved.getTitle(), "CREATED", null, saved.getStatus(), email);
        return saved;
    }

    private MeetingAssistantException duplicateError(String activeKey, String email, String role) {
        Map<String, Object> extras = new LinkedHashMap<>();
        sessions.findByActiveKey(activeKey)
                .filter(x -> canAccess(x, email, role))
                .ifPresent(x -> extras.put("existingSessionId", x.getId()));
        return new MeetingAssistantException(HttpStatus.CONFLICT, "DUPLICATE_SESSION",
                "The assistant is already assigned to this meeting occurrence.", extras);
    }

    private static String detailFor(SessionStatus st) {
        return switch (st) {
            case SCHEDULED -> "Registered. Live joining isn't available, and transcript collection isn't connected yet.";
            case AWAITING_TRANSCRIPT -> "Meeting registered. Transcript collection isn't connected yet, so no transcript will be collected automatically.";
            case PROCESSING -> "Processing the transcript.";
            case READY_FOR_REVIEW -> "Ready for your review.";
            case COMPLETED -> "Completed.";
            case CANCELLED -> "Cancelled.";
            case FAILED -> "Something went wrong.";
            default -> st.name();
        };
    }

    public List<Map<String, Object>> list(String email) {
        String org = orgId();
        String role = roleOf(email);
        List<Map<String, Object>> out = new ArrayList<>();
        for (MeetingSession s : sessions.findByOrganizationIdOrderByCreatedAtDesc(org, PageRequest.of(0, 100))) {
            if (org.equals(s.getOrganizationId()) && canAccess(s, email, role)) out.add(view(s, canManage(s, email, role)));
        }
        return out;
    }

    public Map<String, Object> get(String id, String email) {
        String role = roleOf(email);
        MeetingSession s = load(id, email, role);
        return view(s, canManage(s, email, role));
    }

    /** Not found and not allowed look identical, so ids can't be probed. */
    private MeetingSession load(String id, String email, String role) {
        String org = orgId();
        return sessions.findById(id)
                .filter(x -> org.equals(x.getOrganizationId()))
                .filter(x -> canAccess(x, email, role))
                .orElseThrow(() -> err(HttpStatus.NOT_FOUND, "NOT_FOUND", "Meeting not found."));
    }

    private MeetingSession loadManageable(String id, String email, String role) {
        MeetingSession s = load(id, email, role);
        if (!canManage(s, email, role))
            throw err(HttpStatus.FORBIDDEN, "NOT_ALLOWED", "Only the person who requested this meeting or an admin can do that.");
        return s;
    }

    public Map<String, Object> cancel(String id, String email) {
        String role = roleOf(email);
        MeetingSession s = loadManageable(id, email, role);
        return view(transition(s, SessionStatus.CANCELLED, email, "Cancelled by user", null, null, null), true);
    }

    public Map<String, Object> retry(String id, String email) {
        String role = roleOf(email);
        MeetingSession s = loadManageable(id, email, role);
        if (!SessionStatus.valueOf(s.getStatus()).equals(SessionStatus.FAILED))
            throw err(HttpStatus.CONFLICT, "INVALID_STATE", "Only a failed meeting can be retried.");
        s.setActiveKey(activeKeyOf(s.getOrganizationId(), s.getProvider(), s.getMeetingKey(), s.getScheduledFor()));
        s.setRetryCount(s.getRetryCount() + 1);
        try {
            return view(transition(s, SessionStatus.SCHEDULED, email, "Retried by user", null, null, null), true);
        } catch (DuplicateKeyException dup) {
            throw duplicateError(s.getActiveKey(), email, role);
        }
    }

    /** Update who may open this meeting's results. Only existing workspace members can be added. */
    public Map<String, Object> updateAccess(String id, String visibility, List<String> sharedWith, String email) {
        String role = roleOf(email);
        MeetingSession s = loadManageable(id, email, role);
        if (visibility != null) {
            if (!visibility.equals("PRIVATE") && !visibility.equals("WORKSPACE"))
                throw err(HttpStatus.BAD_REQUEST, "INVALID_VISIBILITY", "Visibility must be PRIVATE or WORKSPACE.");
            s.setVisibility(visibility);
        }
        if (sharedWith != null) {
            Set<String> members = new HashSet<>();
            teamMemberRepository.findByOrganizationId(orgId()).forEach(m -> {
                if (m.getEmail() != null) members.add(m.getEmail().toLowerCase(Locale.ROOT));
            });
            List<String> clean = new ArrayList<>();
            for (String e : sharedWith) {
                String n = e == null ? "" : e.trim().toLowerCase(Locale.ROOT);
                if (!members.contains(n))
                    throw err(HttpStatus.BAD_REQUEST, "UNKNOWN_MEMBER", "Results can only be shared with members of this workspace.");
                if (!clean.contains(n)) clean.add(n);
            }
            s.setSharedWith(clean);
        }
        s.setUpdatedAt(Instant.now());
        MeetingSession saved = saveSession(s);
        activityLog.log("MEETING_SESSION", saved.getId(), saved.getTitle(), "ACCESS_CHANGED", null, saved.getVisibility(), email);
        return view(saved, true);
    }

    // ── development fixtures (clearly simulated, off unless enabled) ──────────

    public Map<String, Object> devAdvance(String id, String target, String email) {
        if (!devFixtures) throw err(HttpStatus.NOT_FOUND, "NOT_FOUND", "Not found.");
        String role = roleOf(email);
        if (!isAdmin(role)) throw err(HttpStatus.FORBIDDEN, "NOT_ALLOWED", "Only admins can use development fixtures.");
        MeetingSession s = load(id, email, role);
        if (!s.isSimulated()) throw err(HttpStatus.BAD_REQUEST, "NOT_SIMULATED", "Only simulated meetings can be advanced manually.");
        SessionStatus to;
        try { to = SessionStatus.valueOf(String.valueOf(target)); }
        catch (IllegalArgumentException e) { throw err(HttpStatus.BAD_REQUEST, "INVALID_STATE", "Unknown status."); }
        String failureCode = null, failureMsg = null, recovery = null;
        if (to == SessionStatus.FAILED) {
            failureCode = "SIMULATED_FAILURE";
            failureMsg = "Simulated failure for demonstration.";
            recovery = "Use Retry to try again.";
        }
        return view(transition(s, to, email, "SIMULATED transition", failureCode, failureMsg, recovery), true);
    }

    // ── internals ─────────────────────────────────────────────────────────────

    /** The only place a session's status changes. Enforces the state machine and frees the active key when terminal. */
    private MeetingSession transition(MeetingSession s, SessionStatus to, String by, String note,
                                      String failureCode, String failureMsg, String recovery) {
        SessionStatus from = SessionStatus.valueOf(s.getStatus());
        if (!from.canTransitionTo(to))
            throw err(HttpStatus.CONFLICT, "INVALID_STATE", "This meeting can't change from " + from + " to " + to + ".");
        s.setStatus(to.name());
        s.setStatusDetail(failureMsg != null ? failureMsg : detailFor(to));
        s.setFailureCode(to == SessionStatus.FAILED ? failureCode : null);
        s.setRecoveryAction(to == SessionStatus.FAILED ? recovery : null);
        if (to.isTerminal()) {
            s.setActiveKey(null);
            s.setEndedAt(Instant.now());
        }
        s.setUpdatedAt(Instant.now());
        addHistory(s, from.name(), to.name(), by, note);
        MeetingSession saved = saveSession(s);
        activityLog.log("MEETING_SESSION", saved.getId(), saved.getTitle(), "STATUS_CHANGED", from.name(), to.name(), by);
        return saved;
    }

    private MeetingSession saveSession(MeetingSession s) {
        try {
            return sessions.save(s);
        } catch (OptimisticLockingFailureException e) {
            throw err(HttpStatus.CONFLICT, "CONFLICT", "This meeting was just updated by someone else. Refresh and try again.");
        }
    }

    private static void addHistory(MeetingSession s, String from, String to, String by, String note) {
        MeetingSession.StatusEvent e = new MeetingSession.StatusEvent();
        e.setFrom(from); e.setTo(to); e.setBy(by); e.setNote(note);
        s.getHistory().add(e);
    }

    /** API shape. Deliberately omits internal fields (activeKey, version). */
    private Map<String, Object> view(MeetingSession s, boolean canManage) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", s.getId());
        m.put("provider", s.getProvider());
        m.put("title", s.getTitle());
        m.put("meetingUrl", s.getMeetingUrl());
        m.put("status", s.getStatus());
        m.put("statusDetail", s.getStatusDetail());
        m.put("failureCode", s.getFailureCode());
        m.put("recoveryAction", s.getRecoveryAction());
        m.put("ingestionMode", s.getIngestionMode());
        m.put("projectMode", s.getProjectMode());
        m.put("projectId", s.getProjectId());
        m.put("scheduledFor", s.getScheduledFor() == null ? null : s.getScheduledFor().toString());
        m.put("timezone", s.getTimezone());
        m.put("requestedBy", s.getRequestedBy());
        m.put("captureStatus", s.getCaptureStatus());
        m.put("consentStatus", s.getConsentStatus());
        m.put("visibility", s.getVisibility());
        m.put("sharedWith", s.getSharedWith());
        m.put("simulated", s.isSimulated());
        m.put("retryCount", s.getRetryCount());
        m.put("history", s.getHistory());
        m.put("createdAt", s.getCreatedAt() == null ? null : s.getCreatedAt().toString());
        m.put("updatedAt", s.getUpdatedAt() == null ? null : s.getUpdatedAt().toString());
        m.put("canManage", canManage);
        return m;
    }
}
