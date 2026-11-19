package com.prowosma.backend.controller;
import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.*;
import com.prowosma.backend.repository.*;
import com.prowosma.backend.service.VisibilityService;
import com.prowosma.backend.util.PagedResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import java.time.LocalDateTime;
import java.util.*;

/**
 * Channels. A PUBLIC channel follows the usual visibility rules (its project, or the workspace).
 * A PRIVATE channel or a direct message (type DM) is seen only by its members - not even workspace admins can read it,
 * like a Microsoft Teams private channel. Its owners (the creator, plus anyone they make an owner) add and remove people.
 */
@RestController @RequestMapping("/api/channels") @RequiredArgsConstructor
public class ChannelController {
    private final ChannelRepository        channelRepo;
    private final ChannelMessageRepository messageRepo;
    private final WorkspaceContext         ws;
    private final VisibilityService        visibility;
    private final TeamMemberRepository     members;
    private final WorkspaceRepository      workspaces;
    private final UserRepository           users;

    private static String low(String e) { return e == null ? null : e.trim().toLowerCase(Locale.ROOT); }
    private static List<String> peopleOf(Channel x) {
        var l = VisibilityService.people(x.getCreatedBy()); if (x.getMemberEmails() != null) l.addAll(x.getMemberEmails()); return l;
    }
    private static boolean isMember(Channel c, String email) {
        String e = low(email);
        if (e == null) return false;
        if (e.equals(low(c.getCreatedBy()))) return true;
        return c.getMemberEmails() != null && c.getMemberEmails().stream().anyMatch(m -> e.equals(low(m)));
    }
    private static boolean isOwner(Channel c, String email) {
        String e = low(email);
        if (e == null) return false;
        if (e.equals(low(c.getCreatedBy()))) return true;
        return c.getOwnerEmails() != null && c.getOwnerEmails().stream().anyMatch(m -> e.equals(low(m)));
    }
    private boolean canSee(Channel c, String email) {
        if (c == null || !Objects.equals(ws.getWorkspaceId(), c.getOrganizationId())) return false;
        if (c.isPrivate()) return isMember(c, email);
        return visibility.canSeeLinkedRecord(peopleOf(c), VisibilityService.projectsOf(c.getProjectId()));
    }
    private static ResponseStatusException notFound() { return new ResponseStatusException(HttpStatus.NOT_FOUND, "Channel not found"); }

    /** The channel, or 404 if the caller can't see it. */
    private Channel visibleChannel(String id, Authentication auth) {
        Channel c = channelRepo.findById(id).orElseThrow(ChannelController::notFound);
        if (!canSee(c, auth.getName())) throw notFound();
        return c;
    }

    /** Lower-cased emails of the workspace's people: its members and its owner. Anything else can't be added to a channel. */
    private Map<String, String> workspacePeople() {
        Map<String, String> out = new LinkedHashMap<>();
        for (TeamMember t : members.findByOrganizationId(ws.getWorkspaceId()))
            if (t.getEmail() != null) out.put(low(t.getEmail()), t.getName() != null ? t.getName() : t.getEmail());
        workspaces.findById(ws.getWorkspaceId()).ifPresent(w -> {
            String o = low(w.getOwnerEmail());
            if (o != null && !out.containsKey(o)) out.put(o, users.findByEmail(o).map(User::getName).orElse(o));
        });
        return out;
    }

    private List<String> validPeople(Collection<String> emails) {
        Map<String, String> known = workspacePeople();
        List<String> out = new ArrayList<>();
        for (String e : emails == null ? List.<String>of() : emails) {
            String l = low(e);
            if (l == null || l.isEmpty()) continue;
            if (!known.containsKey(l)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, l + " isn't a member of this workspace.");
            if (!out.contains(l)) out.add(l);
        }
        return out;
    }

    @GetMapping
    public PagedResponse<Channel> getAll(
            @RequestParam(defaultValue = "0")  int page,
            @RequestParam(defaultValue = "50") int size, Authentication auth) {
        List<Channel> mine = channelRepo.findByOrganizationId(ws.getWorkspaceId()).stream().filter(c -> canSee(c, auth.getName())).toList();
        return PagedResponse.ofList(mine, page, Math.min(size, 200));
    }

