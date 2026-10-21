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
    private final VisibilityService visibility;

    /** Restricted callers only see notifications about tasks and projects they can see (system notices are hidden). */
    private List<Notification> visible(List<Notification> in) {
        if (!visibility.isRestricted()) return in;
        var ev = visibility.entityVisibility();
        return in.stream().filter(n -> isAnnouncement(n) || ev.canSee(n.getEntityType(), n.getEntityId())).collect(java.util.stream.Collectors.toList());
    }

    /** Workspace announcements are meant for everyone, so they stay visible. */
    private static boolean isAnnouncement(Notification n) { return "ANNOUNCEMENT".equals(n.getCategory()); }

    private boolean canSee(Notification n) {
        return !visibility.isRestricted() || isAnnouncement(n) || visibility.entityVisibility().canSee(n.getEntityType(), n.getEntityId());
    }

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

    /** Same as {@link #create} but files the notification under an inbox category (e.g. ASSIGNMENT). */
    public void createWithCategory(String title, String message, String type, String entityType, String entityId, String category) {
        Notification n = new Notification();
        n.setTitle(title);
        n.setMessage(message);
        n.setType(type);
        n.setEntityType(entityType);
        n.setEntityId(entityId);
        n.setCategory(category);
        n.setOrganizationId(workspaceContext.getWorkspaceId());
        notificationRepository.save(n);
    }

    public List<Notification> getAll() {
        // No workspace selected => no notifications. This used to fall back to a
        // global query, which returned every workspace's notifications to anyone
        // who simply left out the X-Workspace-Id header.
        String orgId = workspaceContext.getWorkspaceId();
        if (orgId == null) return List.of();
        return visible(notificationRepository.findByOrganizationIdOrderByCreatedAtDesc(orgId));
    }

    public List<Notification> getUnread() {
        String orgId = workspaceContext.getWorkspaceId();
        if (orgId == null) return List.of();
        return visible(notificationRepository.findByOrganizationIdAndReadFalse(orgId));
    }

    public long getUnreadCount() {
        String orgId = workspaceContext.getWorkspaceId();
        if (orgId == null) return 0L;
        if (visibility.isRestricted()) return getUnread().size();
        return notificationRepository.countByOrganizationIdAndReadFalse(orgId);
    }

    public Notification markRead(String id) {
        Notification n = notificationRepository.findById(id)
                .filter(this::canSee)
                .orElseThrow(() -> new RuntimeException("Notification not found"));
        n.setRead(true);
        return notificationRepository.save(n);
    }

    public void markAllRead() {
        // Only this workspace's notifications (this used to mark EVERY workspace's as read).
        String orgId = workspaceContext.getWorkspaceId();
        if (orgId == null) return;
        List<Notification> unread = visible(notificationRepository.findByOrganizationIdAndReadFalse(orgId));
        unread.forEach(n -> n.setRead(true));
        notificationRepository.saveAll(unread);
    }

    public void delete(String id) {
        if (visibility.isRestricted()) {
            notificationRepository.findById(id).filter(this::canSee).ifPresent(notificationRepository::delete);
            return;
        }
        notificationRepository.deleteById(id);
    }

    public void deleteAll() {
        // Only this workspace's notifications (this used to delete EVERY workspace's).
        String orgId = workspaceContext.getWorkspaceId();
        if (orgId == null) return;
        notificationRepository.deleteAll(visible(notificationRepository.findByOrganizationId(orgId)));
    }

    // ── Smart Inbox (item 6) ────────────────────────────────────

    public void snooze(String id, String until) {
        notificationRepository.findById(id).filter(this::canSee).ifPresent(n -> {
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
        notificationRepository.findById(id).filter(this::canSee).ifPresent(n -> {
            n.setPinned(!n.isPinned());
            notificationRepository.save(n);
        });
    }

    public void bulkMarkRead(java.util.List<String> ids) {
        if (ids == null || ids.isEmpty()) return;
        String orgId = workspaceContext.getWorkspaceId();
        visible(notificationRepository.findByOrganizationIdOrderByCreatedAtDesc(orgId))
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

        java.util.List<Notification> all = visible(notificationRepository
            .findByOrganizationIdOrderByCreatedAtDesc(orgId))
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
        result.put("snoozed", visible(notificationRepository
            .findByOrganizationIdOrderByCreatedAtDesc(orgId))
            .stream().filter(n -> n.getSnoozedUntil() != null && n.getSnoozedUntil().isAfter(now)).count());
        return result;
    }

}
