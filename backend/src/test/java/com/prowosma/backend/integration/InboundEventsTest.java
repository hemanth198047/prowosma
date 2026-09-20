package com.prowosma.backend.integration;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.model.Task;
import com.prowosma.backend.repository.TaskRepository;
import com.prowosma.backend.tenant.TwoWorkspaceTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Datadog, Sentry and Jenkins post events to a public URL whose secret identifies one
 * integration, and so one workspace. These tests drive the whole path: token issue,
 * authentication, task creation/reopen/resolve, and the boundaries (wrong or rotated token,
 * disabled integration, bad payload, Sentry signature, and other workspaces).
 */
@DisplayName("Inbound events — Datadog / Sentry / Jenkins to tasks")
class InboundEventsTest extends TwoWorkspaceTestBase {

    @Autowired private TaskRepository taskRepository;
    @Autowired private ObjectMapper   objectMapper;

    private static final String DD_TRIGGERED = "{\"title\":\"[Triggered on {host:web-1}] High CPU on web\",\"body\":\"CPU above 90%\","
            + "\"alert_id\":\"1234567\",\"alert_transition\":\"Triggered\",\"alert_type\":\"error\",\"priority\":\"P2\","
            + "\"link\":\"https://app.datadoghq.com/monitors/1234567\",\"tags\":\"env:prod,service:web\"}";
    private static final String DD_RECOVERED = "{\"title\":\"[Recovered on {host:web-1}] High CPU on web\","
            + "\"alert_id\":\"1234567\",\"alert_transition\":\"Recovered\",\"alert_type\":\"success\"}";

    // ── helpers ──────────────────────────────────────────────────────────────