    /** The workspace's people, for the member picker. */
    @GetMapping("/people")
    public List<Map<String, String>> people() {
        List<Map<String, String>> out = new ArrayList<>();
        workspacePeople().forEach((email, name) -> out.add(Map.of("email", email, "name", name)));
        out.sort(Comparator.comparing(m -> m.get("name").toLowerCase(Locale.ROOT)));
        return out;
    }

    @PostMapping
    public Channel create(@RequestBody Channel c, Authentication auth) {
        if (c.getName() == null || c.getName().isBlank()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Give the channel a name.");
        if ("DM".equalsIgnoreCase(c.getType())) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Start a direct message with POST /api/channels/dm.");
        visibility.requireMayCreateLinked(c.getProjectId());
        String me = low(auth.getName());
        c.setId(null);
        c.setOrganizationId(ws.getWorkspaceId());
        c.setName(c.getName().trim().replaceFirst("^#+", ""));
        c.setVisibility("PRIVATE".equalsIgnoreCase(c.getVisibility()) ? "PRIVATE" : "PUBLIC");
        List<String> people = validPeople(c.getMemberEmails());
        if (!people.contains(me)) people.add(0, me);
        c.setMemberEmails(people);
        c.setOwnerEmails(new ArrayList<>(List.of(me)));
        c.setCreatedBy(me); c.setCreatedAt(LocalDateTime.now());
        return channelRepo.save(c);
    }

    /** Opens (or reuses) the direct-message conversation between the caller and one other person. */
    @PostMapping("/dm")
    public Channel directMessage(@RequestBody Map<String, String> body, Authentication auth) {
        String me = low(auth.getName());
        String other = validPeople(List.of(body.getOrDefault("email", ""))).stream().findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "Choose who to message."));
        if (other.equals(me)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Choose someone other than yourself.");
        for (Channel c : channelRepo.findByOrganizationIdAndType(ws.getWorkspaceId(), "DM")) {
            Set<String> pair = new HashSet<>(); c.getMemberEmails().forEach(e -> pair.add(low(e)));
            if (pair.equals(Set.of(me, other))) return c;
        }
        Map<String, String> names = workspacePeople();
        Channel c = new Channel();
        c.setOrganizationId(ws.getWorkspaceId());
        c.setType("DM"); c.setVisibility("PRIVATE");
        c.setName(names.getOrDefault(me, me) + " & " + names.getOrDefault(other, other));
        c.setMemberEmails(new ArrayList<>(List.of(me, other)));
        c.setOwnerEmails(new ArrayList<>(List.of(me, other)));
        c.setCreatedBy(me); c.setCreatedAt(LocalDateTime.now());
        return channelRepo.save(c);
    }

