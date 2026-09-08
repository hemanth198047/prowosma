package com.prowosma.backend.controller;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.Doc;
import com.prowosma.backend.model.Task;
import com.prowosma.backend.model.TeamMember;
import com.prowosma.backend.repository.*;
import com.prowosma.backend.service.AIService;
import com.prowosma.backend.service.TeamMemberService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Expertise & Talent Intelligence
 * - Infers expertise from task/doc/comment activity
 * - Expert finder (who knows X?)
 * - Skill gap analysis
 * - Mentor matching
 * - Expertise graph data
 * - Tribal knowledge detection
 */
@RestController
@RequestMapping("/api/expertise")
@RequiredArgsConstructor
public class ExpertiseController {

    private final TeamMemberService     teamMemberService;
    private final TeamMemberRepository  teamMemberRepository;
    private final TaskRepository        taskRepository;
    private final DocRepository         docRepository;
    private final GoalRepository        goalRepository;
    private final WorkspaceContext      ws;
    private final AIService             aiService;

    // ── Build / refresh inferred expertise from activity ─────
    @PostMapping("/infer")
    public ResponseEntity<Map<String, Object>> inferExpertise() {
        String orgId   = ws.getWorkspaceId();
        List<TeamMember> members = teamMemberRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();
        List<Task>       tasks   = taskRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();
        List<Doc>        docs    = docRepository.findByWorkspaceIdAndDeletedFalse(orgId);

        int updated = 0;
        for (TeamMember m : members) {
            Map<String, Integer> scores = new LinkedHashMap<>();

            // ── 1. Task tag frequency ─────────────────────
            tasks.stream()
                .filter(t -> (t.getAssigneeIds() != null && t.getAssigneeIds().contains(m.getEmail()))
                    || m.getEmail().equals(t.getCreatedBy()))
                .forEach(t -> {
                    if (t.getTags() != null) {
                        t.getTags().forEach(tag -> scores.merge(normalise(tag), 3, Integer::sum));
                    }
                    // Completed tasks weight more
                    if ("DONE".equals(t.getStatus())) scores.merge("delivery", 1, Integer::sum);
                });

            // ── 2. Docs authored ─────────────────────────
            docs.stream()
                .filter(d -> m.getEmail().equals(d.getCreatedBy()))
                .forEach(d -> {
                    if (d.getTags() != null)
                        d.getTags().forEach(tag -> scores.merge(normalise(tag), 2, Integer::sum));
                    if (d.getCategory() != null && !d.getCategory().isBlank())
                        scores.merge(normalise(d.getCategory()), 2, Integer::sum);
                });

            // ── 3. Comment activity ───────────────────────
            tasks.forEach(t -> {
                if (t.getComments() != null) {
                    t.getComments().stream()
                        .filter(c -> m.getEmail().equals(c.getAuthor()) || m.getName().equals(c.getAuthor()))
                        .forEach(c -> scores.merge("communication", 1, Integer::sum));
                }
            });

            // ── 4. Declared skills boost ──────────────────
            if (m.getSkills() != null)
                m.getSkills().forEach(s -> scores.merge(normalise(s), 5, Integer::sum));

            // Keep top 15 by score, sorted descending
            Map<String, Integer> top = scores.entrySet().stream()
                .sorted(Map.Entry.<String, Integer>comparingByValue().reversed())
                .limit(15)
                .collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue, (a,b)->a, LinkedHashMap::new));

