package com.prowosma.backend.service;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.Notification;
import com.prowosma.backend.repository.NotificationRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import java.util.List;

@Service
@RequiredArgsConstructor
public class NotificationService {

    private final NotificationRepository notificationRepository;
    private final WorkspaceContext workspaceContext;

    public void create(String title, String message, String type,
                       String entityType, String entityId) {
        Notification n = new Notification();
        n.setTitle(title);
        n.setMessage(message);
        n.setType(type);
        n.setEntityType(entityType);
        n.setEntityId(entityId);
        n.setOrganizationId(workspaceContext.getWorkspaceId());
        notificationRepository.save(n);
    }

    public List<Notification> getAll() {
        // Fixed: scope to workspace
        String orgId = workspaceContext.getWorkspaceId();
        if (orgId != null) {
            return notificationRepository.findByOrganizationIdOrderByCreatedAtDesc(orgId);
        }
        return notificationRepository.findAllByOrderByCreatedAtDesc();
    }

    public List<Notification> getUnread() {
        // Fixed: scope to workspace
        String orgId = workspaceContext.getWorkspaceId();
        if (orgId != null) {
            return notificationRepository.findByOrganizationIdAndReadFalse(orgId);
        }
        return notificationRepository.findByReadFalse();
    }

    public long getUnreadCount() {
        // Fixed: scope to workspace
        String orgId = workspaceContext.getWorkspaceId();
        if (orgId != null) {
            return notificationRepository.countByOrganizationIdAndReadFalse(orgId);
        }
        return notificationRepository.countByReadFalse();
    }

    public Notification markRead(String id) {
        Notification n = notificationRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Notification not found"));
        n.setRead(true);
        return notificationRepository.save(n);
    }

    public void markAllRead() {
        List<Notification> unread = notificationRepository.findByReadFalse();
        unread.forEach(n -> n.setRead(true));
        notificationRepository.saveAll(unread);
    }

    public void delete(String id) {
        notificationRepository.deleteById(id);
    }

    public void deleteAll() {
        notificationRepository.deleteAll();
    }

    // ── Smart Inbox (item 6) ────────────────────────────────────

    public void snooze(String id, String until) {
        notificationRepository.findById(id).ifPresent(n -> {
            try {
                n.setSnoozedUntil(java.time.LocalDateTime.parse(until));
            } catch (Exception e) {
                // If parsing fails, snooze for 1 hour
                n.setSnoozedUntil(java.time.LocalDateTime.now().plusHours(1));
            }
            notificationRepository.save(n);
        });
    }

    public void togglePin(String id) {
        notificationRepository.findById(id).ifPresent(n -> {
            n.setPinned(!n.isPinned());
            notificationRepository.save(n);
        });
    }

    public void bulkMarkRead(java.util.List<String> ids) {
        if (ids == null || ids.isEmpty()) return;
        String orgId = workspaceContext.getWorkspaceId();
        notificationRepository.findByOrganizationIdOrderByCreatedAtDesc(orgId)
            .stream().filter(n -> ids.contains(n.getId())).forEach(n -> {
                n.setRead(true);
                notificationRepository.save(n);
            });
    }

    /**
     * Returns notifications grouped by category for the Smart Inbox.
     * Filters out snoozed notifications.
     */
    public java.util.Map<String, Object> getInboxGrouped() {
        String orgId = workspaceContext.getWorkspaceId();
        java.time.LocalDateTime now = java.time.LocalDateTime.now();

        java.util.List<Notification> all = notificationRepository
            .findByOrganizationIdOrderByCreatedAtDesc(orgId)
            .stream()
            .filter(n -> n.getSnoozedUntil() == null || n.getSnoozedUntil().isBefore(now))
            .toList();

        // Group by category
        java.util.Map<String, java.util.List<Notification>> grouped = new java.util.LinkedHashMap<>();
        for (String cat : new String[]{"ASSIGNMENT","MENTION","APPROVAL","GOAL","RISK","SYSTEM"}) {
            String catFinal = cat;
            java.util.List<Notification> catItems = all.stream()
                .filter(n -> catFinal.equals(n.getCategory()))
                .toList();
            if (!catItems.isEmpty()) grouped.put(cat, catItems);
        }

        long unread = all.stream().filter(n -> !n.isRead()).count();
        long pinned = all.stream().filter(Notification::isPinned).count();

        java.util.Map<String, Object> result = new java.util.LinkedHashMap<>();
        result.put("groups",  grouped);
        result.put("total",   all.size());
        result.put("unread",  unread);
        result.put("pinned",  pinned);
        result.put("snoozed", notificationRepository
            .findByOrganizationIdOrderByCreatedAtDesc(orgId)
            .stream().filter(n -> n.getSnoozedUntil() != null && n.getSnoozedUntil().isAfter(now)).count());
        return result;
    }

}