    /** Rename / describe. Private: an owner. Public: the usual edit rules. */
    @PutMapping("/{id}")
    public Channel update(@PathVariable String id, @RequestBody Map<String, String> body, Authentication auth) {
        Channel c = visibleChannel(id, auth);
        requireManage(c, auth);
        if ("DM".equalsIgnoreCase(c.getType())) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "A direct message can't be renamed.");
        if (body.get("name") != null && !body.get("name").isBlank()) c.setName(body.get("name").trim().replaceFirst("^#+", ""));
        if (body.containsKey("description")) c.setDescription(body.get("description"));
        return channelRepo.save(c);
    }

    private void requireManage(Channel c, Authentication auth) {
        if (c.isPrivate()) {
            if (!isOwner(c, auth.getName())) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Only the channel's owners can do this.");
        } else {
            visibility.requireLinkedWrite(c, ChannelController::peopleOf, x -> VisibilityService.projectsOf(x.getProjectId()));
        }
    }

    /** Adds people. Body: {"emails": [...], "owner": false}. */
    @PostMapping("/{id}/members")
    public Channel addMembers(@PathVariable String id, @RequestBody Map<String, Object> body, Authentication auth) {
        Channel c = visibleChannel(id, auth);
        requireManage(c, auth);
        if ("DM".equalsIgnoreCase(c.getType())) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Start a private channel to talk with more people.");
        @SuppressWarnings("unchecked") List<String> emails = body.get("emails") instanceof List<?> l ? (List<String>) l : List.of();
        boolean owner = Boolean.TRUE.equals(body.get("owner"));
        for (String e : validPeople(emails)) {
            if (!isMember(c, e)) c.getMemberEmails().add(e);
            if (owner && !isOwner(c, e)) c.getOwnerEmails().add(e);
        }
        return channelRepo.save(c);
    }

    /** Removes a person (an owner removes anyone; anyone can remove themselves, i.e. leave). */
    @DeleteMapping("/{id}/members/{email}")
    public Channel removeMember(@PathVariable String id, @PathVariable String email, Authentication auth) {
        Channel c = visibleChannel(id, auth);
        String who = low(email);
        boolean self = who.equals(low(auth.getName()));
        if (!self) requireManage(c, auth);
        if ("DM".equalsIgnoreCase(c.getType())) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "You can't leave a direct message.");
        c.getMemberEmails().removeIf(e -> who.equals(low(e)));
        c.getOwnerEmails().removeIf(e -> who.equals(low(e)));
        if (who.equals(low(c.getCreatedBy()))) {
            // the creator left: the longest-standing remaining member owns it, so a private channel is never orphaned
            c.setCreatedBy(c.getMemberEmails().isEmpty() ? null : low(c.getMemberEmails().get(0)));
        }
        if (c.isPrivate() && c.getMemberEmails().isEmpty()) {          // nobody left to read it
            messageRepo.deleteAll(messageRepo.findByChannelIdOrderByCreatedAtAsc(c.getId()));
            channelRepo.delete(c);
            return c;
        }
        return channelRepo.save(c);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String,String>> delete(@PathVariable String id, Authentication auth) {
        Channel c = visibleChannel(id, auth);
        requireManage(c, auth);
        messageRepo.deleteAll(messageRepo.findByChannelIdOrderByCreatedAtAsc(c.getId()));
        channelRepo.delete(c);
        return ResponseEntity.ok(Map.of("message","Deleted"));
    }

    @GetMapping("/{id}/messages")
    public PagedResponse<ChannelMessage> getMessages(
            @PathVariable String id,
            @RequestParam(defaultValue = "0")  int page,
            @RequestParam(defaultValue = "100") int size, Authentication auth) {
        visibleChannel(id, auth);
        return PagedResponse.ofList(
            messageRepo.findByChannelIdOrderByCreatedAtAsc(id).stream()
                .filter(m -> ws.getWorkspaceId() != null && ws.getWorkspaceId().equals(m.getOrganizationId())).toList(),
            page, Math.min(size, 500));
    }

    @PostMapping("/{id}/messages")
    public ChannelMessage postMessage(@PathVariable String id,
                                      @RequestBody ChannelMessage msg, Authentication auth) {
        Channel c = visibleChannel(id, auth);
        if (msg.getContent() == null || msg.getContent().isBlank()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Write a message.");
        if ("ANNOUNCEMENT".equalsIgnoreCase(c.getType()) && !isOwner(c, auth.getName()))
            visibility.requireLinkedWrite(c, ChannelController::peopleOf, x -> VisibilityService.projectsOf(x.getProjectId()));
        msg.setId(null);
        msg.setChannelId(id);
        msg.setOrganizationId(ws.getWorkspaceId());
        msg.setAuthorEmail(low(auth.getName()));
        msg.setAuthorName(workspacePeople().getOrDefault(low(auth.getName()), auth.getName()));
        msg.setCreatedAt(LocalDateTime.now());
        msg.setEdited(false);
        ChannelMessage saved = messageRepo.save(msg);
        c.setLastMessageAt(saved.getCreatedAt());
        channelRepo.save(c);
        return saved;
    }

    @DeleteMapping("/{id}/messages/{msgId}")
    public ResponseEntity<Map<String,String>> deleteMessage(@PathVariable String id,
                                                             @PathVariable String msgId, Authentication auth) {
        Channel c = visibleChannel(id, auth);
        messageRepo.findById(msgId).filter(m -> id.equals(m.getChannelId())).ifPresent(m -> {
            boolean mine = m.getAuthorEmail() != null && m.getAuthorEmail().equalsIgnoreCase(auth.getName());
            if (!mine) {
                // in a private channel its owners moderate; elsewhere, someone who manages planning records
                if (c.isPrivate()) { if (!isOwner(c, auth.getName())) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Only the author or a channel owner can delete this."); }
                else visibility.requireCapability(com.prowosma.backend.access.AccessConstants.CAP_MANAGE_PLANNING);
            }
            messageRepo.delete(m);
        });
        return ResponseEntity.ok(Map.of("message","Deleted"));
    }
}