            m.setInferredExpertise(top);
            m.setProfileUpdatedAt(LocalDateTime.now());
            teamMemberRepository.save(m);
            updated++;
        }
        Map<String, Object> inferResult = new LinkedHashMap<>();
        inferResult.put("membersUpdated", updated);
        inferResult.put("message", "Expertise inferred from activity");
        return ResponseEntity.ok(inferResult);
    }

    // ── Expert finder: "who knows X?" ────────────────────────
    @GetMapping("/find")
    public ResponseEntity<List<Map<String, Object>>> findExperts(
            @RequestParam String skill,
            @RequestParam(defaultValue = "5") int limit) {

        String orgId   = ws.getWorkspaceId();
        String normSkill = normalise(skill);
        List<TeamMember> members = teamMemberRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();

        List<Map<String, Object>> results = members.stream().map(m -> {
            // Declared skill score (highest)
            int declaredScore = (m.getSkills() != null && m.getSkills().stream()
                .anyMatch(s -> normalise(s).contains(normSkill) || normSkill.contains(normalise(s)))) ? 80 : 0;

            // Inferred score from activity
            int inferredScore = 0;
            if (m.getInferredExpertise() != null) {
                inferredScore = m.getInferredExpertise().entrySet().stream()
                    .filter(e -> e.getKey().contains(normSkill) || normSkill.contains(e.getKey()))
                    .mapToInt(Map.Entry::getValue)
                    .sum();
            }

            // Mentor bonus
            int mentorBonus = (m.getMentorFor() != null && m.getMentorFor().stream()
                .anyMatch(s -> normalise(s).contains(normSkill))) ? 20 : 0;

            int totalScore = declaredScore + Math.min(inferredScore, 60) + mentorBonus;
            Map<String, Object> memberInfo = new LinkedHashMap<>();
            memberInfo.put("id",              m.getId());
            memberInfo.put("name",            m.getName());
            memberInfo.put("email",           m.getEmail());
            memberInfo.put("title",           m.getTitle() != null ? m.getTitle() : "");
            memberInfo.put("department",      m.getDepartment() != null ? m.getDepartment() : "");
            memberInfo.put("avatar",          m.getAvatar() != null ? m.getAvatar() : "");
            memberInfo.put("color",           m.getColor() != null ? m.getColor() : "#6366f1");
            memberInfo.put("availability",    m.getAvailability() != null ? m.getAvailability() : "FULL");
            memberInfo.put("capacityPercent", m.getCapacityPercent());
            memberInfo.put("canMentor",       mentorBonus > 0);
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("member",        memberInfo);
            result.put("score",         totalScore);
            result.put("declaredSkill", declaredScore > 0);
            result.put("inferredSkill", inferredScore > 0);
            result.put("canMentor",     mentorBonus > 0);
            return result;
        })
        .filter(r -> (int)r.get("score") > 0)
        .sorted(Comparator.comparingInt(r -> -(int)r.get("score")))
        .limit(limit)
        .collect(Collectors.toList());

        return ResponseEntity.ok(results);
    }

    // ── Team skill map (all skills across team) ───────────────
    @GetMapping("/skills")
    public ResponseEntity<Map<String, Object>> teamSkillMap() {
        String orgId  = ws.getWorkspaceId();
        List<TeamMember> members = teamMemberRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();

        // Aggregate all skill frequencies
        Map<String, Integer> skillFreq  = new LinkedHashMap<>();
        Map<String, List<String>> skillOwners = new LinkedHashMap<>();

        members.forEach(m -> {
            List<String> allSkills = new ArrayList<>();
            if (m.getSkills() != null) allSkills.addAll(m.getSkills());
            allSkills.forEach(s -> {
                skillFreq.merge(s, 1, Integer::sum);
                skillOwners.computeIfAbsent(s, k -> new ArrayList<>()).add(m.getName());
            });
            // Also include inferred
            if (m.getInferredExpertise() != null) {
                m.getInferredExpertise().entrySet().stream()
                    .filter(e -> e.getValue() >= 5)
                    .forEach(e -> skillFreq.merge(e.getKey(), 1, Integer::sum));
            }
        });

        // Sort by frequency
        List<Map<String, Object>> skills = skillFreq.entrySet().stream()
            .sorted(Map.Entry.<String, Integer>comparingByValue().reversed())
            .map(e -> {
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("skill",  e.getKey());
                row.put("count",  (Object) e.getValue());
                row.put("owners", (Object) skillOwners.getOrDefault(e.getKey(), List.of()));
                return row;
            })
            .collect(Collectors.toList());

        Map<String, Object> skillMapResult = new LinkedHashMap<>();
        skillMapResult.put("skills", skills);
        skillMapResult.put("totalUniqueSkills", skills.size());
        skillMapResult.put("totalMembers", members.size());
        return ResponseEntity.ok(skillMapResult);
    }

    // ── Skill gap analysis ────────────────────────────────────
    @GetMapping("/gaps")
    public ResponseEntity<Map<String, Object>> skillGaps() {
        String orgId  = ws.getWorkspaceId();
        List<TeamMember> members = teamMemberRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();
        List<Task>       tasks   = taskRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();

        // Tags on tasks that have NO assigned member with matching skill = skill gap
        Map<String, Long> taskTagDemand = tasks.stream()
            .filter(t -> !"DONE".equals(t.getStatus()) && t.getTags() != null)
            .flatMap(t -> t.getTags().stream())
            .collect(Collectors.groupingBy(normalise -> normalise(normalise), Collectors.counting()));

        Set<String> coveredSkills = members.stream()
            .flatMap(m -> m.getSkills() != null ? m.getSkills().stream() : java.util.stream.Stream.empty())
            .map(this::normalise)
            .collect(Collectors.toSet());

        List<Map<String, Object>> gaps = taskTagDemand.entrySet().stream()
            .filter(e -> !coveredSkills.contains(e.getKey()))
            .sorted(Map.Entry.<String, Long>comparingByValue().reversed())
            .limit(10)
            .map(e -> {
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("skill", e.getKey());
                row.put("openTaskCount", (Object) e.getValue());
                row.put("priority", e.getValue() > 5 ? "HIGH" : e.getValue() > 2 ? "MEDIUM" : "LOW");
                return row;
            })
            .collect(Collectors.toList());

        // "Looking to learn" vs available mentors
        List<Map<String, Object>> mentorableSkills = new ArrayList<>();
        members.forEach(m -> {
            if (m.getLookingToLearn() != null) {
                m.getLookingToLearn().forEach(skill -> {
                    String norm = normalise(skill);
                    long mentorCount = members.stream()
                        .filter(x -> x.getMentorFor() != null && x.getMentorFor().stream()
                            .anyMatch(ms -> normalise(ms).equals(norm)))
                        .count();
                    Map<String, Object> ms = new LinkedHashMap<>();
                    ms.put("learner", m.getName());
                    ms.put("skill", skill);
                    ms.put("availableMentors", (Object) mentorCount);
                    mentorableSkills.add(ms);
                });
            }
        });

        Map<String, Object> gapResult = new LinkedHashMap<>();
        gapResult.put("skillGaps", gaps);
        gapResult.put("mentorableSkills", mentorableSkills);
        gapResult.put("gapCount", gaps.size());
        return ResponseEntity.ok(gapResult);
    }

    // ── Mentor matching ───────────────────────────────────────
    @GetMapping("/mentors")
    public ResponseEntity<List<Map<String, Object>>> findMentors(
            @RequestParam(required = false) String skill) {

        String orgId  = ws.getWorkspaceId();
        List<TeamMember> members = teamMemberRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();

        List<Map<String, Object>> mentors = members.stream()
            .filter(m -> m.getMentorFor() != null && !m.getMentorFor().isEmpty())
            .filter(m -> skill == null || m.getMentorFor().stream()
                .anyMatch(s -> normalise(s).contains(normalise(skill)) || normalise(skill).contains(normalise(s))))
            .map(m -> {
                // Find learners for each mentor
                List<String> matchedLearners = members.stream()
                    .filter(l -> l.getLookingToLearn() != null && !l.getEmail().equals(m.getEmail()))
                    .filter(l -> m.getMentorFor().stream().anyMatch(ms ->
                        l.getLookingToLearn().stream().anyMatch(ls -> normalise(ls).contains(normalise(ms)))))
                    .map(TeamMember::getName)
                    .collect(Collectors.toList());

                Map<String, Object> mentorInfo = new LinkedHashMap<>();
                mentorInfo.put("id",           m.getId());
                mentorInfo.put("name",         m.getName());
                mentorInfo.put("email",        m.getEmail());
                mentorInfo.put("title",        m.getTitle() != null ? m.getTitle() : "");
                mentorInfo.put("color",        m.getColor() != null ? m.getColor() : "#6366f1");
                mentorInfo.put("availability", m.getAvailability() != null ? m.getAvailability() : "FULL");
                Map<String, Object> mentorRow = new LinkedHashMap<>();
                mentorRow.put("mentor",          mentorInfo);
                mentorRow.put("mentorFor",       m.getMentorFor());
                mentorRow.put("matchedLearners", matchedLearners);
                mentorRow.put("matchCount",      matchedLearners.size());
                return mentorRow;
            })
            .sorted(Comparator.comparingInt(r -> -((List<?>) r.get("matchedLearners")).size()))
            .collect(Collectors.toList());

        return ResponseEntity.ok(mentors);
    }

    // ── Tribal knowledge detection ────────────────────────────
    @GetMapping("/tribal-knowledge")
    public ResponseEntity<List<Map<String, Object>>> tribalKnowledge() {
        String orgId  = ws.getWorkspaceId();
        List<TeamMember> members = teamMemberRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();
        List<Task>       tasks   = taskRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();
        List<Doc>        docs    = docRepository.findByWorkspaceIdAndDeletedFalse(orgId);

        List<Map<String, Object>> risks = new ArrayList<>();

        // Single-owner tasks (only one person knows this area)
        Map<String, Long> emailTaskCount = tasks.stream()
            .filter(t -> t.getAssigneeIds() != null && t.getAssigneeIds().size() == 1)
            .flatMap(t -> t.getAssigneeIds().stream())
            .collect(Collectors.groupingBy(e -> e, Collectors.counting()));

        emailTaskCount.entrySet().stream()
            .filter(e -> e.getValue() >= 5)
            .forEach(e -> {
                String email = e.getKey();
                members.stream().filter(m -> m.getEmail().equals(email)).findFirst().ifPresent(m -> {
                    List<String> soleTags = tasks.stream()
                        .filter(t -> t.getAssigneeIds() != null && t.getAssigneeIds().size() == 1
                            && t.getAssigneeIds().contains(email) && t.getTags() != null)
                        .flatMap(t -> t.getTags().stream())
                        .distinct().limit(5).collect(Collectors.toList());
                    Map<String, Object> taskRisk = new LinkedHashMap<>();
                    taskRisk.put("type",        "SOLE_TASK_OWNER");
                    taskRisk.put("person",      m.getName());
                    taskRisk.put("email",       email);
                    taskRisk.put("taskCount",   (Object) e.getValue());
                    taskRisk.put("areas",       soleTags);
                    taskRisk.put("risk",        e.getValue() >= 10 ? "HIGH" : "MEDIUM");
                    taskRisk.put("description", "Only person assigned to " + e.getValue() + " tasks in areas: " + soleTags);
                    risks.add(taskRisk);
                });
            });

        // Single doc author
        Map<String, Long> emailDocCount = docs.stream()
            .filter(d -> d.getCreatedBy() != null)
            .collect(Collectors.groupingBy(Doc::getCreatedBy, Collectors.counting()));

        emailDocCount.entrySet().stream()
            .filter(e -> e.getValue() >= 3)
            .forEach(e -> {
                String email = e.getKey();
                members.stream().filter(m -> m.getEmail().equals(email)).findFirst().ifPresent(m -> {
                    Map<String, Object> docRisk = new LinkedHashMap<>();
                    docRisk.put("type",        "SOLE_DOC_AUTHOR");
                    docRisk.put("person",      m.getName());
                    docRisk.put("email",       email);
                    docRisk.put("docCount",    (Object) e.getValue());
                    docRisk.put("areas",       List.of());
                    docRisk.put("risk",        "MEDIUM");
                    docRisk.put("description", "Authors " + e.getValue() + " documents with no co-authors");
                    risks.add(docRisk);
                });
            });

        risks.sort(Comparator.comparing(r -> r.get("risk").equals("HIGH") ? 0 : 1));
        return ResponseEntity.ok(risks);
    }

    // ── AI-powered expert recommendation ─────────────────────
    @PostMapping("/ai-recommend")
    public ResponseEntity<Map<String, Object>> aiRecommend(@RequestBody Map<String, Object> body) {
        String query   = (String) body.getOrDefault("query", "");
        String orgId   = ws.getWorkspaceId();
        List<TeamMember> members = teamMemberRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();

        String teamContext = members.stream()
            .map(m -> m.getName() + " (" + (m.getTitle() != null ? m.getTitle() : "Member") + ")"
                + " skills: " + (m.getSkills() != null ? String.join(",", m.getSkills()) : "none")
                + " mentors: " + (m.getMentorFor() != null ? String.join(",", m.getMentorFor()) : "none"))
            .collect(Collectors.joining("\n"));

        String prompt = "You are a talent advisor. Given this team roster and skills, answer the question: " + query
            + "\n\nTeam:\n" + teamContext
            + "\n\nProvide a specific recommendation with names and reasoning. Be concise (3-5 sentences).";

        try {
            String recommendation = aiService.ask(prompt, query);
            Map<String, Object> aiOk = new LinkedHashMap<>();
            aiOk.put("query", query); aiOk.put("recommendation", recommendation);
            aiOk.put("memberCount", members.size());
            return ResponseEntity.ok(aiOk);
        } catch (Exception e) {
            Map<String, Object> aiErr = new LinkedHashMap<>();
            aiErr.put("query", query);
            aiErr.put("recommendation", "AI unavailable. Based on declared skills, use the Expert Finder above.");
            aiErr.put("memberCount", members.size());
            return ResponseEntity.ok(aiErr);
        }
    }

    // ── Member profile update (skills/bio/mentor) ─────────────
    @PatchMapping("/members/{id}/profile")
    public ResponseEntity<TeamMember> updateProfile(
            @PathVariable String id,
            @RequestBody Map<String, Object> body) {

        return teamMemberRepository.findById(id).map(m -> {
            if (body.containsKey("skills"))        m.setSkills(castList(body.get("skills")));
            if (body.containsKey("domains"))       m.setDomains(castList(body.get("domains")));
            if (body.containsKey("mentorFor"))     m.setMentorFor(castList(body.get("mentorFor")));
            if (body.containsKey("lookingToLearn"))m.setLookingToLearn(castList(body.get("lookingToLearn")));
            if (body.containsKey("bio"))           m.setBio((String) body.get("bio"));
            if (body.containsKey("title"))         m.setTitle((String) body.get("title"));
            if (body.containsKey("department"))    m.setDepartment((String) body.get("department"));
            if (body.containsKey("location"))      m.setLocation((String) body.get("location"));
            if (body.containsKey("availability"))  m.setAvailability((String) body.get("availability"));
            if (body.containsKey("capacityPercent"))
                m.setCapacityPercent(((Number) body.get("capacityPercent")).intValue());
            m.setProfileUpdatedAt(LocalDateTime.now());
            return ResponseEntity.ok(teamMemberRepository.save(m));
        }).orElse(ResponseEntity.notFound().build());
    }

    // ── Expertise graph data (nodes + edges) ──────────────────
    @GetMapping("/graph")
    public ResponseEntity<Map<String, Object>> expertiseGraph() {
        String orgId  = ws.getWorkspaceId();
        List<TeamMember> members = teamMemberRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();

        // Nodes: people + skill nodes
        List<Map<String, Object>> nodes = new ArrayList<>();
        List<Map<String, Object>> edges = new ArrayList<>();

        Set<String> skillNodes = new LinkedHashSet<>();

        members.forEach(m -> {
            Map<String, Object> personNode = new LinkedHashMap<>();
            personNode.put("id",         "person_" + m.getId());
            personNode.put("label",      m.getName());
            personNode.put("type",       "PERSON");
            personNode.put("color",      m.getColor() != null ? m.getColor() : "#6366f1");
            personNode.put("title",      m.getTitle() != null ? m.getTitle() : "");
            personNode.put("department", m.getDepartment() != null ? m.getDepartment() : "");
            nodes.add(personNode);

            List<String> allSkills = new ArrayList<>();
            if (m.getSkills() != null) allSkills.addAll(m.getSkills());
            allSkills.forEach(s -> {
                String skillId = "skill_" + normalise(s);
                skillNodes.add(s);
                Map<String, Object> e1 = new LinkedHashMap<>();
                e1.put("from", "person_" + m.getId()); e1.put("to", skillId);
                e1.put("type", "HAS_SKILL"); e1.put("weight", 3);
                edges.add(e1);
            });

            if (m.getMentorFor() != null) {
                m.getMentorFor().forEach(s -> {
                    String skillId = "skill_" + normalise(s);
                    skillNodes.add(s);
                    Map<String, Object> e2 = new LinkedHashMap<>();
                    e2.put("from", "person_" + m.getId()); e2.put("to", skillId);
                    e2.put("type", "MENTORS"); e2.put("weight", 2);
                    edges.add(e2);
                });
            }
        });

        // Skill nodes
        skillNodes.forEach(s -> {
            Map<String, Object> skillNode = new LinkedHashMap<>();
            skillNode.put("id",    "skill_" + normalise(s));
            skillNode.put("label", s);
            skillNode.put("type",  "SKILL");
            skillNode.put("color", "#10b981");
            nodes.add(skillNode);
        });

        // Person-to-person edges (share skills)
        for (int i = 0; i < members.size(); i++) {
            for (int j = i + 1; j < members.size(); j++) {
                TeamMember a = members.get(i), b = members.get(j);
                List<String> aSkills = a.getSkills() != null ? a.getSkills() : List.of();
                List<String> bSkills = b.getSkills() != null ? b.getSkills() : List.of();
                long shared = aSkills.stream()
                    .filter(s -> bSkills.stream().anyMatch(bs -> normalise(bs).equals(normalise(s))))
                    .count();
                if (shared > 0) {
                    Map<String, Object> e3 = new LinkedHashMap<>();
                    e3.put("from", "person_" + a.getId());
                    e3.put("to", "person_" + b.getId());
                    e3.put("type", "SHARES_SKILL");
                    e3.put("weight", (int) shared);
                    edges.add(e3);
                }
            }
        }

        Map<String, Object> graphResult = new LinkedHashMap<>();
        graphResult.put("nodes", nodes);
        graphResult.put("edges", edges);
        return ResponseEntity.ok(graphResult);
    }

    // ── Helpers ───────────────────────────────────────────────
    private String normalise(String s) {
        return s == null ? "" : s.toLowerCase().trim().replaceAll("[^a-z0-9+#.]", "");
    }

    @SuppressWarnings("unchecked")
    private List<String> castList(Object o) {
        if (o instanceof List) return (List<String>) o;
        return new ArrayList<>();
    }
}
