package com.prowosma.backend.controller;

import com.prowosma.backend.service.MeetingAssistantService;
import com.prowosma.backend.service.MeetingAssistantService.CreateRequest;
import com.prowosma.backend.service.MeetingAssistantException;
import com.prowosma.backend.service.MeetingAssistantService.TranscriptUpload;
import com.prowosma.backend.meetingassistant.RecordingRules;
import com.prowosma.backend.service.MeetingAssistantService.StartRecordingRequest;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Everyday Meeting Assistant endpoints. Viewers are read-only (RoleGuardFilter); all data access is
 * organization-scoped and per-meeting access is enforced in the service.
 */
@RestController
@RequestMapping("/api/meeting-assistant")
@Tag(name = "Meeting Assistant", description = "Register meetings and follow their status")
@RequiredArgsConstructor
public class MeetingAssistantController {

    private final MeetingAssistantService service;

    @GetMapping("/capabilities")
    public Map<String, Object> capabilities(Authentication auth) {
        return service.capabilities(auth.getName());
    }

    @PostMapping("/validate-url")
    public Map<String, Object> validate(@RequestBody Map<String, String> body) {
        return service.validateUrl(body.get("url"));
    }

    @GetMapping("/sessions")
    public List<Map<String, Object>> list(Authentication auth) {
        return service.list(auth.getName());
    }

    @PostMapping("/sessions")
    public ResponseEntity<Map<String, Object>> create(@RequestBody CreateRequest req, Authentication auth) {
        var created = service.createSession(req, auth.getName());
        return ResponseEntity.status(HttpStatus.CREATED).body(service.get(created.getId(), auth.getName()));
    }

    @GetMapping("/sessions/{id}")
    public Map<String, Object> get(@PathVariable String id, Authentication auth) {
        return service.get(id, auth.getName());
    }

    // ── recording ─────────────────────────────────────────────────────────────
    // Audio is sent as the raw request body (not multipart) so one clear size limit applies and nothing else in the app is affected.

