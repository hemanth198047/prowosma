package com.prowosma.backend.uma.web;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.uma.app.UmaExporter;
import com.prowosma.backend.uma.app.UmaService;
import com.prowosma.backend.uma.core.UmaException;
import com.prowosma.backend.uma.model.*;
import com.prowosma.backend.uma.provider.MeetingProviderAdapter;
import com.prowosma.backend.uma.provider.ProviderRegistry;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.time.Instant;
import java.util.*;

/** Universal AI Meeting Assistant. Separate from /api/meeting-assistant (the existing feature), which is untouched. */
@RestController
@RequestMapping("/api/v2/meeting-assistant")
@Tag(name = "AI Meeting Assistant (v2)", description = "Recording/transcript/link based meeting intelligence; behind the universalMeetingAssistant flag")
public class UmaController {
    private final UmaService service;
    private final WorkspaceContext workspace;
    private final ProviderRegistry providers;

    public UmaController(UmaService service, WorkspaceContext workspace, ProviderRegistry providers) {
        this.service = service; this.workspace = workspace; this.providers = providers;
    }

    private UmaService.Ctx ctx(Authentication auth) {
        if (auth == null) throw new UmaException(HttpStatus.UNAUTHORIZED, "SIGN_IN", "Please sign in again.");
        return service.ctx(workspace.getWorkspaceId(), auth.getName());
    }

    private static Instant instant(String s) {
        if (s == null || s.isBlank()) return null;
        try { return Instant.parse(s); } catch (Exception e) {
            throw new UmaException(HttpStatus.BAD_REQUEST, "INVALID_DATE", "The meeting time isn't a valid date.");
        }
    }

    /** Whether the feature is on for this workspace. Never 404s, so the app can decide whether to show the menu item. */
    @GetMapping("/status")
    public Map<String, Object> status() { return service.readiness(workspace.getWorkspaceId()); }

    @GetMapping("/dashboard")
    public Map<String, Object> dashboard(Authentication auth) { return service.dashboard(ctx(auth)); }

    @GetMapping("/providers")
    public List<Map<String, Object>> providerList(Authentication auth) {
        ctx(auth);
        List<Map<String, Object>> out = new ArrayList<>();
        for (MeetingProviderAdapter p : providers.all()) {
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("id", p.id()); r.put("name", p.displayName()); r.put("hosts", p.hosts());
            r.put("capabilities", p.capabilities()); r.put("permissionsRequired", p.permissionsRequired());
            out.add(r);
        }
        return out;
    }

    @PostMapping("/detect-link")
    public Map<String, Object> detect(@RequestBody Map<String, String> body, Authentication auth) {
        ctx(auth);
        ProviderRegistry.Detected d = providers.detect(body.get("url"));
        return Map.of("provider", d.provider().id(), "name", d.provider().displayName(), "url", d.url(), "capabilities", d.provider().capabilities());
    }

    @org.springframework.beans.factory.annotation.Value("${app.uma.max-upload-mb:500}") private long maxUploadMb = 500;

    private StreamedUpload body(HttpServletRequest req, String fileName) throws IOException {
        if (req.getContentLengthLong() > maxUploadMb * 1024 * 1024)
            throw new UmaException(HttpStatus.CONTENT_TOO_LARGE, "FILE_TOO_LARGE", "That recording is larger than " + maxUploadMb + " MB.",
                    "Split it into parts, or export only the audio.");
        return StreamedUpload.read(req.getInputStream(), fileName, req.getContentType(), maxUploadMb * 1024 * 1024);
    }

    /** The recording is the raw request body (Content-Type = the audio type); details go in the query string. */
    @PostMapping("/meetings/recording")
    public ResponseEntity<UmaMeeting> upload(@RequestParam String fileName,
                                             @RequestParam(required = false) String title,
                                             @RequestParam(required = false) String projectId,
                                             @RequestParam(required = false) String meetingAt,
                                             @RequestParam(required = false) String timezone,
                                             @RequestParam(defaultValue = "false") boolean consent,
                                             HttpServletRequest request, Authentication auth) throws IOException {
        UmaService.Ctx c = ctx(auth);
        if (!consent) throw new UmaException(HttpStatus.BAD_REQUEST, "CONSENT_REQUIRED",
                "Please confirm that everyone in the meeting knew it was being recorded and transcribed.");
        try (StreamedUpload file = body(request, fileName)) {
            return ResponseEntity.status(HttpStatus.CREATED).body(service.uploadRecording(c, file, title, projectId, instant(meetingAt), timezone, true));
        }
    }

