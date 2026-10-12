package com.prowosma.backend.service;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.integration.GoogleApiException;
import com.prowosma.backend.integration.GoogleMeetApi;
import com.prowosma.backend.integration.GraphApiException;
import com.prowosma.backend.integration.LlmClient;
import com.prowosma.backend.meetingassistant.MeetingUrlParser;
import com.prowosma.backend.meetingassistant.ConferenceLink;
import com.prowosma.backend.meetingassistant.RecordingRules;
import com.prowosma.backend.meetingassistant.SessionStatus;
import com.prowosma.backend.meetingassistant.TranscriptParser;
import com.prowosma.backend.model.*;
import com.prowosma.backend.repository.*;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
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
    private final MeetingSessionStore store;
    private final MeetingTranscriptService transcripts;
    private final MeetingJobService jobs;
    private final GoogleOAuthService google;
    private final GoogleMeetApi googleApi;
    private final MeetingOutputService outputs;
    private final LlmClient llm;
    private final MeetingActionService actionService;
    private final MeetingCreationService creationService;
    private final TeamsAuthService teamsAuth;
    private final MeetingMetrics metrics;
    private final MeetingJobRunner jobRunner;
    private final MeetingRecordingService recordings;
    private final MeetingFirefliesService firefliesSvc;
    private final MeetingHealthService healthService;

    @Value("${app.meeting-assistant.dev-fixtures-enabled:false}")
    private boolean devFixtures;

    public static final int MAX_UPLOAD_CHARS = 5_000_000;
    /** Provider of a meeting made only to hold an uploaded or pasted transcript — no meeting link, no platform, no meeting that has to be running. */
    public static final String UPLOAD_PROVIDER = "UPLOAD";
    /** Largest transcript FILE accepted (a .docx is compressed, so this is on the file, not on the text). */
    public static final int MAX_TRANSCRIPT_FILE_BYTES = 5_000_000;

    private static MeetingAssistantException err(HttpStatus st, String code, String msg) {
        return new MeetingAssistantException(st, code, msg);
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
        if (patch.containsKey("autoExtractActions"))
            s.setAutoExtractActions(Boolean.parseBoolean(String.valueOf(patch.get("autoExtractActions"))));
        if (patch.containsKey("autoGenerateOutputs"))
            s.setAutoGenerateOutputs(Boolean.parseBoolean(String.valueOf(patch.get("autoGenerateOutputs"))));
        for (String f : List.of("autoCreateTasks", "autoCreateProjects")) {
            if (patch.containsKey(f)) {
                boolean on = Boolean.parseBoolean(String.valueOf(patch.get(f)));
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

        recordings.applySettingsPatch(patch, s);
        firefliesSvc.applySettingsPatch(patch, s);
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
        String org = orgId();
        Map<String, MeetingIntegration> byProvider = new HashMap<>();
        for (MeetingIntegration i : integrations.findByOrganizationId(org)) byProvider.put(i.getProvider(), i);
        List<MeetingIntegration> out = new ArrayList<>();
        for (String p : PROVIDERS) {
            MeetingIntegration i = byProvider.getOrDefault(p, defaultIntegration(p));
            if ("GOOGLE_MEET".equals(p)) {          // derived live, never persisted from here
                long n = google.activeCount(org);
                i.setConnectionStatus(n > 0 ? "CONNECTED" : "NOT_CONNECTED");
                i.setStatusMessage(!google.isConfigured() ? "Google sign-in isn't set up on the server yet."
                        : n > 0 ? n + " Google account(s) connected." : "No one has connected a Google account yet.");
            }
            if ("MS_TEAMS".equals(p)) {
                boolean ready = teamsReady(org);
                i.setConnectionStatus(ready ? "CONNECTED" : "NOT_CONNECTED");
                i.setStatusMessage(!teamsAuth.isConfigured() ? "Microsoft sign-in isn't set up on the server yet."
                        : i.getTenantId() == null ? "Enter your Microsoft tenant id to connect."
                        : ready ? "Connected to your Microsoft 365 tenant." : "Run \"Test connection\" after an admin grants consent.");
            }
            out.add(i);
        }
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
     * Honest health check. For Google Meet it makes one real, read-only API call with the calling admin's own
     * connection. For Teams (no sign-in exists) it says so.
     */
    public Map<String, Object> testConnection(String providerRaw, String email) {
        String provider = normalizeProvider(providerRaw);
        String org = orgId();
        MeetingIntegration i = getOrCreateIntegration(provider);
        boolean healthy = false;
        String message;
        if ("GOOGLE_MEET".equals(provider)) {
            if (!google.isConfigured()) {
                message = "Google sign-in isn't set up on the server. Add the Google OAuth client ID and secret (see docs/MEETING_ASSISTANT.md).";
            } else if (!google.canStoreTokens()) {
                message = "Encryption isn't configured on the server (ENCRYPTION_KEY), so Google sign-ins can't be saved.";
            } else if (!google.hasActiveConnection(org, email)) {
                message = "Your own Google account isn't connected yet. Connect it from this page, then test again.";
            } else {
                try {
                    googleApi.healthCheck(google.accessToken(org, email));
                    healthy = true;
                    message = "Google Meet access works for the account you connected.";
                } catch (MeetingAssistantException e) {
                    message = e.getMessage();
                } catch (GoogleApiException e) {
                    message = switch (e.getKind()) {
                        case UNAUTHORIZED -> "Google rejected the saved sign-in. Reconnect your Google account.";
                        case FORBIDDEN -> "Google denied access. Check that the Meet API is enabled for your Google Cloud project.";
                        default -> "Couldn't reach Google just now. Try again in a minute.";
                    };
                }
            }
        } else {
            if (!teamsAuth.isConfigured()) {
                message = "Microsoft sign-in isn't set up on the server (TEAMS_GRAPH_CLIENT_ID / TEAMS_GRAPH_CLIENT_SECRET). See docs/TEAMS_SETUP.md.";
            } else if (i.getTenantId() == null) {
                message = "Enter your Microsoft tenant id first.";
            } else {
                try {
                    teamsAuth.forget(i.getTenantId());
                    TeamsAuthService.Token t = teamsAuth.token(i.getTenantId());
                    healthy = t.roles().contains(TeamsAuthService.TRANSCRIPT_ROLE);
                    message = healthy
                            ? "The app can sign in and has transcript permission. (Only a real meeting can confirm your organization's application access policy.)"
                            : "The app signed in, but admin consent for \"" + TeamsAuthService.TRANSCRIPT_ROLE + "\" hasn't been granted yet.";
                } catch (GraphApiException e) {
                    message = e.getCode().equals("CONSENT_MISSING") || e.getCode().equals("BAD_SECRET") || e.getCode().equals("TENANT_NOT_FOUND")
                            || e.getCode().equals("REJECTED") || e.getCode().equals("NOT_CONFIGURED") ? e.getMessage()
                            : e.isTransient() ? "Couldn't reach Microsoft just now. Try again in a minute." : "Microsoft didn't accept the sign-in.";
                }
            }
            i.setLastTestHealthy(healthy);
        }
        i.setLastCheckedAt(Instant.now());
        i.setUpdatedBy(email);
        i.setUpdatedAt(Instant.now());
        i.setStatusMessage(message);
        integrations.save(i);
        MeetingIntegration live = listIntegrations().stream().filter(x -> provider.equals(x.getProvider())).findFirst().orElse(i);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("provider", provider);
        out.put("healthy", healthy);
        out.put("connectionStatus", live.getConnectionStatus());
        out.put("message", message);
        out.put("checkedAt", i.getLastCheckedAt().toString());
        return out;
    }

    /** Administrator saves the Microsoft tenant id for Teams. It must be a GUID; the connection counts as healthy only after a successful test. */
    public MeetingIntegration setTeamsTenant(String tenantRaw, String email) {
        String t = tenantRaw == null ? "" : tenantRaw.trim().toLowerCase(Locale.ROOT);
        if (!TeamsAuthService.validTenantId(t))
            throw err(HttpStatus.BAD_REQUEST, "INVALID_TENANT", "A Microsoft tenant id looks like 11111111-2222-3333-4444-555555555555 (Entra admin center → Overview → Tenant ID).");
        MeetingIntegration i = getOrCreateIntegration("MS_TEAMS");
        teamsAuth.forget(i.getTenantId());
        i.setTenantId(t);
        i.setLastTestHealthy(false);
        i.setStatusMessage("Run \"Test connection\" after an admin grants consent.");
        i.setUpdatedBy(email);
        i.setUpdatedAt(Instant.now());
        MeetingIntegration saved = integrations.save(i);
        activityLog.log("MEETING_PLATFORM", saved.getId(), "MS_TEAMS", "TENANT_SET", null, null, email);
        return saved;
    }

    public Map<String, Object> teamsConsentUrl() {
        MeetingIntegration i = getOrCreateIntegration("MS_TEAMS");
        String url = teamsAuth.consentUrl(i.getTenantId());
        if (url == null) throw err(HttpStatus.CONFLICT, "NOT_READY", "Save a valid tenant id first, and make sure Microsoft sign-in is set up on the server.");
        return Map.of("url", url);
    }

    public MeetingIntegration disconnect(String providerRaw, String email) {
        String provider = normalizeProvider(providerRaw);
        MeetingIntegration i = getOrCreateIntegration(provider);
        if ("MS_TEAMS".equals(provider)) { teamsAuth.forget(i.getTenantId()); i.setTenantId(null); i.setLastTestHealthy(false); }
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
    public Map<String, Object> capabilities(String email) {
        String org = orgId();
        MeetingAssistantSettings st = getSettings();
        boolean googleReady = google.isConfigured() && google.canStoreTokens();
        List<Map<String, Object>> platforms = new ArrayList<>();
        boolean anyAuto = false;
        for (MeetingIntegration i : listIntegrations()) {
            boolean isGoogle = "GOOGLE_MEET".equals(i.getProvider());
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("provider", i.getProvider());
            m.put("enabled", i.isEnabled());
            m.put("connectionStatus", i.getConnectionStatus());
            m.put("liveJoin", false);
            m.put("automaticTranscript", isGoogle && googleReady);
            m.put("manualTranscriptUpload", true);
            m.put("connectedForMe", isGoogle && google.hasActiveConnection(org, email));
            boolean isTeams = "MS_TEAMS".equals(i.getProvider());
            boolean teamsOk = isTeams && teamsReady(org);
            if (isTeams) { m.put("automaticTranscript", teamsOk); m.put("orgConnected", teamsOk); }
            platforms.add(m);
            anyAuto |= (isGoogle && googleReady) || teamsOk;
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("assistantName", st.getAssistantName());
        out.put("platforms", platforms);
        out.put("googleConfigured", googleReady);
        String aiReason = llm.notReadyReason(org);
        out.put("aiReady", aiReason == null);
        out.put("aiReason", aiReason);
        out.put("autoGenerate", st.isAutoGenerateOutputs());
        out.put("autoExtract", st.isAutoExtractActions());
        out.put("autoCreateTasks", st.isAutoCreateTasks());
        out.put("autoCreateProjects", st.isAutoCreateProjects());
        Map<String, Object> rec = new LinkedHashMap<>();
        String recWhy = recordings.notReadyReason(st);
        rec.put("enabled", st.isRecordingEnabled());
        rec.put("ready", recWhy == null);
        rec.put("reason", recWhy);
        rec.put("segmentSeconds", RecordingRules.SEGMENT_SECONDS);
        rec.put("maxUploadBytes", RecordingRules.MAX_UPLOAD_BYTES);
        rec.put("retentionHours", RecordingRules.clampRetentionHours(st.getAudioRetentionHours()));
        out.put("recording", rec);
        Map<String, Object> ff = new LinkedHashMap<>();
        String ffWhy = firefliesSvc.notReadyReason(st);
        ff.put("enabled", st.isFirefliesEnabled());
        ff.put("ready", ffWhy == null);
        ff.put("reason", ffWhy);
        out.put("fireflies", ff);
        Map<String, Object> tu = new LinkedHashMap<>();
        tu.put("enabled", true);
        tu.put("maxBytes", MAX_TRANSCRIPT_FILE_BYTES);
        tu.put("formats", List.of("txt", "vtt", "srt", "docx"));
        out.put("transcriptUpload", tu);
        out.put("devFixturesEnabled", devFixtures);
        out.put("note", anyAuto
                ? "Transcripts can be imported automatically (if transcription was on) or added by upload or paste. The assistant can't join meetings live."
                : "Transcripts can be added by upload or paste. Automatic import isn't set up. The assistant can't join meetings live.");
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
        s.setActiveKey(MeetingSessionStore.activeKeyOf(org, provider, parsed.meetingKey(), scheduledFor));
        SessionStatus initial = scheduledFor != null ? SessionStatus.SCHEDULED : SessionStatus.AWAITING_TRANSCRIPT;
        s.setOrganizerId(parsed.organizerId());
        s.setTenantHint(parsed.tenantId());
        boolean auto = !simulated && autoFetchPossible(s, email);
        s.setStatus(initial.name());
        s.setStatusDetail(waitingDetail(provider, initial, auto, google.isConfigured(), teamsReady(org)));
        if ("MS_TEAMS".equals(provider) && parsed.tenantId() != null) {          // a link from someone else's Microsoft organization is never imported with ours
            MeetingIntegration connected = integrations.findByOrganizationIdAndProvider(org, "MS_TEAMS").orElse(null);
            if (connected != null && connected.getTenantId() != null && !parsed.tenantId().equalsIgnoreCase(connected.getTenantId()))
                s.setStatusDetail("This meeting belongs to a different Microsoft organization than the one connected, so its transcript can't be imported automatically. Upload or paste it.");
        }
        MeetingSessionStore.addHistory(s, null, initial.name(), email, "Requested");

        MeetingSession saved;
        try {
            saved = sessions.save(s);
        } catch (DuplicateKeyException dup) {
            throw duplicateError(s.getActiveKey(), email, role);
        }
        metrics.sessionCreated(provider);
        store.audit(org, saved.getId(), email, "CREATED", provider + ", " + saved.getStatus());
        activityLog.log("MEETING_SESSION", saved.getId(), saved.getTitle(), "CREATED", null, saved.getStatus(), email);
        if (auto) enqueueFetch(saved, email, false);
        return saved;
    }

    // ── automatic transcript import (Google Meet) ─────────────────────────────

    private boolean autoFetchPossible(MeetingSession s, String email) {
        String key = s.getMeetingKey();
        String org = s.getOrganizationId();
        if ("GOOGLE_MEET".equals(s.getProvider()))
            return key != null && !key.startsWith("lookup:") && google.isConfigured() && google.canStoreTokens() && google.hasActiveConnection(org, email);
        if ("MS_TEAMS".equals(s.getProvider())) {
            MeetingIntegration integ = integrations.findByOrganizationIdAndProvider(org, "MS_TEAMS").orElse(null);
            return teamsReady(org) && key != null && key.startsWith("19:meeting_") && s.getOrganizerId() != null
                    && (s.getTenantHint() == null || (integ != null && s.getTenantHint().equalsIgnoreCase(integ.getTenantId())));
        }
        return false;
    }

    /** Teams automatic import is available when the server has the app registration and an admin connected AND successfully tested this workspace's tenant. */
    private boolean teamsReady(String org) {
        if (!teamsAuth.isConfigured()) return false;
        MeetingIntegration i = integrations.findByOrganizationIdAndProvider(org, "MS_TEAMS").orElse(null);
        return i != null && i.isEnabled() && i.getTenantId() != null && i.isLastTestHealthy();
    }

    private static String waitingDetail(String provider, SessionStatus st, boolean auto, boolean googleConfigured, boolean teamsReady) {
        if (auto) {
            String where = "MS_TEAMS".equals(provider) ? "Microsoft Teams" : "Google Meet";
            return st == SessionStatus.SCHEDULED
                    ? "Scheduled. Prowosma will look for the transcript on " + where + " after the meeting."
                    : "Waiting for the meeting to finish. Prowosma will import the transcript from " + where + " if transcription was turned on.";
        }
        if ("GOOGLE_MEET".equals(provider)) {
            return googleConfigured
                    ? "Waiting for a transcript. Upload or paste one, or connect your Google account to import it automatically."
                    : "Waiting for a transcript. Upload or paste one.";
        }
        return teamsReady
                ? "Waiting for a transcript. Upload or paste one. Automatic import for Microsoft Teams needs the link from the meeting invitation (it identifies the organizer)."
                : "Waiting for a transcript. Upload or paste one. Automatic import for Microsoft Teams isn't set up.";
    }

    private void enqueueFetch(MeetingSession s, String email, boolean now) {
        Instant t = Instant.now();
        Instant anchor = s.getScheduledFor() != null ? s.getScheduledFor() : s.getCreatedAt();
        Instant runAfter;
        if (now) runAfter = t;
        else if (s.getScheduledFor() != null) runAfter = s.getScheduledFor().plus(5, ChronoUnit.MINUTES).isAfter(t) ? s.getScheduledFor().plus(5, ChronoUnit.MINUTES) : t;
        else runAfter = t.plus(2, ChronoUnit.MINUTES);
        String type = "MS_TEAMS".equals(s.getProvider()) ? TeamsTranscriptFetchHandler.TYPE : GoogleTranscriptFetchHandler.TYPE;
        jobs.enqueue(s.getOrganizationId(), s.getId(), type, email, runAfter, anchor.plus(24, ChronoUnit.HOURS));
    }

    private MeetingAssistantException duplicateError(String activeKey, String email, String role) {
        Map<String, Object> extras = new LinkedHashMap<>();
        sessions.findByActiveKey(activeKey)
                .filter(x -> canAccess(x, email, role))
                .ifPresent(x -> extras.put("existingSessionId", x.getId()));
        return new MeetingAssistantException(HttpStatus.CONFLICT, "DUPLICATE_SESSION",
                "The assistant is already assigned to this meeting occurrence.", extras);
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
        MeetingSession saved = store.transition(s, SessionStatus.CANCELLED, email, "Cancelled by user", null, null, null);
        jobs.cancelForSession(saved.getOrganizationId(), saved.getId());
        activityLog.log("MEETING_SESSION", saved.getId(), saved.getTitle(), "CANCELLED", s.getStatus(), "CANCELLED", email);
        return view(saved, true);
    }

    public Map<String, Object> retry(String id, String email) {
        String role = roleOf(email);
        MeetingSession s = loadManageable(id, email, role);
        if (!SessionStatus.valueOf(s.getStatus()).equals(SessionStatus.FAILED))
            throw err(HttpStatus.CONFLICT, "INVALID_STATE", "Only a failed meeting can be retried.");
        if (s.getSegmentCount() > 0 && s.getTranscriptPurgedAt() == null && !s.isSimulated()) {
            return view(startGeneration(s, email, role), true);       // it has its transcript; what failed was the generation
        }
        boolean recordingRetry = s.getRecordingState() != null && recordings.hasAudio(s.getOrganizationId(), s.getId());
        boolean firefliesRetry = !recordingRetry && "SENT".equals(s.getFirefliesState());          // the notetaker was sent: look for ITS transcript again   // its audio is still stored: turn THAT into text again
        s.setActiveKey(MeetingSessionStore.activeKeyOf(s.getOrganizationId(), s.getProvider(), s.getMeetingKey(), s.getScheduledFor()));
        s.setRetryCount(s.getRetryCount() + 1);
        MeetingSession saved;
        try {
            saved = store.transition(s, SessionStatus.SCHEDULED, email, "Retried by user",
                    recordingRetry ? "Retrying: turning the recording into text again."
                            : firefliesRetry ? "Retrying: looking for the Fireflies transcript again."
                            : "Retrying. " + waitingDetail(s.getProvider(), SessionStatus.AWAITING_TRANSCRIPT, false, google.isConfigured(), teamsReady(s.getOrganizationId())), null, null);
        } catch (DuplicateKeyException dup) {
            throw duplicateError(s.getActiveKey(), email, role);
        }
        if (recordingRetry) {
            recordings.setState(saved.getOrganizationId(), saved.getId(), "UPLOADED");
            jobs.enqueue(saved.getOrganizationId(), saved.getId(), TranscribeRecordingHandler.TYPE, email, Instant.now(),
                    saved.getAudioExpiresAt() != null ? saved.getAudioExpiresAt() : Instant.now().plus(24, ChronoUnit.HOURS));
        } else if (firefliesRetry) {
            firefliesSvc.resumeWaiting(saved, email);
        } else if (!saved.isSimulated() && autoFetchPossible(saved, email)) {
            enqueueFetch(saved, email, true);
        }
        activityLog.log("MEETING_SESSION", saved.getId(), saved.getTitle(), "RETRIED", "FAILED", "SCHEDULED", email);
        return view(saved, true);
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
        MeetingSession saved = store.save(s);
        store.audit(saved.getOrganizationId(), saved.getId(), email, "ACCESS_CHANGED", saved.getVisibility());
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
        return view(store.transition(s, to, email, "SIMULATED transition", failureMsg, failureCode, recovery), true);
    }

    // ── transcripts ───────────────────────────────────────────────────────────

    public record TranscriptUpload(String content, String format, String filename) {}

    /** Adds (or replaces) a transcript from pasted/uploaded text. Only the requester or an admin may do this. */
    public Map<String, Object> uploadTranscript(String id, TranscriptUpload req, String email) {
        String role = roleOf(email);
        MeetingSession s = loadManageable(id, email, role);
        if (req == null || req.content() == null || req.content().isBlank())
            throw err(HttpStatus.BAD_REQUEST, "EMPTY_TRANSCRIPT", "The transcript is empty.");
        if (req.content().length() > MAX_UPLOAD_CHARS)
            throw err(HttpStatus.PAYLOAD_TOO_LARGE, "TRANSCRIPT_TOO_LARGE",
                    "That transcript is larger than 5 MB. Split it into parts and upload them one at a time.");
        if (s.isSimulated()) throw err(HttpStatus.BAD_REQUEST, "SIMULATED", "Simulated meetings can't receive a transcript.");

        TranscriptParser.Parsed parsed = transcripts.parse(req.content(), req.format());
        List<TranscriptSegment> segments = MeetingTranscriptService.fromParsed(parsed, "UPLOAD_" + parsed.format());
        String detail = outputs.receivedDetail(s.getOrganizationId(), segments.size());
        MeetingSession saved = transcripts.receive(s, segments, "UPLOAD", "UPLOADED",
                "Uploaded by " + email + ". Whether it covers the whole meeting can't be verified.", email, detail);
        saved = outputs.startIfEnabled(saved, email);
        jobs.cancelForSession(saved.getOrganizationId(), saved.getId());   // a transcript is here; stop looking for one
        activityLog.log("MEETING_SESSION", saved.getId(), saved.getTitle(), "TRANSCRIPT_ADDED", null, segments.size() + " lines", email);
        Map<String, Object> out = view(saved, true);
        out.put("warnings", parsed.warnings());
        return out;
    }

    // ── a transcript on its own: no meeting link, no running meeting ──────────
    // For a meeting that already happened anywhere (a phone call, a room, Zoom, Meet, Teams, Fireflies, a recording someone else made) —
    // the person has the transcript as a file or as text. Nothing here talks to any meeting platform.

    public record NewTranscript(String content, String format, String filename, String title, String projectId, Boolean consent) {}

    private MeetingSession newUploadSession(String rawTitle, String filename, String projectId, String email) {
        String org = orgId();
        String projId = null;
        String projectMode = "DETECT";
        if (projectId != null && !projectId.isBlank()) {
            Project p = projectRepository.findById(projectId)
                    .filter(x -> org.equals(x.getOrganizationId()))
                    .orElseThrow(() -> err(HttpStatus.BAD_REQUEST, "PROJECT_NOT_FOUND", "That project wasn't found in this workspace."));
            projId = p.getId();
            projectMode = "SELECTED";
        }
        String title = rawTitle == null ? "" : CONTROL.matcher(rawTitle).replaceAll("").trim();
        if (title.length() > 200) throw err(HttpStatus.BAD_REQUEST, "INVALID_TITLE", "The title can be up to 200 characters.");
        if (title.isEmpty()) {
            String fromFile = com.prowosma.backend.meetingassistant.TranscriptFileReader.titleFromFilename(filename);
            title = fromFile != null ? fromFile : "Uploaded transcript";
        }
        String key = "upload:" + UUID.randomUUID();
        MeetingSession s = new MeetingSession();
        s.setOrganizationId(org);
        s.setProvider(UPLOAD_PROVIDER);
        s.setMeetingKey(key);
        s.setTitle(title);
        s.setRequestedBy(email);
        s.setProjectMode(projectMode);
        s.setProjectId(projId);
        s.setTimezone("UTC");
        s.setVisibility(getSettings().getDefaultVisibility());
        s.setActiveKey(MeetingSessionStore.activeKeyOf(org, UPLOAD_PROVIDER, key, null));
        s.setStatus(SessionStatus.AWAITING_TRANSCRIPT.name());
        s.setStatusDetail("Reading the transcript.");
        MeetingSessionStore.addHistory(s, null, SessionStatus.AWAITING_TRANSCRIPT.name(), email, "Created from an uploaded transcript");
        MeetingSession saved = sessions.save(s);
        metrics.sessionCreated(UPLOAD_PROVIDER);
        store.audit(org, saved.getId(), email, "CREATED", UPLOAD_PROVIDER);
        activityLog.log("MEETING_SESSION", saved.getId(), saved.getTitle(), "CREATED", null, saved.getStatus(), email);
        return saved;
    }

    /**
     * Makes a new meeting from a transcript the person already has — a file ({@code file} = its bytes: .txt, .vtt, .srt or .docx) or pasted text ({@code req.content()}) —
     * and starts the normal pipeline: summary, minutes and notes, action items, then the review where tasks and projects are created.
     * The text is read and checked BEFORE the meeting is made, so a bad file never leaves an empty meeting behind.
     */
    public Map<String, Object> uploadTranscriptAsNewMeeting(NewTranscript req, byte[] file, String email) {
        String role = roleOf(email);
        requireSendRole(role);
        if (req == null || !Boolean.TRUE.equals(req.consent()))
            throw err(HttpStatus.BAD_REQUEST, "CONSENT_REQUIRED", "Please confirm you have the right to use this transcript. Its text is sent to the AI provider your workspace uses to write the summary and find the tasks.");
        String text;
        String format = req.format();
        if (file != null) {
            if (file.length > MAX_TRANSCRIPT_FILE_BYTES)
                throw err(HttpStatus.PAYLOAD_TOO_LARGE, "TRANSCRIPT_TOO_LARGE", "That file is larger than 5 MB. Split it into parts and upload them one at a time.");
            com.prowosma.backend.meetingassistant.TranscriptFileReader.Content c = transcripts.readFile(file, req.filename());
            text = c.text();
            if (format == null || format.isBlank()) format = c.formatHint();
        } else {
            text = req.content();
        }
        if (text == null || text.isBlank()) throw err(HttpStatus.BAD_REQUEST, "EMPTY_TRANSCRIPT", "The transcript is empty.");
        if (text.length() > MAX_UPLOAD_CHARS)
            throw err(HttpStatus.PAYLOAD_TOO_LARGE, "TRANSCRIPT_TOO_LARGE", "That transcript is larger than 5 MB of text. Split it into parts and upload them one at a time.");

        TranscriptParser.Parsed parsed = transcripts.parse(text, format);                 // may refuse; nothing exists yet
        List<TranscriptSegment> segments = MeetingTranscriptService.fromParsed(parsed, "UPLOAD_" + parsed.format());
        MeetingSession s = newUploadSession(req.title(), req.filename(), req.projectId(), email);
        MeetingSession saved;
        try {
            saved = transcripts.receive(s, segments, "UPLOAD", "UPLOADED",
                    "Uploaded by " + email + ". Whether it covers the whole meeting can't be verified.", email, outputs.receivedDetail(s.getOrganizationId(), segments.size()));
        } catch (RuntimeException e) {
            cancelQuietly(s, email, "The transcript could not be stored");              // no empty meeting left behind
            throw e;
        }
        saved = outputs.startIfEnabled(saved, email);
        activityLog.log("MEETING_SESSION", saved.getId(), saved.getTitle(), "TRANSCRIPT_ADDED", null, segments.size() + " lines", email);
        Map<String, Object> out = view(store.find(saved.getOrganizationId(), saved.getId()).orElse(saved), true);
        out.put("warnings", parsed.warnings());
        return out;
    }

    // ── recording (browser capture or an uploaded audio file) ─────────────────
    // Entirely separate from the Google Meet / Teams import: nothing below runs unless an admin turned recording on and a person chooses to record or upload.

    public record StartRecordingRequest(String sessionId, String title, String projectId, Boolean consent) {}

    private void requireRecordingReady() {
        String why = recordings.notReadyReason(getSettings());
        if (why != null) throw err(HttpStatus.CONFLICT, "RECORDING_NOT_READY", why);
    }

    /** A meeting made just to hold a recording — for any platform (Meet, Teams, Zoom, a phone call, a room). */
    private MeetingSession newRecordingSession(String rawTitle, String projectId, String email, String role) {
        String org = orgId();
        MeetingAssistantSettings st = getSettings();
        if (!st.getSendRoles().contains(role))
            throw err(HttpStatus.FORBIDDEN, "NOT_ALLOWED", "Your role can't send the meeting assistant. Ask a workspace admin for access.");
        String projId = null;
        String projectMode = "DETECT";
        if (projectId != null && !projectId.isBlank()) {
            Project p = projectRepository.findById(projectId)
                    .filter(x -> org.equals(x.getOrganizationId()))
                    .orElseThrow(() -> err(HttpStatus.BAD_REQUEST, "PROJECT_NOT_FOUND", "That project wasn't found in this workspace."));
            projId = p.getId();
            projectMode = "SELECTED";
        }
        String title = rawTitle == null ? "" : CONTROL.matcher(rawTitle).replaceAll("").trim();
        if (title.length() > 200) throw err(HttpStatus.BAD_REQUEST, "INVALID_TITLE", "The title can be up to 200 characters.");
        if (title.isEmpty()) title = "Recorded meeting";

        MeetingSession s = new MeetingSession();
        String key = "rec:" + UUID.randomUUID();
        s.setOrganizationId(org);
        s.setProvider(MeetingRecordingService.PROVIDER);
        s.setMeetingKey(key);
        s.setTitle(title);
        s.setRequestedBy(email);
        s.setProjectMode(projectMode);
        s.setProjectId(projId);
        s.setTimezone("UTC");
        s.setVisibility(st.getDefaultVisibility());
        s.setActiveKey(MeetingSessionStore.activeKeyOf(org, MeetingRecordingService.PROVIDER, key, null));
        s.setStatus(SessionStatus.AWAITING_TRANSCRIPT.name());
        s.setStatusDetail("Waiting for the recording. Prowosma turns it into text when you stop recording.");
        MeetingSessionStore.addHistory(s, null, SessionStatus.AWAITING_TRANSCRIPT.name(), email, "Requested");
        MeetingSession saved = sessions.save(s);
        metrics.sessionCreated(MeetingRecordingService.PROVIDER);
        store.audit(org, saved.getId(), email, "CREATED", MeetingRecordingService.PROVIDER);
        activityLog.log("MEETING_SESSION", saved.getId(), saved.getTitle(), "CREATED", null, saved.getStatus(), email);
        return saved;
    }

    /** Starts recording: for a new meeting (no sessionId) or for one already registered. The caller must confirm everyone knows. */
    public Map<String, Object> startRecording(StartRecordingRequest req, String email) {
        String role = roleOf(email);
        if (req == null || !Boolean.TRUE.equals(req.consent()))
            throw err(HttpStatus.BAD_REQUEST, "CONSENT_REQUIRED", "Please confirm that everyone in the meeting knows it is being recorded and turned into text.");
        requireRecordingReady();
        MeetingSession s = req.sessionId() != null && !req.sessionId().isBlank()
                ? loadManageable(req.sessionId(), email, role)
                : newRecordingSession(req.title(), req.projectId(), email, role);
        recordings.start(s);
        store.audit(s.getOrganizationId(), s.getId(), email, "RECORDING_STARTED", null);
        return view(store.find(s.getOrganizationId(), s.getId()).orElse(s), true);
    }

    /** One short, self-contained piece of audio. Kept light: it is called every few minutes while a meeting runs. */
    public Map<String, Object> recordingChunk(String id, String track, int seq, long startMs, long durationMs, byte[] data, String email) {
        MeetingSession s = loadManageable(id, email, roleOf(email));
        recordings.storeChunk(s, track, seq, startMs, durationMs, data);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("seq", seq);
        return out;
    }

    public Map<String, Object> finishRecording(String id, String email) {
        MeetingSession s = loadManageable(id, email, roleOf(email));
        String state = s.getRecordingState();
        if ("UPLOADED".equals(state) || "TRANSCRIBING".equals(state) || "DONE".equals(state)) return view(s, true);      // finishing twice is harmless
        if (!"RECORDING".equals(state)) throw err(HttpStatus.CONFLICT, "NOT_RECORDING", "This meeting isn't being recorded.");
        recordings.finish(s, email);
        store.audit(s.getOrganizationId(), s.getId(), email, "RECORDING_FINISHED", null);
        activityLog.log("MEETING_SESSION", s.getId(), s.getTitle(), "RECORDING_ADDED", null, null, email);
        return view(store.find(s.getOrganizationId(), s.getId()).orElse(s), true);
    }

    /** A recording made some other way: attach it to an existing meeting, or (no id) make a new meeting for it. */
    public Map<String, Object> uploadRecording(String id, String title, String projectId, byte[] data, boolean consent, String email) {
        String role = roleOf(email);
        if (!consent)
            throw err(HttpStatus.BAD_REQUEST, "CONSENT_REQUIRED", "Please confirm you have the right to use this recording and that its participants know it is being turned into text.");
        requireRecordingReady();
        boolean created = id == null || id.isBlank();
        MeetingSession s = created ? newRecordingSession(title, projectId, email, role) : loadManageable(id, email, role);
        try {
            recordings.uploadFile(s, data, email);
        } catch (RuntimeException e) {
            if (created) {
                try { store.transition(s, SessionStatus.CANCELLED, email, "Recording upload failed", null, null, null); } catch (RuntimeException ignored) { /* already gone */ }
            }
            throw e;
        }
        store.audit(s.getOrganizationId(), s.getId(), email, "RECORDING_UPLOADED", null);
        activityLog.log("MEETING_SESSION", s.getId(), s.getTitle(), "RECORDING_ADDED", null, null, email);
        return view(store.find(s.getOrganizationId(), s.getId()).orElse(s), true);
    }

    /** Deletes the stored audio now. A transcript that was already made from it is not touched. */
    public Map<String, Object> deleteRecordingAudio(String id, String email) {
        MeetingSession s = loadManageable(id, email, roleOf(email));
        recordings.deleteAudioOnRequest(s);
        store.audit(s.getOrganizationId(), s.getId(), email, "AUDIO_DELETED", null);
        return view(store.find(s.getOrganizationId(), s.getId()).orElse(s), true);
    }

    /** Admin: does the configured speech-to-text server answer? */
    public Map<String, Object> testSpeechToText() {
        return recordings.testConnection(getSettings());
    }

    // ── Fireflies notetaker (any platform it can join) ────────────────────────
    // Separate from the Google Meet / Teams import and from recording: nothing below runs unless an admin turned Fireflies on and a person chooses to use it.

    public record FirefliesNotetakerRequest(String sessionId, String meetingUrl, String title, String projectId, Boolean consent) {}

    public record FirefliesImportRequest(String transcriptId, String title, String projectId, Boolean consent) {}

    private void requireFirefliesReady() {
        String why = firefliesSvc.notReadyReason(getSettings());
        if (why != null) throw err(HttpStatus.CONFLICT, "FIREFLIES_NOT_READY", why);
    }

    private void requireSendRole(String role) {
        if (!getSettings().getSendRoles().contains(role))
            throw err(HttpStatus.FORBIDDEN, "NOT_ALLOWED", "Your role can't send the meeting assistant. Ask a workspace admin for access.");
    }

    /** A meeting made for a Fireflies notetaker or import. {@code link} may be null (an import whose meeting link isn't one we recognise). */
    private MeetingSession newFirefliesSession(String rawTitle, String projectId, String email, String key, ConferenceLink.Link link) {
        String org = orgId();
        String projId = null;
        String projectMode = "DETECT";
        if (projectId != null && !projectId.isBlank()) {
            Project p = projectRepository.findById(projectId)
                    .filter(x -> org.equals(x.getOrganizationId()))
                    .orElseThrow(() -> err(HttpStatus.BAD_REQUEST, "PROJECT_NOT_FOUND", "That project wasn't found in this workspace."));
            projId = p.getId();
            projectMode = "SELECTED";
        }
        String title = rawTitle == null ? "" : CONTROL.matcher(rawTitle).replaceAll("").trim();
        if (title.length() > 200) title = title.substring(0, 200);
        if (title.isEmpty()) title = link == null ? "Fireflies meeting" : ConferenceLink.platformName(link.platform()) + " meeting";

        MeetingSession s = new MeetingSession();
        s.setOrganizationId(org);
        s.setProvider(MeetingFirefliesService.PROVIDER);
        s.setMeetingKey(key);
        s.setMeetingUrl(link == null ? null : link.url());
        s.setPlatform(link == null ? null : link.platform());
        s.setTitle(title);
        s.setRequestedBy(email);
        s.setProjectMode(projectMode);
        s.setProjectId(projId);
        s.setTimezone("UTC");
        s.setVisibility(getSettings().getDefaultVisibility());
        s.setActiveKey(MeetingSessionStore.activeKeyOf(org, MeetingFirefliesService.PROVIDER, key, null));
        s.setStatus(SessionStatus.AWAITING_TRANSCRIPT.name());
        s.setStatusDetail("Waiting for the Fireflies transcript.");
        MeetingSessionStore.addHistory(s, null, SessionStatus.AWAITING_TRANSCRIPT.name(), email, "Requested");
        MeetingSession saved;
        try {
            saved = sessions.save(s);
        } catch (DuplicateKeyException already) {
            throw err(HttpStatus.CONFLICT, "ALREADY_REGISTERED", "This meeting is already registered in Prowosma with a Fireflies notetaker. Open it from the list instead.");
        }
        metrics.sessionCreated(MeetingFirefliesService.PROVIDER);
        store.audit(org, saved.getId(), email, "CREATED", MeetingFirefliesService.PROVIDER);
        activityLog.log("MEETING_SESSION", saved.getId(), saved.getTitle(), "CREATED", null, saved.getStatus(), email);
        return saved;
    }

    private void cancelQuietly(MeetingSession s, String email, String why) {
        try { store.transition(s, SessionStatus.CANCELLED, email, why, null, null, null); } catch (RuntimeException ignored) { /* already gone */ }
    }

    /** Sends the Fireflies notetaker into a RUNNING meeting — a new one (meetingUrl) or one already registered (sessionId) — and starts waiting for its transcript. */
    public Map<String, Object> sendFirefliesNotetaker(FirefliesNotetakerRequest req, String email) {
        String role = roleOf(email);
        requireSendRole(role);
        if (req == null || !Boolean.TRUE.equals(req.consent()))
            throw err(HttpStatus.BAD_REQUEST, "CONSENT_REQUIRED", "Please confirm that everyone in the meeting knows a Fireflies notetaker will join, record and transcribe it.");
        requireFirefliesReady();
        boolean attach = req.sessionId() != null && !req.sessionId().isBlank();
        MeetingSession s;
        ConferenceLink.Link link;
        boolean created = !attach;
        try {
            if (attach) {
                s = loadManageable(req.sessionId(), email, role);
                if (s.getMeetingUrl() == null || s.getMeetingUrl().isBlank())
                    throw err(HttpStatus.BAD_REQUEST, "NO_MEETING_LINK", "This meeting has no meeting link, so the notetaker can't be sent to it.");
                link = ConferenceLink.parse(s.getMeetingUrl());
                if (!"SCHEDULED".equals(s.getStatus()) && !"AWAITING_TRANSCRIPT".equals(s.getStatus()))
                    throw err(HttpStatus.CONFLICT, "INVALID_STATE", "This meeting isn't waiting for a transcript, so a notetaker can't be sent to it.");
                if ("SENT".equals(s.getFirefliesState()))
                    throw err(HttpStatus.CONFLICT, "ALREADY_SENT", "A Fireflies notetaker was already sent to this meeting. Prowosma is waiting for its transcript.");
            } else {
                link = ConferenceLink.parse(req.meetingUrl());
                s = newFirefliesSession(req.title(), req.projectId(), email, link.key(), link);
            }
        } catch (IllegalArgumentException bad) {
            throw err(HttpStatus.BAD_REQUEST, "INVALID_MEETING_LINK", bad.getMessage());
        }
        try {
            firefliesSvc.sendNotetaker(s, link, req.title() != null && !req.title().isBlank() ? req.title() : s.getTitle(), email);
        } catch (RuntimeException e) {
            if (created) cancelQuietly(s, email, "Notetaker could not be sent");          // no empty meeting left behind
            throw e;
        }
        store.audit(s.getOrganizationId(), s.getId(), email, "NOTETAKER_SENT", link.platform());
        activityLog.log("MEETING_SESSION", s.getId(), s.getTitle(), "NOTETAKER_SENT", null, null, email);
        return view(store.find(s.getOrganizationId(), s.getId()).orElse(s), true);
    }

    /** The workspace's recent Fireflies meetings, for the "import" picker. */
    public List<Map<String, Object>> listFirefliesRecent(String email) {
        requireSendRole(roleOf(email));
        requireFirefliesReady();
        try {
            return firefliesSvc.recentForPicker(orgId());
        } catch (com.prowosma.backend.integration.FirefliesException e) {
            throw MeetingFirefliesService.toApiError(e);
        }
    }

    /** Brings a transcript Fireflies already has into Prowosma as a new meeting (no notetaker needed — for example meetings Fireflies joined from your calendar). */
    public Map<String, Object> importFromFireflies(FirefliesImportRequest req, String email) {
        String role = roleOf(email);
        requireSendRole(role);
        if (req == null || !Boolean.TRUE.equals(req.consent()))
            throw err(HttpStatus.BAD_REQUEST, "CONSENT_REQUIRED", "Please confirm you have the right to import this transcript into Prowosma.");
        requireFirefliesReady();
        String org = orgId();
        String id = req.transcriptId() == null ? "" : req.transcriptId().trim();
        if (id.isEmpty()) throw err(HttpStatus.BAD_REQUEST, "INVALID_TRANSCRIPT", "Choose a Fireflies meeting to import.");
        if (firefliesSvc.isClaimed(org, id)) throw err(HttpStatus.CONFLICT, "ALREADY_IMPORTED", "That Fireflies meeting was already imported into Prowosma.");

        com.prowosma.backend.integration.FirefliesApi.Transcript t;
        try {
            t = firefliesSvc.transcript(firefliesSvc.apiKey(getSettings()), id).orElse(null);
        } catch (com.prowosma.backend.integration.FirefliesException e) {
            throw MeetingFirefliesService.toApiError(e);
        }
        if (t == null) throw err(HttpStatus.CONFLICT, "FIREFLIES_PROCESSING", "Fireflies is still processing that meeting. Try again in a few minutes.");
        if (t.live()) throw err(HttpStatus.CONFLICT, "FIREFLIES_LIVE", "That meeting is still in progress in Fireflies. Import it after it ends.");
        List<com.prowosma.backend.meetingassistant.FirefliesMapper.Line> lines = com.prowosma.backend.meetingassistant.FirefliesMapper.toLines(t.sentences(), t.durationMinutes());
        if (lines.isEmpty()) throw err(HttpStatus.CONFLICT, "NO_TEXT", "That Fireflies meeting has no transcript text to import.");
        if (lines.size() > TranscriptParser.MAX_SEGMENTS) throw err(HttpStatus.CONFLICT, "TRANSCRIPT_TOO_LONG", "That transcript is too long to import in one go.");

        ConferenceLink.Link link = null;
        try { link = ConferenceLink.parse(t.meetingLink()); } catch (RuntimeException ignored) { /* a link we don't recognise: the transcript is still importable */ }
        MeetingSession s = newFirefliesSession(req.title() != null && !req.title().isBlank() ? req.title() : t.title(), req.projectId(), email, "ffimport:" + id, link);
        if (!firefliesSvc.claim(org, s.getId(), id)) {
            cancelQuietly(s, email, "Already imported");
            throw err(HttpStatus.CONFLICT, "ALREADY_IMPORTED", "That Fireflies meeting was already imported into Prowosma.");
        }
        List<com.prowosma.backend.model.TranscriptSegment> segments = new ArrayList<>();
        for (com.prowosma.backend.meetingassistant.FirefliesMapper.Line l : lines) {
            com.prowosma.backend.model.TranscriptSegment seg = new com.prowosma.backend.model.TranscriptSegment();
            seg.setText(l.text());
            seg.setSpeakerLabel(l.speaker());
            seg.setStartMs(l.startMs());
            seg.setEndMs(l.endMs());
            seg.setSource("FIREFLIES");
            segments.add(seg);
        }
        MeetingSession saved = transcripts.receive(s, segments, "FIREFLIES", "NOTETAKER",
                "Imported from Fireflies. Speaker names come from Fireflies, and its speech recognition can make mistakes.", email, outputs.receivedDetail(org, segments.size()));
        firefliesSvc.markImported(org, saved.getId());
        saved = outputs.startIfEnabled(saved, email);
        store.audit(org, saved.getId(), email, "FIREFLIES_IMPORTED", null);
        return view(store.find(org, saved.getId()).orElse(saved), true);
    }

    /** Admin: does the saved Fireflies key work? */
    public Map<String, Object> testFireflies() {
        return firefliesSvc.testConnection(getSettings());
    }

    public Map<String, Object> getTranscript(String id, int afterSeq, int limit, String email) {
        MeetingSession s = load(id, email, roleOf(email));
        List<Map<String, Object>> segs = transcripts.page(s, afterSeq, limit);
        int last = segs.isEmpty() ? 0 : (Integer) segs.get(segs.size() - 1).get("seq");
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("sessionId", s.getId());
        out.put("source", s.getTranscriptSource());
        out.put("captureStatus", s.getCaptureStatus());
        out.put("note", s.getTranscriptNote());
        out.put("total", s.getSegmentCount());
        out.put("removedByRetention", s.getTranscriptPurgedAt() != null);
        out.put("segments", segs);
        out.put("nextAfter", (!segs.isEmpty() && last < s.getSegmentCount()) ? last : null);
        return out;
    }

    public Map<String, Object> deleteTranscript(String id, String email) {
        String role = roleOf(email);
        MeetingSession s = loadManageable(id, email, role);
        SessionStatus st = SessionStatus.valueOf(s.getStatus());
        if (s.getTranscriptGeneration() <= 0 || s.getSegmentCount() == 0)
            throw err(HttpStatus.CONFLICT, "NO_TRANSCRIPT", "This meeting has no transcript to delete.");
        if (st != SessionStatus.TRANSCRIPT_RECEIVED && st != SessionStatus.FAILED && st != SessionStatus.CANCELLED && st != SessionStatus.COMPLETED)
            throw err(HttpStatus.CONFLICT, "TRANSCRIPT_LOCKED", "The transcript can't be deleted while the meeting is being processed.");
        MeetingSession saved = transcripts.delete(s, email);
        activityLog.log("MEETING_SESSION", saved.getId(), saved.getTitle(), "TRANSCRIPT_DELETED", null, null, email);
        return view(saved, true);
    }

    /** "Check now": runs the automatic import immediately (Google: with the caller's own Google access; Teams: with the organization's connection). */
    public Map<String, Object> fetchNow(String id, String email) {
        String role = roleOf(email);
        MeetingSession s = loadManageable(id, email, role);
        SessionStatus st = SessionStatus.valueOf(s.getStatus());
        if (st != SessionStatus.SCHEDULED && st != SessionStatus.AWAITING_TRANSCRIPT)
            throw err(HttpStatus.CONFLICT, "INVALID_STATE", "This meeting isn't waiting for a transcript.");
        if (s.isSimulated()) throw err(HttpStatus.BAD_REQUEST, "SIMULATED", "Simulated meetings never contact Google or Microsoft.");
        if (!autoFetchPossible(s, email)) {
            if ("MS_TEAMS".equals(s.getProvider()))
                throw err(HttpStatus.CONFLICT, "TEAMS_NOT_READY", "Automatic import isn't ready for this Teams meeting. An admin must connect and test Microsoft Teams, and the link must be the "
                        + "\"Join the meeting\" link from the invitation (it identifies the organizer). You can upload or paste the transcript instead.");
            throw err(HttpStatus.CONFLICT, "GOOGLE_NOT_CONNECTED",
                    "Connect your Google account first (and make sure Google sign-in is set up on the server). This link type must also be a standard meet.google.com code.");
        }
        enqueueFetch(s, email, true);
        store.audit(s.getOrganizationId(), s.getId(), email, "FETCH_REQUESTED", null);
        // Look at the platform RIGHT NOW and say what it answered, instead of queueing and hoping the background poller runs soon.
        String type = "MS_TEAMS".equals(s.getProvider()) ? TeamsTranscriptFetchHandler.TYPE : GoogleTranscriptFetchHandler.TYPE;
        try {
            jobRunner.runNow(s.getOrganizationId(), type, s.getId());
        } catch (RuntimeException e) {
            // never fail the button: the job stays queued and the background poller tries again
        }
        return view(store.find(s.getOrganizationId(), s.getId()).orElse(s), true);
    }

    // ── summary, minutes, notes ──────────────────────────────────────────────

    public Map<String, Object> generateOutputs(String id, String email) {
        String role = roleOf(email);
        MeetingSession s = loadManageable(id, email, role);
        return view(startGeneration(s, email, role), true);
    }

    private MeetingSession startGeneration(MeetingSession s, String email, String role) {
        final String org = s.getOrganizationId();
        if (s.isSimulated()) throw err(HttpStatus.BAD_REQUEST, "SIMULATED", "Simulated meetings have no transcript to summarise.");
        if (s.getSegmentCount() <= 0 || s.getTranscriptPurgedAt() != null)
            throw err(HttpStatus.CONFLICT, "NO_TRANSCRIPT", "There is no transcript to summarise yet. Add one first.");
        SessionStatus st = SessionStatus.valueOf(s.getStatus());
        if (st != SessionStatus.TRANSCRIPT_RECEIVED && st != SessionStatus.READY_FOR_REVIEW && st != SessionStatus.FAILED)
            throw err(HttpStatus.CONFLICT, "INVALID_STATE", st == SessionStatus.PROCESSING
                    ? "The summary is already being generated." : "This meeting can't be summarised right now.");
        String reason = llm.notReadyReason(org);
        if (reason != null) throw err(HttpStatus.CONFLICT, "AI_NOT_CONFIGURED", reason);
        if (outputs.rateLimited(org))
            throw err(HttpStatus.TOO_MANY_REQUESTS, "RATE_LIMITED", "Too many summaries were requested in the last hour. Please try again a little later.");
        MeetingSession saved;
        try {
            saved = outputs.start(s, email);
        } catch (DuplicateKeyException dup) {
            throw duplicateError(s.getActiveKey(), email, role);
        }
        activityLog.log("MEETING_SESSION", saved.getId(), saved.getTitle(), "GENERATION_REQUESTED", s.getStatus(), "PROCESSING", email);
        return saved;
    }

    public Map<String, Object> artifacts(String id, String email) {
        return outputs.artifacts(load(id, email, roleOf(email)));
    }

    public List<Map<String, Object>> artifactVersions(String id, String type, String email) {
        return outputs.versions(load(id, email, roleOf(email)), type);
    }

    public Map<String, Object> artifactVersion(String id, String type, int version, String email) {
        return outputs.version(load(id, email, roleOf(email)), type, version);
    }

    public List<Map<String, Object>> artifactDiff(String id, String type, int from, int to, String email) {
        return outputs.diff(load(id, email, roleOf(email)), type, from, to);
    }

    public Map<String, Object> editArtifact(String id, String type, int baseVersion, String markdown, String email) {
        MeetingSession s = loadManageable(id, email, roleOf(email));
        Map<String, Object> out = outputs.edit(s, type, baseVersion, markdown, email);
        activityLog.log("MEETING_SESSION", s.getId(), s.getTitle(), "DOCUMENT_EDITED", null, type, email);
        return out;
    }

    public Map<String, Object> restoreArtifact(String id, String type, int fromVersion, String email) {
        MeetingSession s = loadManageable(id, email, roleOf(email));
        Map<String, Object> out = outputs.restore(s, type, fromVersion, email);
        activityLog.log("MEETING_SESSION", s.getId(), s.getTitle(), "DOCUMENT_RESTORED", null, type, email);
        return out;
    }

    public Map<String, Object> acceptPending(String id, String type, String email) {
        MeetingSession s = loadManageable(id, email, roleOf(email));
        outputs.acceptPending(s, type, email);
        activityLog.log("MEETING_SESSION", s.getId(), s.getTitle(), "PENDING_ACCEPTED", null, type, email);
        return outputs.artifacts(s);
    }

    public Map<String, Object> dismissPending(String id, String type, String email) {
        MeetingSession s = loadManageable(id, email, roleOf(email));
        outputs.dismissPending(s, type, email);
        return outputs.artifacts(s);
    }

    // ── structured actions & review ──────────────────────────────────────────

    public Map<String, Object> extractActions(String id, String email) {
        String role = roleOf(email);
        MeetingSession s = loadManageable(id, email, role);
        if (s.isSimulated()) throw err(HttpStatus.BAD_REQUEST, "SIMULATED", "Simulated meetings have no transcript to analyse.");
        if (s.getSegmentCount() <= 0 || s.getTranscriptPurgedAt() != null)
            throw err(HttpStatus.CONFLICT, "NO_TRANSCRIPT", "There is no transcript to analyse yet. Add one first.");
        String reason = llm.notReadyReason(s.getOrganizationId());
        if (reason != null) throw err(HttpStatus.CONFLICT, "AI_NOT_CONFIGURED", reason);
        if ("RUNNING".equals(s.getActionsStatus()) && jobs.find(s.getOrganizationId(), s.getId(), MeetingActionService.JOB_TYPE)
                .filter(j -> "QUEUED".equals(j.getStatus()) || "RUNNING".equals(j.getStatus())).isPresent())
            throw err(HttpStatus.CONFLICT, "ALREADY_RUNNING", "Actions are already being extracted.");
        if (outputs.rateLimited(s.getOrganizationId()))
            throw err(HttpStatus.TOO_MANY_REQUESTS, "RATE_LIMITED", "Too many AI requests in the last hour. Please try again a little later.");
        actionService.enqueue(s, email);
        activityLog.log("MEETING_SESSION", s.getId(), s.getTitle(), "ACTIONS_REQUESTED", null, null, email);
        return view(store.find(s.getOrganizationId(), s.getId()).orElse(s), true);
    }

    public Map<String, Object> actions(String id, String email) {
        return actionService.list(load(id, email, roleOf(email)));
    }

    public Map<String, Object> patchAction(String id, String actionId, Map<String, Object> patch, String email) {
        MeetingSession s = loadManageable(id, email, roleOf(email));
        Map<String, Object> out = actionService.patch(s, actionId, patch, email);
        activityLog.log("MEETING_SESSION", s.getId(), s.getTitle(), "ACTION_EDITED", null, actionId, email);
        return out;
    }

    public Map<String, Object> decideAction(String id, String actionId, String decision, String email) {
        MeetingSession s = loadManageable(id, email, roleOf(email));
        Map<String, Object> out = actionService.decide(s, actionId, decision, email);
        activityLog.log("MEETING_SESSION", s.getId(), s.getTitle(), "ACTION_" + String.valueOf(decision).toUpperCase(Locale.ROOT), null, actionId, email);
        return out;
    }

    public Map<String, Object> mergeAction(String id, String actionId, String intoId, String email) {
        MeetingSession s = loadManageable(id, email, roleOf(email));
        return actionService.merge(s, actionId, intoId, email);
    }

    public Map<String, Object> approveValidActions(String id, String email) {
        return actionService.approveValid(loadManageable(id, email, roleOf(email)), email);
    }

    public Map<String, Object> resolveActionsDiff(String id, boolean apply, String email) {
        return actionService.resolveDiff(loadManageable(id, email, roleOf(email)), apply, email);
    }

    /** Review mode: creates ALL approved projects and tasks now, as the person pressing the button. */
    public Map<String, Object> createApproved(String id, String email) {
        MeetingSession s = loadManageable(id, email, roleOf(email));
        if (s.isSimulated()) throw err(HttpStatus.BAD_REQUEST, "SIMULATED", "Simulated meetings can't create real records.");
        Map<String, Object> out = creationService.createApproved(s, email);
        activityLog.log("MEETING_SESSION", s.getId(), s.getTitle(), "RECORDS_CREATED", null, out.get("created") + " created, " + out.get("failed") + " failed", email);
        return out;
    }

    public Map<String, Object> actionsPreview(String id, String email) {
        return actionService.preview(load(id, email, roleOf(email)));
    }

    public Map<String, Object> patchProposedProject(String id, String projectId, Map<String, Object> patch, String email) {
        return actionService.patchProject(loadManageable(id, email, roleOf(email)), projectId, patch, email);
    }

    public Map<String, Object> decideProposedProject(String id, String projectId, String decision, String email) {
        return actionService.decideProject(loadManageable(id, email, roleOf(email)), projectId, decision, email);
    }

    public Map<String, Object> health() {
        return healthService.summary(orgId());
    }

    public Map<String, Object> aiUsage(int days) {
        return outputs.usage(orgId(), days);
    }

    // ── Google account connection (per person) ────────────────────────────────

    public Map<String, Object> googleConnection(String email) {
        String org = orgId();
        Optional<MeetingUserConnection> c = google.connection(org, email);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("configured", google.isConfigured());
        out.put("canStoreTokens", google.canStoreTokens());
        out.put("connected", c.filter(x -> "ACTIVE".equals(x.getStatus())).isPresent());
        out.put("status", c.map(MeetingUserConnection::getStatus).orElse("NOT_CONNECTED"));
        out.put("account", c.map(MeetingUserConnection::getAccount).orElse(null));
        return out;
    }

    public Map<String, Object> googleAuthorize(String email) {
        String role = roleOf(email);
        if ("NONE".equals(role) || "VIEWER".equals(role))
            throw err(HttpStatus.FORBIDDEN, "NOT_ALLOWED", "Your role can't connect a Google account.");
        return Map.of("url", google.authorizeUrl(orgId(), email));
    }

    public Map<String, Object> googleComplete(String code, String state, String email) {
        String role = roleOf(email);
        if ("NONE".equals(role) || "VIEWER".equals(role))
            throw err(HttpStatus.FORBIDDEN, "NOT_ALLOWED", "Your role can't connect a Google account.");
        google.complete(orgId(), email, code, state);
        activityLog.log("MEETING_PLATFORM", "GOOGLE_MEET", "GOOGLE_MEET", "ACCOUNT_CONNECTED", null, null, email);
        return googleConnection(email);
    }

    public Map<String, Object> googleDisconnect(String email) {
        google.disconnect(orgId(), email);
        activityLog.log("MEETING_PLATFORM", "GOOGLE_MEET", "GOOGLE_MEET", "ACCOUNT_DISCONNECTED", null, null, email);
        return googleConnection(email);
    }

    // ── internals ─────────────────────────────────────────────────────────────

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
        m.put("transcriptSource", s.getTranscriptSource());
        m.put("segmentCount", s.getSegmentCount());
        m.put("transcriptNote", s.getTranscriptNote());
        m.put("transcriptReceivedAt", s.getTranscriptReceivedAt() == null ? null : s.getTranscriptReceivedAt().toString());
        m.put("transcriptRemovedByRetention", s.getTranscriptPurgedAt() != null);
        m.put("outputsGeneratedAt", s.getOutputsGeneratedAt() == null ? null : s.getOutputsGeneratedAt().toString());
        m.put("actionsStatus", s.getActionsStatus());
        m.put("actionsMessage", s.getActionsMessage());
        m.put("actionsExtractedAt", s.getActionsExtractedAt() == null ? null : s.getActionsExtractedAt().toString());
        m.put("actionsPendingDiff", s.isActionsPendingDiff());
        if (s.getLastCheckAt() != null) {
            Map<String, Object> check = new LinkedHashMap<>();
            check.put("at", s.getLastCheckAt().toString());
            check.put("code", s.getLastCheckCode());
            check.put("message", s.getLastCheckMessage());
            check.put("facts", s.getLastCheckFacts() == null ? Map.of() : s.getLastCheckFacts());
            m.put("lastCheck", check);
        }
        if (s.getRecordingState() != null || s.getAudioDeletedAt() != null) {
            Map<String, Object> rec = new LinkedHashMap<>();
            rec.put("state", s.getRecordingState());
            rec.put("startedAt", s.getRecordingStartedAt() == null ? null : s.getRecordingStartedAt().toString());
            rec.put("finishedAt", s.getRecordingFinishedAt() == null ? null : s.getRecordingFinishedAt().toString());
            rec.put("audioExpiresAt", s.getAudioExpiresAt() == null ? null : s.getAudioExpiresAt().toString());
            rec.put("audioDeletedAt", s.getAudioDeletedAt() == null ? null : s.getAudioDeletedAt().toString());
            m.put("recording", rec);
        }
        if (s.getPlatform() != null) m.put("platform", s.getPlatform());
        if (s.getFirefliesState() != null) {
            Map<String, Object> ff = new LinkedHashMap<>();
            ff.put("state", s.getFirefliesState());
            ff.put("platform", s.getPlatform());
            ff.put("platformName", ConferenceLink.platformName(s.getPlatform()));
            ff.put("sentAt", s.getNotetakerSentAt() == null ? null : s.getNotetakerSentAt().toString());
            m.put("fireflies", ff);
        }
        SessionStatus viewStatus = SessionStatus.valueOf(s.getStatus());
        if (viewStatus == SessionStatus.SCHEDULED || viewStatus == SessionStatus.AWAITING_TRANSCRIPT) {   // when Prowosma will look again by itself
            String jobType = "MS_TEAMS".equals(s.getProvider()) ? TeamsTranscriptFetchHandler.TYPE : GoogleTranscriptFetchHandler.TYPE;
            jobs.find(s.getOrganizationId(), s.getId(), jobType).filter(j -> "QUEUED".equals(j.getStatus()) && j.getRunAfter() != null)
                    .ifPresent(j -> m.put("nextCheckAt", j.getRunAfter().toString()));
        }
        m.put("canExtract", canManage && !s.isSimulated() && s.getSegmentCount() > 0 && s.getTranscriptPurgedAt() == null
                && !"RUNNING".equals(s.getActionsStatus()));
        SessionStatus vs = SessionStatus.valueOf(s.getStatus());
        m.put("canGenerate", canManage && !s.isSimulated() && s.getSegmentCount() > 0 && s.getTranscriptPurgedAt() == null
                && (vs == SessionStatus.TRANSCRIPT_RECEIVED || vs == SessionStatus.READY_FOR_REVIEW || vs == SessionStatus.FAILED));
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
