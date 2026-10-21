package com.prowosma.backend.controller;
import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.*;
import com.prowosma.backend.repository.*;
import com.prowosma.backend.util.PagedResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

@RestController @RequestMapping("/api/channels") @RequiredArgsConstructor
public class ChannelController {
    private final ChannelRepository        channelRepo;
    private final ChannelMessageRepository messageRepo;
    private final WorkspaceContext         ws;
    private final com.prowosma.backend.service.VisibilityService visibility;

    /** The channel, or 404 if the caller can't see it (created it, is a member, or can see its project). */
    private Channel visibleChannel(String id) {
        return visibility.requireLinked(channelRepo.findById(id).orElseThrow(() -> new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.NOT_FOUND, "Channel not found")),
                x -> { var l = com.prowosma.backend.service.VisibilityService.people(x.getCreatedBy()); if (x.getMemberEmails() != null) l.addAll(x.getMemberEmails()); return l; }, x -> com.prowosma.backend.service.VisibilityService.projectsOf(x.getProjectId()));
    }

    @GetMapping
    public PagedResponse<Channel> getAll(
            @RequestParam(defaultValue = "0")  int page,
            @RequestParam(defaultValue = "50") int size) {
        return PagedResponse.ofList(visibility.filterLinked(channelRepo.findByOrganizationId(ws.getWorkspaceId()), x -> { var l = com.prowosma.backend.service.VisibilityService.people(x.getCreatedBy()); if (x.getMemberEmails() != null) l.addAll(x.getMemberEmails()); return l; }, x -> com.prowosma.backend.service.VisibilityService.projectsOf(x.getProjectId())), page, Math.min(size, 200));
    }

    @PostMapping
    public Channel create(@RequestBody Channel c, Authentication auth) {
        visibility.requireMayCreateLinked(c.getProjectId());
        c.setOrganizationId(ws.getWorkspaceId());
        c.setCreatedBy(auth.getName()); c.setCreatedAt(LocalDateTime.now());
        return channelRepo.save(c);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String,String>> delete(@PathVariable String id) {
        channelRepo.findById(id).ifPresent(c -> { visibility.requireLinkedWrite(c, x -> { var l = com.prowosma.backend.service.VisibilityService.people(x.getCreatedBy()); if (x.getMemberEmails() != null) l.addAll(x.getMemberEmails()); return l; }, x -> com.prowosma.backend.service.VisibilityService.projectsOf(x.getProjectId())); channelRepo.delete(c); });
        return ResponseEntity.ok(Map.of("message","Deleted"));
    }

    @GetMapping("/{id}/messages")
    public PagedResponse<ChannelMessage> getMessages(
            @PathVariable String id,
            @RequestParam(defaultValue = "0")  int page,
            @RequestParam(defaultValue = "100") int size) {
        visibleChannel(id);
        return PagedResponse.ofList(
            messageRepo.findByChannelIdOrderByCreatedAtAsc(id).stream()
                .filter(m -> ws.getWorkspaceId() != null && ws.getWorkspaceId().equals(m.getOrganizationId())).toList(),
            page, Math.min(size, 500));
    }

    @PostMapping("/{id}/messages")
    public ChannelMessage postMessage(@PathVariable String id,
                                      @RequestBody ChannelMessage msg, Authentication auth) {
        visibleChannel(id);
        msg.setChannelId(id);
        msg.setOrganizationId(ws.getWorkspaceId());
        msg.setAuthorEmail(auth.getName());
        msg.setCreatedAt(LocalDateTime.now());
        return messageRepo.save(msg);
    }

    @DeleteMapping("/{id}/messages/{msgId}")
    public ResponseEntity<Map<String,String>> deleteMessage(@PathVariable String id,
                                                             @PathVariable String msgId) {
        visibleChannel(id);
        messageRepo.findById(msgId).filter(m -> id.equals(m.getChannelId())).ifPresent(m -> {
            // a message may be removed by its author or by someone who manages planning records
            var who = org.springframework.security.core.context.SecurityContextHolder.getContext().getAuthentication();
            boolean mine = who != null && m.getAuthorEmail() != null && m.getAuthorEmail().equalsIgnoreCase(who.getName());
            if (!mine) visibility.requireCapability(com.prowosma.backend.access.AccessConstants.CAP_MANAGE_PLANNING);
            messageRepo.delete(m);
        });
        return ResponseEntity.ok(Map.of("message","Deleted"));
    }
}
