package com.prowosma.backend.controller;

import com.prowosma.backend.model.Notification;
import com.prowosma.backend.service.NotificationService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/notifications")
@RequiredArgsConstructor
public class NotificationController {

    private final NotificationService notificationService;
    private final com.prowosma.backend.repository.NotificationRepository notificationRepository;
    private final com.prowosma.backend.config.WorkspaceContext workspaceContext;

    @GetMapping
    public List<Notification> getAll(
            @RequestParam(required = false) Integer limit) {
        List<Notification> items = notificationService.getAll();
        if (limit != null && limit > 0 && items.size() > limit) {
            items = items.subList(0, limit);
        }
        return items;
    }

    @GetMapping("/unread")
    public List<Notification> getUnread() {
        return notificationService.getUnread();
    }

    @GetMapping("/count")
    public Map<String, Long> getUnreadCount() {
        return Map.of("count", notificationService.getUnreadCount());
    }

    @PatchMapping("/{id}/read")
    public Notification markRead(@PathVariable String id) {
        return notificationService.markRead(id);
    }

    @PatchMapping("/read-all")
    public ResponseEntity<?> markAllRead() {
        notificationService.markAllRead();
        return ResponseEntity.ok(Map.of("message", "All marked as read"));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> delete(@PathVariable String id) {
        notificationService.delete(id);
        return ResponseEntity.ok(Map.of("message", "Deleted"));
    }

    @DeleteMapping
    public ResponseEntity<?> deleteAll() {
        notificationService.deleteAll();
        return ResponseEntity.ok(Map.of("message", "All deleted"));
    }

    @PatchMapping("/{id}/snooze")
    public ResponseEntity<?> snooze(@PathVariable String id,
                                    @RequestBody java.util.Map<String, Object> body) {
        notificationService.snooze(id, (String) body.get("until"));
        return ResponseEntity.ok(Map.of("message", "Snoozed"));
    }

    @PatchMapping("/{id}/pin")
    public ResponseEntity<?> pin(@PathVariable String id) {
        notificationService.togglePin(id);
        return ResponseEntity.ok(Map.of("message", "Toggled"));
    }

    @PatchMapping("/bulk-read")
    public ResponseEntity<?> bulkRead(@RequestBody java.util.Map<String, Object> body) {
        @SuppressWarnings("unchecked")
        java.util.List<String> ids = (java.util.List<String>) body.get("ids");
        notificationService.bulkMarkRead(ids);
        return ResponseEntity.ok(Map.of("message", "Marked read"));
    }

    @GetMapping("/inbox")
    public java.util.Map<String, Object> getInbox() {
        return notificationService.getInboxGrouped();
    }


    // P3: Org-wide announcement — creates a pinned HIGH-priority notification for all members
    @PostMapping("/announce")
    public ResponseEntity<?> announce(@RequestBody java.util.Map<String, Object> body,
                                       org.springframework.security.core.Authentication auth) {
        String title    = (String) body.getOrDefault("title","Announcement");
        String message  = (String) body.getOrDefault("body","");
        String priority = (String) body.getOrDefault("priority","NORMAL");
        com.prowosma.backend.model.Notification n = new com.prowosma.backend.model.Notification();
        n.setOrganizationId(workspaceContext.getWorkspaceId());
        n.setTitle("📢 " + title);
        n.setMessage(message);
        n.setType("HIGH".equals(priority) ? "WARNING" : "INFO");
        n.setPinned(true);
        n.setCategory("ANNOUNCEMENT");
        n.setPriority("HIGH".equals(priority) ? "HIGH" : "NORMAL");
        n.setEntityType("WORKSPACE");
        n.setCreatedAt(java.time.LocalDateTime.now());
        notificationRepository.save(n);
        return ResponseEntity.ok(java.util.Map.of("message","Announcement sent","id",n.getId()));
    }

}