    /** Start recording: for a new meeting, or for one already registered (sessionId). */
    @PostMapping("/recordings")
    public ResponseEntity<Map<String, Object>> startRecording(@RequestBody StartRecordingRequest req, Authentication auth) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.startRecording(req, auth.getName()));
    }

    @PutMapping("/sessions/{id}/recording/chunks/{track}/{seq}")
    public Map<String, Object> recordingChunk(@PathVariable String id, @PathVariable String track, @PathVariable int seq,
                                              @RequestParam(defaultValue = "0") long startMs, @RequestParam(defaultValue = "0") long durationMs,
                                              HttpServletRequest request, Authentication auth) throws IOException {
        return service.recordingChunk(id, track, seq, startMs, durationMs, readBody(request, RecordingRules.MAX_CHUNK_BYTES), auth.getName());
    }

    @PostMapping("/sessions/{id}/recording/finish")
    public Map<String, Object> finishRecording(@PathVariable String id, Authentication auth) {
        return service.finishRecording(id, auth.getName());
    }

    /** A recording file for a meeting that already exists. */
    @PostMapping("/sessions/{id}/recording/upload")
    public Map<String, Object> uploadRecording(@PathVariable String id, @RequestParam(defaultValue = "false") boolean consent,
                                               HttpServletRequest request, Authentication auth) throws IOException {
        return service.uploadRecording(id, null, null, readBody(request, RecordingRules.MAX_UPLOAD_BYTES), consent, auth.getName());
    }

    /** A recording file that gets its own new meeting. */
    @PostMapping("/recordings/upload")
    public ResponseEntity<Map<String, Object>> uploadRecordingAsNewMeeting(@RequestParam(required = false) String title, @RequestParam(required = false) String projectId,
                                                                           @RequestParam(defaultValue = "false") boolean consent,
                                                                           HttpServletRequest request, Authentication auth) throws IOException {
        return ResponseEntity.status(HttpStatus.CREATED).body(
                service.uploadRecording(null, title, projectId, readBody(request, RecordingRules.MAX_UPLOAD_BYTES), consent, auth.getName()));
    }

    @DeleteMapping("/sessions/{id}/recording")
    public Map<String, Object> deleteRecordingAudio(@PathVariable String id, Authentication auth) {
        return service.deleteRecordingAudio(id, auth.getName());
    }

    /** Reads at most {@code max} bytes; a larger body is refused up front when its length is declared, and never held in memory otherwise. */
    private static byte[] readBody(HttpServletRequest request, long max) throws IOException {
        long declared = request.getContentLengthLong();
        if (declared > max) throw tooLarge(max);
        byte[] data = request.getInputStream().readNBytes((int) max + 1);
        if (data.length > max) throw tooLarge(max);
        return data;
    }

    private static MeetingAssistantException tooLarge(long max) {
        return new MeetingAssistantException(HttpStatus.PAYLOAD_TOO_LARGE, "AUDIO_TOO_LARGE", "That audio is larger than " + (max / 1_000_000) + " MB.");
    }

    @PostMapping("/sessions/{id}/cancel")
    public Map<String, Object> cancel(@PathVariable String id, Authentication auth) {
        return service.cancel(id, auth.getName());
    }

    @PostMapping("/sessions/{id}/retry")
    public Map<String, Object> retry(@PathVariable String id, Authentication auth) {
        return service.retry(id, auth.getName());
    }

    @PutMapping("/sessions/{id}/access")
    public Map<String, Object> access(@PathVariable String id, @RequestBody Map<String, Object> body, Authentication auth) {
        List<String> shared = body.get("sharedWith") instanceof List<?> l
                ? l.stream().map(String::valueOf).toList() : null;
        String visibility = body.get("visibility") == null ? null : String.valueOf(body.get("visibility"));
        return service.updateAccess(id, visibility, shared, auth.getName());
    }

    // ── transcripts ──────────────────────────────────────────────────────────

    /** Paste or upload: the browser sends the file's text. Requester or admin only. */
    @PostMapping("/sessions/{id}/transcript")
    public Map<String, Object> addTranscript(@PathVariable String id, @RequestBody TranscriptUpload body, Authentication auth) {
        return service.uploadTranscript(id, body, auth.getName());
    }

    @GetMapping("/sessions/{id}/transcript")
    public Map<String, Object> transcript(@PathVariable String id,
                                          @RequestParam(defaultValue = "0") int after,
                                          @RequestParam(defaultValue = "200") int limit, Authentication auth) {
        return service.getTranscript(id, after, limit, auth.getName());
    }

    @DeleteMapping("/sessions/{id}/transcript")
    public Map<String, Object> deleteTranscript(@PathVariable String id, Authentication auth) {
        return service.deleteTranscript(id, auth.getName());
    }

    /** "Check now" — imports from Google Meet immediately using the caller's own Google access. */
    @PostMapping("/sessions/{id}/fetch")
    public Map<String, Object> fetchNow(@PathVariable String id, Authentication auth) {
        return service.fetchNow(id, auth.getName());
    }

    // ── summary, minutes and notes ───────────────────────────────────────────

    @PostMapping("/sessions/{id}/generate")
    public Map<String, Object> generate(@PathVariable String id, Authentication auth) {
        return service.generateOutputs(id, auth.getName());
    }

    @GetMapping("/sessions/{id}/artifacts")
    public Map<String, Object> artifacts(@PathVariable String id, Authentication auth) {
        return service.artifacts(id, auth.getName());
    }

    @GetMapping("/sessions/{id}/artifacts/{type}/versions")
    public List<Map<String, Object>> versions(@PathVariable String id, @PathVariable String type, Authentication auth) {
        return service.artifactVersions(id, type, auth.getName());
    }

    @GetMapping("/sessions/{id}/artifacts/{type}/versions/{n}")
    public Map<String, Object> version(@PathVariable String id, @PathVariable String type, @PathVariable int n, Authentication auth) {
        return service.artifactVersion(id, type, n, auth.getName());
    }

    @GetMapping("/sessions/{id}/artifacts/{type}/diff")
    public List<Map<String, Object>> diff(@PathVariable String id, @PathVariable String type,
                                          @RequestParam int from, @RequestParam int to, Authentication auth) {
        return service.artifactDiff(id, type, from, to, auth.getName());
    }

    /** Saves an edit as a NEW version. {@code baseVersion} must be the version the person was looking at. */
    @PutMapping("/sessions/{id}/artifacts/{type}")
    public Map<String, Object> edit(@PathVariable String id, @PathVariable String type,
                                    @RequestBody Map<String, Object> body, Authentication auth) {
        Object base = body.get("baseVersion");
        if (!(base instanceof Number n)) throw new MeetingAssistantException(org.springframework.http.HttpStatus.BAD_REQUEST, "BASE_VERSION_REQUIRED", "baseVersion is required.");
        Object md = body.get("markdown");
        return service.editArtifact(id, type, n.intValue(), md == null ? null : String.valueOf(md), auth.getName());
    }

    @PostMapping("/sessions/{id}/artifacts/{type}/restore")
    public Map<String, Object> restore(@PathVariable String id, @PathVariable String type,
                                       @RequestBody Map<String, Object> body, Authentication auth) {
        Object v = body.get("version");
        if (!(v instanceof Number n)) throw new MeetingAssistantException(org.springframework.http.HttpStatus.BAD_REQUEST, "VERSION_REQUIRED", "version is required.");
        return service.restoreArtifact(id, type, n.intValue(), auth.getName());
    }

    @PostMapping("/sessions/{id}/artifacts/{type}/accept")
    public Map<String, Object> accept(@PathVariable String id, @PathVariable String type, Authentication auth) {
        return service.acceptPending(id, type, auth.getName());
    }

    @PostMapping("/sessions/{id}/artifacts/{type}/dismiss")
    public Map<String, Object> dismiss(@PathVariable String id, @PathVariable String type, Authentication auth) {
        return service.dismissPending(id, type, auth.getName());
    }

    // ── structured actions: extract, review, preview ─────────────────────────

    @PostMapping("/sessions/{id}/actions/extract")
    public Map<String, Object> extractActions(@PathVariable String id, Authentication auth) {
        return service.extractActions(id, auth.getName());
    }

    @GetMapping("/sessions/{id}/actions")
    public Map<String, Object> actions(@PathVariable String id, Authentication auth) {
        return service.actions(id, auth.getName());
    }

    @GetMapping("/sessions/{id}/actions/preview")
    public Map<String, Object> preview(@PathVariable String id, Authentication auth) {
        return service.actionsPreview(id, auth.getName());
    }

    /** Review mode: create every approved project and task now. Safe to repeat: only what isn't created yet (or failed) is attempted. */
    @PostMapping("/sessions/{id}/create")
    public Map<String, Object> createApproved(@PathVariable String id, Authentication auth) {
        return service.createApproved(id, auth.getName());
    }

    @PostMapping("/sessions/{id}/actions/approve-valid")
    public Map<String, Object> approveValid(@PathVariable String id, Authentication auth) {
        return service.approveValidActions(id, auth.getName());
    }

    /** Body {"apply": true|false}: apply or discard the changes a re-run found. */
    @PostMapping("/sessions/{id}/actions/diff")
    public Map<String, Object> resolveDiff(@PathVariable String id, @RequestBody Map<String, Object> body, Authentication auth) {
        return service.resolveActionsDiff(id, Boolean.TRUE.equals(body.get("apply")), auth.getName());
    }

    @PatchMapping("/sessions/{id}/actions/{actionId}")
    public Map<String, Object> patchAction(@PathVariable String id, @PathVariable String actionId, @RequestBody Map<String, Object> body, Authentication auth) {
        return service.patchAction(id, actionId, body, auth.getName());
    }

    @PostMapping("/sessions/{id}/actions/{actionId}/decision")
    public Map<String, Object> decideAction(@PathVariable String id, @PathVariable String actionId, @RequestBody Map<String, Object> body, Authentication auth) {
        return service.decideAction(id, actionId, String.valueOf(body.get("decision")), auth.getName());
    }

    @PostMapping("/sessions/{id}/actions/{actionId}/merge")
    public Map<String, Object> mergeAction(@PathVariable String id, @PathVariable String actionId, @RequestBody Map<String, Object> body, Authentication auth) {
        return service.mergeAction(id, actionId, String.valueOf(body.get("intoId")), auth.getName());
    }

    @PatchMapping("/sessions/{id}/proposed-projects/{projectId}")
    public Map<String, Object> patchProject(@PathVariable String id, @PathVariable String projectId, @RequestBody Map<String, Object> body, Authentication auth) {
        return service.patchProposedProject(id, projectId, body, auth.getName());
    }

    @PostMapping("/sessions/{id}/proposed-projects/{projectId}/decision")
    public Map<String, Object> decideProject(@PathVariable String id, @PathVariable String projectId, @RequestBody Map<String, Object> body, Authentication auth) {
        return service.decideProposedProject(id, projectId, String.valueOf(body.get("decision")), auth.getName());
    }

    // ── each person's own Google connection ─────────────────────────────────

    @GetMapping("/google/connection")
    public Map<String, Object> googleConnection(Authentication auth) {
        return service.googleConnection(auth.getName());
    }

    @PostMapping("/google/authorize")
    public Map<String, Object> googleAuthorize(Authentication auth) {
        return service.googleAuthorize(auth.getName());
    }

    /** Called by the app's own callback page (an authenticated request), so no public endpoint is needed. */
    @PostMapping("/google/connect")
    public Map<String, Object> googleConnect(@RequestBody Map<String, String> body, Authentication auth) {
        return service.googleComplete(body.get("code"), body.get("state"), auth.getName());
    }

    @DeleteMapping("/google/connection")
    public Map<String, Object> googleDisconnect(Authentication auth) {
        return service.googleDisconnect(auth.getName());
    }

    /** Development fixture. Returns 404 unless app.meeting-assistant.dev-fixtures-enabled=true. */
    @PostMapping("/sessions/{id}/dev/advance")
    public Map<String, Object> devAdvance(@PathVariable String id, @RequestBody Map<String, String> body, Authentication auth) {
        return service.devAdvance(id, body.get("status"), auth.getName());
    }

    @ExceptionHandler(MeetingAssistantException.class)
    public ResponseEntity<Map<String, Object>> handle(MeetingAssistantException ex) {
        Map<String, Object> out = new LinkedHashMap<>(ex.getExtras());
        out.put("error", ex.getCode());
        out.put("message", ex.getMessage());
        return ResponseEntity.status(ex.getStatus()).body(out);
    }
}
