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

    @GetMapping
    public PagedResponse<Channel> getAll(
            @RequestParam(defaultValue = "0")  int page,
            @RequestParam(defaultValue = "50") int size) {
        return PagedResponse.ofList(channelRepo.findByOrganizationId(ws.getWorkspaceId()), page, Math.min(size, 200));
    }

    @PostMapping
    public Channel create(@RequestBody Channel c, Authentication auth) {
        c.setOrganizationId(ws.getWorkspaceId());
        c.setCreatedBy(auth.getName()); c.setCreatedAt(LocalDateTime.now());
        return channelRepo.save(c);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String,String>> delete(@PathVariable String id) {
        channelRepo.deleteById(id); return ResponseEntity.ok(Map.of("message","Deleted"));
    }

    @GetMapping("/{id}/messages")
    public PagedResponse<ChannelMessage> getMessages(
            @PathVariable String id,
            @RequestParam(defaultValue = "0")  int page,
            @RequestParam(defaultValue = "100") int size) {
        return PagedResponse.ofList(
            messageRepo.findByChannelIdOrderByCreatedAtAsc(id), page, Math.min(size, 500));
    }

    @PostMapping("/{id}/messages")
    public ChannelMessage postMessage(@PathVariable String id,
                                      @RequestBody ChannelMessage msg, Authentication auth) {
        msg.setChannelId(id);
        msg.setOrganizationId(ws.getWorkspaceId());
        msg.setAuthorEmail(auth.getName());
        msg.setCreatedAt(LocalDateTime.now());
        return messageRepo.save(msg);
    }

    @DeleteMapping("/{id}/messages/{msgId}")
    public ResponseEntity<Map<String,String>> deleteMessage(@PathVariable String id,
                                                             @PathVariable String msgId) {
        messageRepo.deleteById(msgId); return ResponseEntity.ok(Map.of("message","Deleted"));
    }
}