    private String saveIntegration(String key, String configJson, String token, String workspace) throws Exception {
        String body = mvc.perform(put("/api/integrations/" + key)
                .header("Authorization", authHeader(token)).header("X-Workspace-Id", workspace)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"enabled\":true,\"config\":" + configJson + "}"))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(body).get("id").asText();
    }

    /** Issues the inbound URL for an integration of workspace A; returns {@code /api/inbound-events/{source}/{token}}. */
    private String issuePath(String integrationId) throws Exception {
        String body = mvc.perform(post("/api/integrations/" + integrationId + "/inbound-token")
                .header("Authorization", authHeader(ownerToken())).header("X-Workspace-Id", workspaceId))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(body).get("path").asText();
    }

    private String send(String path, String json) throws Exception {
        return mvc.perform(post(path).contentType(MediaType.APPLICATION_JSON).content(json))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();
    }

    private List<Task> tasksFor(String workspace, String ref) {
        return taskRepository.findByOrganizationIdAndExternalRef(workspace, ref);
    }

    private String datadogPath() throws Exception {
        return issuePath(saveIntegration("DATADOG", "{}", ownerToken(), workspaceId));
    }

    // ── the lifecycle ────────────────────────────────────────────────────────

    @Test
    @DisplayName("a triggered Datadog monitor, posted with no login, creates a task in the integration's workspace only")
    void triggered_createsTask() throws Exception {
        String path = datadogPath();

        String response = send(path, DD_TRIGGERED);
        assertThat(objectMapper.readTree(response).get("status").asText()).isEqualTo("created");

        List<Task> tasks = tasksFor(workspaceId, "inbound:datadog:1234567");
        assertThat(tasks).hasSize(1);
        Task task = tasks.get(0);
        assertThat(task.getTitle()).startsWith("[Datadog] ");
        assertThat(task.getTitle()).contains("High CPU on web");
        assertThat(task.getPriority()).isEqualTo("HIGH");
        assertThat(task.getStatus()).isEqualTo("TODO");
        assertThat(task.getTags()).contains("datadog", "incident");
        assertThat(task.getDescription()).contains("https://app.datadoghq.com/monitors/1234567");
        assertThat(tasksFor(otherWorkspaceId, "inbound:datadog:1234567")).isEmpty();
    }

    @Test
    @DisplayName("the same alert firing again does not create a second task")
    void repeat_isNotDuplicated() throws Exception {
        String path = datadogPath();
        send(path, DD_TRIGGERED);
        String again = send(path, DD_TRIGGERED);

        assertThat(objectMapper.readTree(again).get("status").asText()).isEqualTo("unchanged");
        assertThat(tasksFor(workspaceId, "inbound:datadog:1234567")).hasSize(1);
    }

    @Test
    @DisplayName("recovery closes the task, and the problem returning reopens the same task")
    void recoveryAndReturn() throws Exception {
        String path = datadogPath();
        send(path, DD_TRIGGERED);

        String resolved = send(path, DD_RECOVERED);
        assertThat(objectMapper.readTree(resolved).get("status").asText()).isEqualTo("resolved");
        assertThat(tasksFor(workspaceId, "inbound:datadog:1234567").get(0).getStatus()).isEqualTo("DONE");

        String reopened = send(path, DD_TRIGGERED);
        assertThat(objectMapper.readTree(reopened).get("status").asText()).isEqualTo("reopened");
        List<Task> tasks = tasksFor(workspaceId, "inbound:datadog:1234567");
        assertThat(tasks).hasSize(1);
        assertThat(tasks.get(0).getStatus()).isEqualTo("TODO");
    }

    @Test
    @DisplayName("a recovery for a problem that was never opened does nothing")
    void recoveryWithoutTask() throws Exception {
        String response = send(datadogPath(), DD_RECOVERED);
        assertThat(objectMapper.readTree(response).get("status").asText()).isEqualTo("unchanged");
        assertThat(tasksFor(workspaceId, "inbound:datadog:1234567")).isEmpty();
    }

    @Test
    @DisplayName("Jenkins: a failed build opens a task; a later good build of the same job closes it")
    void jenkins() throws Exception {
        String path = issuePath(saveIntegration("JENKINS", "{}", ownerToken(), workspaceId));
        String build = "{\"name\":\"backend-build\",\"build\":{\"full_url\":\"https://jenkins.acme.com/job/backend-build/42/\","
                + "\"number\":42,\"phase\":\"COMPLETED\",\"status\":\"%s\"}}";

        send(path, String.format(build, "FAILURE"));
        assertThat(tasksFor(workspaceId, "inbound:jenkins:backend-build").get(0).getStatus()).isEqualTo("TODO");
        send(path, String.format(build, "SUCCESS"));
        assertThat(tasksFor(workspaceId, "inbound:jenkins:backend-build").get(0).getStatus()).isEqualTo("DONE");
    }

    @Test
    @DisplayName("Sentry: a new issue opens a bug task")
    void sentry() throws Exception {
        String path = issuePath(saveIntegration("SENTRY", "{}", ownerToken(), workspaceId));
        send(path, "{\"action\":\"created\",\"data\":{\"issue\":{\"id\":\"4501\",\"title\":\"TypeError: x is undefined\","
                + "\"level\":\"error\",\"web_url\":\"https://sentry.io/organizations/acme/issues/4501/\",\"project\":{\"slug\":\"web\"}}}}");

        Task task = tasksFor(workspaceId, "inbound:sentry:4501").get(0);
        assertThat(task.getType()).isEqualTo("BUG");
        assertThat(task.getTitle()).isEqualTo("[Sentry] TypeError: x is undefined");
    }

    // ── authentication ───────────────────────────────────────────────────────

    @Test
    @DisplayName("an unknown, malformed or wrong-source token is an identical 404")
    void badTokens() throws Exception {
        String path = datadogPath();
        String token = path.substring(path.lastIndexOf('/') + 1);

        mvc.perform(post("/api/inbound-events/datadog/" + "A".repeat(43)).contentType(MediaType.APPLICATION_JSON).content(DD_TRIGGERED))
           .andExpect(status().isNotFound());
        mvc.perform(post("/api/inbound-events/datadog/short").contentType(MediaType.APPLICATION_JSON).content(DD_TRIGGERED))
           .andExpect(status().isNotFound());
        mvc.perform(post("/api/inbound-events/sentry/" + token).contentType(MediaType.APPLICATION_JSON).content("{}"))
           .andExpect(status().isNotFound());                              // a Datadog token is not a Sentry token
        mvc.perform(post("/api/inbound-events/github/" + token).contentType(MediaType.APPLICATION_JSON).content("{}"))
           .andExpect(status().isNotFound());                              // not an inbound source at all
        assertThat(tasksFor(workspaceId, "inbound:datadog:1234567")).isEmpty();
    }

    @Test
    @DisplayName("turning the integration off stops its URL working")
    void disabledIntegration() throws Exception {
        String id = saveIntegration("DATADOG", "{}", ownerToken(), workspaceId);
        String path = issuePath(id);
        mvc.perform(put("/api/integrations/DATADOG")
                .header("Authorization", authHeader(ownerToken())).header("X-Workspace-Id", workspaceId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"enabled\":false,\"config\":{}}"))
           .andExpect(status().isOk());

        mvc.perform(post(path).contentType(MediaType.APPLICATION_JSON).content(DD_TRIGGERED))
           .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("generating a new URL invalidates the old one")
    void rotation() throws Exception {
        String id = saveIntegration("DATADOG", "{}", ownerToken(), workspaceId);
        String oldPath = issuePath(id);
        String newPath = issuePath(id);

        assertThat(newPath).isNotEqualTo(oldPath);
        mvc.perform(post(oldPath).contentType(MediaType.APPLICATION_JSON).content(DD_TRIGGERED)).andExpect(status().isNotFound());
        mvc.perform(post(newPath).contentType(MediaType.APPLICATION_JSON).content(DD_TRIGGERED)).andExpect(status().isOk());
    }

    @Test
    @DisplayName("the secret is shown once: neither the token nor its hash ever appears in the integrations list")
    void tokenNeverListed() throws Exception {
        String id = saveIntegration("DATADOG", "{}", ownerToken(), workspaceId);
        String path = issuePath(id);
        String token = path.substring(path.lastIndexOf('/') + 1);

        String list = mvc.perform(get("/api/integrations")
                .header("Authorization", authHeader(ownerToken())).header("X-Workspace-Id", workspaceId))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();
        assertThat(list).contains(id);
        assertThat(list).doesNotContain(token);
        assertThat(list).doesNotContain(InboundTokens.hash(token));
        assertThat(list).doesNotContain("inboundTokenHash");
    }

    @Test
    @DisplayName("re-saving the integration form does not break its URL")
    void resavingKeepsToken() throws Exception {
        String id = saveIntegration("DATADOG", "{}", ownerToken(), workspaceId);
        String path = issuePath(id);
        saveIntegration("DATADOG", "{\"note\":\"edited\"}", ownerToken(), workspaceId);

        mvc.perform(post(path).contentType(MediaType.APPLICATION_JSON).content(DD_TRIGGERED)).andExpect(status().isOk());
    }

    @Test
    @DisplayName("'Save & Connect' in the UI (force-update, which replaces the record) does not break the URL")
    void forceUpdateKeepsToken() throws Exception {
        String id = saveIntegration("DATADOG", "{}", ownerToken(), workspaceId);
        String path = issuePath(id);

        String body = mvc.perform(post("/api/integrations/DATADOG/force-update")
                .header("Authorization", authHeader(ownerToken())).header("X-Workspace-Id", workspaceId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"key\":\"DATADOG\",\"type\":\"DATADOG\",\"name\":\"DATADOG\",\"enabled\":true,\"config\":{}}"))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();
        assertThat(objectMapper.readTree(body).get("id").asText()).isNotEqualTo(id);      // a new record, as before

        mvc.perform(post(path).contentType(MediaType.APPLICATION_JSON).content(DD_TRIGGERED)).andExpect(status().isOk());
    }

    @Test
    @DisplayName("a request body can't plant a token hash of the caller's choosing")
    void clientCannotSetHash() throws Exception {
        String chosen = InboundTokens.generate();
        mvc.perform(put("/api/integrations/DATADOG")
                .header("Authorization", authHeader(ownerToken())).header("X-Workspace-Id", workspaceId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"enabled\":true,\"config\":{},\"inboundTokenHash\":\"" + InboundTokens.hash(chosen) + "\"}"))
           .andExpect(status().isOk());

        mvc.perform(post("/api/inbound-events/datadog/" + chosen).contentType(MediaType.APPLICATION_JSON).content(DD_TRIGGERED))
           .andExpect(status().isNotFound());
    }

    // ── bad requests ─────────────────────────────────────────────────────────

    @Test
    @DisplayName("an empty body, invalid JSON, or a payload with nothing to act on is a 400")
    void badPayloads() throws Exception {
        String path = datadogPath();
        mvc.perform(post(path).contentType(MediaType.APPLICATION_JSON)).andExpect(status().isBadRequest());
        mvc.perform(post(path).contentType(MediaType.APPLICATION_JSON).content("not json")).andExpect(status().isBadRequest());
        mvc.perform(post(path).contentType(MediaType.APPLICATION_JSON).content("{\"body\":\"no title\"}")).andExpect(status().isBadRequest());
        mvc.perform(post(path).contentType(MediaType.APPLICATION_JSON).content("[1,2,3]")).andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("an oversized body is refused")
    void oversizedBody() throws Exception {
        String path = datadogPath();
        String huge = "{\"title\":\"" + "x".repeat(300 * 1024) + "\"}";
        mvc.perform(post(path).contentType(MediaType.APPLICATION_JSON).content(huge)).andExpect(status().isPayloadTooLarge());
    }

    // ── Sentry signature ─────────────────────────────────────────────────────

    private static final String SENTRY_BODY = "{\"action\":\"created\",\"data\":{\"issue\":{\"id\":\"77\",\"title\":\"Boom\",\"level\":\"error\"}}}";

    @Test
    @DisplayName("Sentry with a client secret configured: an unsigned or wrongly signed call is refused, a correctly signed one accepted")
    void sentrySignature() throws Exception {
        String path = issuePath(saveIntegration("SENTRY", "{\"clientSecret\":\"s3cret\"}", ownerToken(), workspaceId));

        mvc.perform(post(path).contentType(MediaType.APPLICATION_JSON).content(SENTRY_BODY)).andExpect(status().isUnauthorized());
        mvc.perform(post(path).contentType(MediaType.APPLICATION_JSON).content(SENTRY_BODY)
                .header("Sentry-Hook-Signature", Signatures.hmacSha256Hex("wrong", SENTRY_BODY.getBytes(StandardCharsets.UTF_8))))
           .andExpect(status().isUnauthorized());
        assertThat(tasksFor(workspaceId, "inbound:sentry:77")).isEmpty();

        mvc.perform(post(path).contentType(MediaType.APPLICATION_JSON).content(SENTRY_BODY)
                .header("Sentry-Hook-Signature", Signatures.hmacSha256Hex("s3cret", SENTRY_BODY.getBytes(StandardCharsets.UTF_8))))
           .andExpect(status().isOk());
        assertThat(tasksFor(workspaceId, "inbound:sentry:77")).hasSize(1);
    }

    // ── workspace boundaries ─────────────────────────────────────────────────

    @Test
    @DisplayName("the token decides the workspace: naming another workspace in a header does not redirect the task")
    void headerCannotRedirect() throws Exception {
        String path = datadogPath();
        mvc.perform(post(path).header("X-Workspace-Id", otherWorkspaceId)
                .contentType(MediaType.APPLICATION_JSON).content(DD_TRIGGERED))
           .andExpect(status().isOk());

        assertThat(tasksFor(workspaceId, "inbound:datadog:1234567")).hasSize(1);
        assertThat(tasksFor(otherWorkspaceId, "inbound:datadog:1234567")).isEmpty();
    }

    @Test
    @DisplayName("two workspaces can track the same alert independently")
    void sameAlertTwoWorkspaces() throws Exception {
        String pathA = datadogPath();
        String idB = saveIntegration("DATADOG", "{}", otherOwnerToken(), otherWorkspaceId);
        String bodyB = mvc.perform(post("/api/integrations/" + idB + "/inbound-token")
                .header("Authorization", authHeader(otherOwnerToken())).header("X-Workspace-Id", otherWorkspaceId))
           .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        String pathB = objectMapper.readTree(bodyB).get("path").asText();

        send(pathA, DD_TRIGGERED);
        send(pathB, DD_TRIGGERED);
        send(pathB, DD_RECOVERED);

        assertThat(tasksFor(workspaceId, "inbound:datadog:1234567").get(0).getStatus()).isEqualTo("TODO");
        assertThat(tasksFor(otherWorkspaceId, "inbound:datadog:1234567").get(0).getStatus()).isEqualTo("DONE");
    }

    @Test
    @DisplayName("another workspace's owner can't issue a URL for this workspace's integration")
    void cannotIssueForForeignIntegration() throws Exception {
        String id = saveIntegration("DATADOG", "{}", ownerToken(), workspaceId);
        mvc.perform(post("/api/integrations/" + id + "/inbound-token")
                .header("Authorization", authHeader(otherOwnerToken())).header("X-Workspace-Id", otherWorkspaceId))
           .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("integrations that don't receive events can't be given a URL; issuing one needs a login")
    void issuing_isRestricted() throws Exception {
        String github = saveIntegration("GITHUB", "{\"token\":\"t\",\"repo\":\"a/b\"}", ownerToken(), workspaceId);
        mvc.perform(post("/api/integrations/" + github + "/inbound-token")
                .header("Authorization", authHeader(ownerToken())).header("X-Workspace-Id", workspaceId))
           .andExpect(status().isBadRequest());
        mvc.perform(post("/api/integrations/" + github + "/inbound-token")).andExpect(status().isUnauthorized());
    }
}
