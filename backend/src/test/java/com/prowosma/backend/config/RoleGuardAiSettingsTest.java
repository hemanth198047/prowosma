package com.prowosma.backend.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.model.TeamMember;
import com.prowosma.backend.model.Workspace;
import com.prowosma.backend.repository.TeamMemberRepository;
import com.prowosma.backend.repository.WorkspaceRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.lang.reflect.Proxy;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Runs the REAL RoleGuardFilter (no Spring context, no database) to prove who may change the AI settings. Before the fix any member could overwrite the
 * workspace's AI provider key or switch AI on and off; reading is still open to everyone signed in — the key itself is never returned.
 */
@DisplayName("AI settings: who may change them")
class RoleGuardAiSettingsTest {

    private static final String WS = "ws1";
    private static final Map<String, String> ROLES = Map.of("admin@x.com", "ADMIN", "member@x.com", "MEMBER", "viewer@x.com", "VIEWER");

    private RoleGuardFilter filter;

    @BeforeEach
    void setUp() {
        TeamMemberRepository team = (TeamMemberRepository) Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[]{TeamMemberRepository.class}, (p, m, a) -> {
            if (m.getName().equals("findAllByEmailAndOrganizationId")) {
                String role = ROLES.get((String) a[0]);
                if (role == null) return List.of();
                TeamMember t = new TeamMember();
                t.setEmail((String) a[0]);
                t.setOrganizationId((String) a[1]);
                t.setRole(role);
                return List.of(t);
            }
            throw new UnsupportedOperationException(m.getName());
        });
        WorkspaceRepository workspaces = (WorkspaceRepository) Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[]{WorkspaceRepository.class}, (p, m, a) -> {
            if (m.getName().equals("findById")) {
                Workspace w = new Workspace();
                w.setOwnerEmail("owner@x.com");
                return Optional.of(w);
            }
            if (m.getName().equals("findByOwnerEmail")) return List.of();
            throw new UnsupportedOperationException(m.getName());
        });
        WorkspaceContext ctx = new WorkspaceContext();
        ctx.setWorkspaceId(WS);
        filter = new RoleGuardFilter(team, workspaces, ctx, new ObjectMapper());
    }

    @AfterEach void clear() { SecurityContextHolder.clearContext(); }

    private record Outcome(int status, boolean passed, String body) {}

    private Outcome call(String email, String method, String path) throws Exception {
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(email, "n/a", List.of()));
        MockHttpServletRequest req = new MockHttpServletRequest(method, path);
        req.setRequestURI(path);
        MockHttpServletResponse res = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();
        filter.doFilter(req, res, chain);
        return new Outcome(res.getStatus(), chain.getRequest() != null, res.getContentAsString());
    }

    @ParameterizedTest(name = "a MEMBER is refused: {0} {1}")
    @CsvSource({"POST,/api/ai/settings", "PATCH,/api/ai/settings/toggle", "PATCH,/api/ai/settings/features/task_assistant", "PUT,/api/ai/settings", "DELETE,/api/ai/settings"})
    @DisplayName("a plain member can't change the AI settings, key, provider, on/off or features")
    void memberIsRefused(String method, String path) throws Exception {
        Outcome o = call("member@x.com", method, path);
        assertThat(o.status()).isEqualTo(403);
        assertThat(o.passed()).isFalse();                                       // the request never reached the controller
        assertThat(o.body()).contains("Only Admins and the workspace Manager can change AI settings.");
    }

    @ParameterizedTest(name = "{0} is allowed: {1} {2}")
    @CsvSource({"admin@x.com,POST,/api/ai/settings", "owner@x.com,POST,/api/ai/settings", "admin@x.com,PATCH,/api/ai/settings/toggle", "owner@x.com,PATCH,/api/ai/settings/features/chat"})
    @DisplayName("admins and the workspace owner still can")
    void adminsAndOwnerAreAllowed(String who, String method, String path) throws Exception {
        Outcome o = call(who, method, path);
        assertThat(o.passed()).isTrue();
        assertThat(o.status()).isEqualTo(200);
    }

    @Test @DisplayName("everyone signed in can still READ the settings (the key is never in the response), including viewers")
    void readingIsOpen() throws Exception {
        for (String who : new String[]{"member@x.com", "viewer@x.com", "admin@x.com", "owner@x.com"}) {
            Outcome o = call(who, "GET", "/api/ai/settings");
            assertThat(o.passed()).as(who).isTrue();
            assertThat(o.status()).isEqualTo(200);
        }
        assertThat(call("member@x.com", "GET", "/api/ai/status").passed()).isTrue();
    }

    @Test @DisplayName("viewers stay read-only, and people who aren't in the workspace get nothing")
    void viewersAndOutsiders() throws Exception {
        Outcome viewer = call("viewer@x.com", "POST", "/api/ai/settings");
        assertThat(viewer.status()).isEqualTo(403);
        assertThat(viewer.body()).contains("read-only");
        Outcome outsider = call("stranger@x.com", "POST", "/api/ai/settings");
        assertThat(outsider.status()).isEqualTo(403);
        assertThat(outsider.body()).contains("not a member of this workspace");
        assertThat(outsider.passed()).isFalse();
    }

    @ParameterizedTest(name = "a MEMBER can still use AI: {0}")
    @CsvSource({"/api/ai/task-assistant", "/api/ai/chat", "/api/ai/summarize", "/api/ai/anything-else"})
    @DisplayName("members can still USE the AI features — only changing the settings is restricted")
    void membersCanUseAi(String path) throws Exception {
        Outcome o = call("member@x.com", "POST", path);
        assertThat(o.passed()).isTrue();
        assertThat(o.status()).isEqualTo(200);
    }

    @Test @DisplayName("the other rules are unchanged: members still manage tasks, can't manage the team, and admin-only paths stay admin-only")
    void otherRulesUnchanged() throws Exception {
        assertThat(call("member@x.com", "POST", "/api/tasks").passed()).isTrue();
        assertThat(call("member@x.com", "PUT", "/api/team/123").status()).isEqualTo(403);
        assertThat(call("admin@x.com", "PUT", "/api/team/123").passed()).isTrue();
        assertThat(call("member@x.com", "GET", "/api/admin/users").status()).isEqualTo(403);
        assertThat(call("admin@x.com", "GET", "/api/admin/users").passed()).isTrue();
        assertThat(call("member@x.com", "POST", "/api/workspaces/ws1/anything").status()).isEqualTo(403);
    }
}