    @PostMapping(value = "/meetings/transcript", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<UmaMeeting> importFile(@RequestParam(value = "file", required = false) MultipartFile file,
                                                 @RequestParam(required = false) String text,
                                                 @RequestParam(required = false) String title,
                                                 @RequestParam(required = false) String projectId,
                                                 @RequestParam(required = false) String meetingAt,
                                                 @RequestParam(required = false) String timezone,
                                                 Authentication auth) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.importTranscript(ctx(auth), text, file, title, projectId, instant(meetingAt), timezone));
    }

    public record TranscriptBody(String text, String title, String projectId, String meetingAt, String timezone) {}

    @PostMapping(value = "/meetings/transcript", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<UmaMeeting> importText(@RequestBody TranscriptBody b, Authentication auth) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.importTranscript(ctx(auth), b.text(), null, b.title(), b.projectId(), instant(b.meetingAt()), b.timezone()));
    }

    public record LinkBody(String url, String title, String projectId, String meetingAt, String timezone) {}

    @PostMapping("/meetings/link")
    public ResponseEntity<UmaMeeting> link(@RequestBody LinkBody b, Authentication auth) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.registerLink(ctx(auth), b.url(), b.title(), b.projectId(), instant(b.meetingAt()), b.timezone()));
    }

    @GetMapping("/meetings/{id}")
    public Map<String, Object> get(@PathVariable String id, Authentication auth) { return service.detail(ctx(auth), id); }

    @PostMapping("/meetings/{id}/recording")
    public UmaMeeting addRecording(@PathVariable String id, @RequestParam String fileName,
                                   @RequestParam(defaultValue = "false") boolean consent,
                                   HttpServletRequest request, Authentication auth) throws IOException {
        UmaService.Ctx c = ctx(auth);
        if (!consent) throw new UmaException(HttpStatus.BAD_REQUEST, "CONSENT_REQUIRED",
                "Please confirm that everyone in the meeting knew it was being recorded and transcribed.");
        try (StreamedUpload file = body(request, fileName)) {
            return service.addRecording(c, id, file, true);
        }
    }

    @PostMapping("/meetings/{id}/retry") public UmaMeeting retry(@PathVariable String id, Authentication auth) { return service.retry(ctx(auth), id); }
    @PostMapping("/meetings/{id}/regenerate") public UmaMeeting regenerate(@PathVariable String id, Authentication auth) { return service.regenerate(ctx(auth), id); }
    @PostMapping("/meetings/{id}/cancel") public UmaMeeting cancel(@PathVariable String id, Authentication auth) { return service.cancel(ctx(auth), id); }
    @PostMapping("/meetings/{id}/complete") public UmaMeeting complete(@PathVariable String id, Authentication auth) { return service.complete(ctx(auth), id); }

    @DeleteMapping("/meetings/{id}")
    public ResponseEntity<Void> delete(@PathVariable String id, Authentication auth) {
        service.delete(ctx(auth), id);
        return ResponseEntity.noContent().build();
    }

    public record ShareBody(String visibility, List<String> sharedWith) {}

    @PutMapping("/meetings/{id}/sharing")
    public UmaMeeting share(@PathVariable String id, @RequestBody ShareBody b, Authentication auth) {
        return service.share(ctx(auth), id, b.visibility(), b.sharedWith());
    }

    public record SegmentBody(String text, String speaker) {}

    @PatchMapping("/meetings/{id}/segments/{seq}")
    public UmaSegment editSegment(@PathVariable String id, @PathVariable int seq, @RequestBody SegmentBody b, Authentication auth) {
        return service.editSegment(ctx(auth), id, seq, b.text(), b.speaker());
    }

    @PatchMapping("/meetings/{id}/actions/{actionId}")
    public UmaInsights.ActionItem editAction(@PathVariable String id, @PathVariable String actionId, @RequestBody Map<String, Object> patch, Authentication auth) {
        return service.editAction(ctx(auth), id, actionId, patch);
    }

    @PostMapping("/meetings/{id}/actions/{actionId}/approve")
    public UmaInsights.ActionItem approve(@PathVariable String id, @PathVariable String actionId, Authentication auth) {
        return service.approve(ctx(auth), id, List.of(actionId)).get(0);
    }

    @PostMapping("/meetings/{id}/actions/{actionId}/reject")
    public UmaInsights.ActionItem reject(@PathVariable String id, @PathVariable String actionId, Authentication auth) {
        return service.reject(ctx(auth), id, actionId);
    }

    public record BulkBody(List<String> actionIds) {}

    @PostMapping("/meetings/{id}/actions/approve")
    public List<UmaInsights.ActionItem> approveMany(@PathVariable String id, @RequestBody BulkBody b, Authentication auth) {
        if (b.actionIds() == null || b.actionIds().isEmpty()) throw new UmaException(HttpStatus.BAD_REQUEST, "NOTHING_SELECTED", "Choose at least one action item.");
        if (b.actionIds().size() > 100) throw new UmaException(HttpStatus.BAD_REQUEST, "TOO_MANY", "Approve at most 100 items at once.");
        return service.approve(ctx(auth), id, b.actionIds());
    }

    public record AskBody(String question) {}

    @PostMapping("/meetings/{id}/ask")
    public UmaQuestion ask(@PathVariable String id, @RequestBody AskBody b, Authentication auth) {
        return service.ask(ctx(auth), id, b.question());
    }

    @GetMapping("/meetings/{id}/export")
    public ResponseEntity<byte[]> export(@PathVariable String id, @RequestParam(defaultValue = "md") String format, Authentication auth) {
        UmaExporter.Export e = service.export(ctx(auth), id, format);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment().filename(e.fileName()).build().toString())
                .header(HttpHeaders.CONTENT_TYPE, e.contentType())
                .body(e.bytes());
    }

    @GetMapping("/meetings/{id}/audit")
    public List<UmaAuditEvent> audit(@PathVariable String id, Authentication auth) { return service.audit(ctx(auth), id); }

    @ExceptionHandler(UmaException.class)
    public ResponseEntity<Map<String, Object>> onUma(UmaException e) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("code", e.getCode());
        body.put("message", e.getMessage());
        if (e.getRecovery() != null) body.put("recovery", e.getRecovery());
        return ResponseEntity.status(e.getStatus()).body(body);
    }
}
