package com.prowosma.backend;

import com.prowosma.backend.config.JwtUtil;
import com.prowosma.backend.model.ActivityLog;
import com.prowosma.backend.model.RateLimitWindow;
import com.prowosma.backend.model.TeamMember;
import com.prowosma.backend.model.User;
import com.prowosma.backend.repository.TeamMemberRepository;
import com.prowosma.backend.repository.UserRepository;
import com.prowosma.backend.repository.WorkspaceRepository;
import com.prowosma.backend.model.Workspace;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * Base class for all Prowosma integration tests.
 *
 * Uses Flapdoodle embedded MongoDB (auto-started by Spring Boot test slice).
 * Each test class gets a fresh database via @DirtiesContext or repository.deleteAll().
 *
 * Provides helper methods:
 *   ownerToken()  — JWT for a workspace owner
 *   memberToken() — JWT for a regular member
 *   adminToken()  — JWT for a workspace admin
 *   authHeader()  — "Authorization: Bearer …" header value
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
public abstract class ProwosmaTestBase {

    @Autowired protected MockMvc mvc;
    @Autowired protected JwtUtil jwtUtil;
    @Autowired protected UserRepository userRepository;
    @Autowired protected WorkspaceRepository workspaceRepository;
    @Autowired protected TeamMemberRepository teamMemberRepository;
    @Autowired protected PasswordEncoder passwordEncoder;
    @Autowired protected MongoTemplate mongoTemplate;

    protected String ownerEmail   = "owner@test.com";
    protected String memberEmail  = "member@test.com";
    protected String adminEmail   = "admin@test.com";
    protected String workspaceId;

    @BeforeEach
    void baseSetup() {
        // Clean state
        userRepository.deleteAll();
        workspaceRepository.deleteAll();
        teamMemberRepository.deleteAll();
        // RateLimitFilter buckets by wall-clock epoch minute (see
        // RateLimitFilter.doFilterInternal), not per-test — without
        // clearing this collection here, a request count from an earlier
        // test method in the same class (same real-world minute, same
        // "user:<email>" client key) silently carries over and makes a
        // later test see an already-exhausted quota.
        mongoTemplate.remove(new org.springframework.data.mongodb.core.query.Query(), RateLimitWindow.class);

        // Create owner
        User owner = new User();
        owner.setEmail(ownerEmail);
        owner.setName("Test Owner");
        owner.setPassword(passwordEncoder.encode("pass"));
        owner.setRole("USER");
        userRepository.save(owner);

        // Create workspace
        Workspace ws = new Workspace();
        ws.setId(UUID.randomUUID().toString());
        ws.setName("Test Workspace");
        ws.setOwnerEmail(ownerEmail);
        ws.setCurrency("INR");
        ws.setDateFormat("DD/MM/YYYY");
        workspaceId = workspaceRepository.save(ws).getId();

        // Create member
        User member = new User();
        member.setEmail(memberEmail);
        member.setName("Test Member");
        member.setPassword(passwordEncoder.encode("pass"));
        member.setRole("USER");
        userRepository.save(member);

        // Create admin
        User admin = new User();
        admin.setEmail(adminEmail);
        admin.setName("Test Admin");
        admin.setPassword(passwordEncoder.encode("pass"));
        admin.setRole("USER");
        userRepository.save(admin);

        // Give member/admin an actual TeamMember record in this workspace.
        // The owner doesn't need one — WorkspaceFilter.isOwnerOrMember() and
        // RoleGuardFilter.resolveRole() both treat Workspace.ownerEmail as
        // OWNER regardless of a TeamMember record — but member/admin have no
        // such fallback: without this, WorkspaceFilter's membership check
        // (see WorkspaceFilter.isOwnerOrMember) rejects every request from
        // memberToken()/adminToken() with 403 "not a member of this
        // workspace", which has nothing to do with whatever the test is
        // actually trying to exercise.
        TeamMember memberRecord = new TeamMember();
        memberRecord.setOrganizationId(workspaceId);
        memberRecord.setEmail(memberEmail);
        memberRecord.setName("Test Member");
        memberRecord.setRole("MEMBER");
        teamMemberRepository.save(memberRecord);

        TeamMember adminRecord = new TeamMember();
        adminRecord.setOrganizationId(workspaceId);
        adminRecord.setEmail(adminEmail);
        adminRecord.setName("Test Admin");
        adminRecord.setRole("ADMIN");
        teamMemberRepository.save(adminRecord);
    }

    protected String ownerToken()  { return jwtUtil.generateToken(ownerEmail);  }
    protected String memberToken() { return jwtUtil.generateToken(memberEmail);  }
    protected String adminToken()  { return jwtUtil.generateToken(adminEmail);   }
    protected String authHeader(String token) { return "Bearer " + token; }

    /**
     * Test-only bulk-clear for activity logs, via MongoTemplate directly.
     * ActivityLogRepository deliberately no longer exposes any delete
     * method to application code (see ImmutableMongoRepository) — that's
     * exactly what makes the audit trail trustworthy, but tests still
     * legitimately need to reset state between runs, so this goes around
     * the repository the same way RetentionEnforcementService's one
     * sanctioned production purge path does, rather than reintroducing a
     * delete method on the repository interface just for test convenience.
     */
    protected void clearActivityLogs() {
        mongoTemplate.remove(new Query(), ActivityLog.class);
    }
}