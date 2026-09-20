package com.prowosma.backend.integration;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

@DisplayName("InboundEventParser — Datadog, Sentry and Jenkins payloads")
class InboundEventParserTest {

    private static InboundEvent datadog(String json) {
        return InboundEventParser.parse(InboundSource.DATADOG, TinyJson.object(json), Map.of());
    }

    private static InboundEvent sentry(String json, String resource) {
        return InboundEventParser.parse(InboundSource.SENTRY, TinyJson.object(json),
                resource == null ? Map.of() : Map.of("sentry-hook-resource", resource));
    }

    private static InboundEvent jenkins(String json) {
        return InboundEventParser.parse(InboundSource.JENKINS, TinyJson.object(json), Map.of());
    }

    // ═══ Datadog ═════════════════════════════════════════════════════════════

    private static final String DD_TRIGGERED = "{\"title\":\"[Triggered on {host:web-1}] High CPU on web\","
            + "\"body\":\"CPU above 90% for 5m\",\"alert_id\":\"1234567\",\"alert_transition\":\"Triggered\","
            + "\"alert_type\":\"error\",\"priority\":\"P2\",\"link\":\"https://app.datadoghq.com/monitors/1234567\","
            + "\"tags\":\"env:prod,service:web,team:core\"}";

    @Test
    @DisplayName("Datadog: a triggered monitor opens an incident task with priority, link and tags")
    void datadogTriggered() {
        InboundEvent e = datadog(DD_TRIGGERED);
        assertEquals(InboundEvent.Action.OPEN, e.action());
        assertEquals("1234567", e.externalId());
        assertEquals("inbound:datadog:1234567", e.externalRef());
        assertEquals("[Triggered on {host:web-1}] High CPU on web", e.title());
        assertEquals("HIGH", e.priority());
        assertEquals("HIGH", e.severity());
        assertEquals("TASK", e.type());
        assertTrue(e.description().contains("CPU above 90% for 5m"));
        assertTrue(e.description().contains("https://app.datadoghq.com/monitors/1234567"));
        assertTrue(e.tags().containsAll(java.util.List.of("datadog", "incident", "env:prod", "service:web", "team:core")));
    }

    @Test
    @DisplayName("Datadog: the recovery of that monitor resolves it (same id, different title bracket)")
    void datadogRecovered() {
        InboundEvent e = datadog("{\"title\":\"[Recovered on {host:web-1}] High CPU on web\",\"alert_id\":\"1234567\","
                + "\"alert_transition\":\"Recovered\",\"alert_type\":\"success\"}");
        assertEquals(InboundEvent.Action.RESOLVE, e.action());
        assertEquals("1234567", e.externalId());
    }

    @Test
    @DisplayName("Datadog: without a monitor id the title (minus its status brackets) identifies the alert, so a recovery still finds the task")
    void datadogTitleFallbackId() {
        InboundEvent open = datadog("{\"title\":\"[Triggered] Disk almost full\",\"id\":\"777\",\"body\":\"x\"}");
        InboundEvent resolved = datadog("{\"title\":\"[Recovered] Disk almost full\",\"id\":\"778\",\"alert_transition\":\"Recovered\"}");
        assertEquals(open.externalId(), resolved.externalId());
        assertTrue(open.externalId().startsWith("t-"));
        assertEquals(InboundEvent.Action.OPEN, open.action());
        assertEquals(InboundEvent.Action.RESOLVE, resolved.action());
    }

    @Test
    @DisplayName("Datadog: the per-event $ID is never used as the identity (it would open a new task on every repeat)")
    void datadogEventIdIgnored() {
        InboundEvent a = datadog("{\"title\":\"Latency high\",\"id\":\"111\"}");
        InboundEvent b = datadog("{\"title\":\"Latency high\",\"id\":\"222\"}");
        assertEquals(a.externalId(), b.externalId());
    }

    @Test
    @DisplayName("Datadog: priorities map to task priority/severity; alert_type drives the default")
    void datadogPriorities() {
        assertEquals("CRITICAL", datadog("{\"title\":\"t\",\"priority\":\"P1\"}").severity());
        assertEquals("HIGH", datadog("{\"title\":\"t\",\"priority\":\"P1\"}").priority());
        assertEquals("MEDIUM", datadog("{\"title\":\"t\",\"priority\":\"3\"}").priority());
        assertEquals("LOW", datadog("{\"title\":\"t\",\"priority\":\"P5\"}").priority());
        assertEquals("LOW", datadog("{\"title\":\"t\",\"priority\":\"low\"}").priority());
        assertEquals("HIGH", datadog("{\"title\":\"t\",\"alert_type\":\"error\"}").priority());
        assertEquals("MEDIUM", datadog("{\"title\":\"t\",\"priority\":\"normal\"}").priority());
        assertEquals("MEDIUM", datadog("{\"title\":\"t\"}").priority());
    }

    @Test
    @DisplayName("Datadog: a warning or no-data transition stays open; only recovery/resolution closes")
    void datadogTransitions() {
        assertEquals(InboundEvent.Action.OPEN, datadog("{\"title\":\"t\",\"alert_transition\":\"Warn\"}").action());
        assertEquals(InboundEvent.Action.OPEN, datadog("{\"title\":\"t\",\"alert_transition\":\"No Data\"}").action());
        assertEquals(InboundEvent.Action.OPEN, datadog("{\"title\":\"t\",\"alert_transition\":\"Re-Triggered\"}").action());
        assertEquals(InboundEvent.Action.RESOLVE, datadog("{\"title\":\"t\",\"alert_transition\":\"Recovered\"}").action());
        assertEquals(InboundEvent.Action.RESOLVE, datadog("{\"title\":\"t\",\"alert_type\":\"success\"}").action());
        // an explicit transition wins over free text that merely mentions recovery
        assertEquals(InboundEvent.Action.OPEN, datadog("{\"title\":\"t\",\"alert_transition\":\"Triggered\",\"alert_status\":\"has not recovered\"}").action());
    }

    @Test
    @DisplayName("Datadog: tags are cleaned, capped, and never include @-handles")
    void datadogTags() {
        InboundEvent e = datadog("{\"title\":\"t\",\"tags\":\"a,B C,@pagerduty-team,\\u0020,c:d,e,f,g,h\"}");
        assertTrue(e.tags().contains("b-c"));
        assertFalse(e.tags().contains("@pagerduty-team"));
        assertEquals(2 + 5, e.tags().size());
    }

    @Test
    @DisplayName("Datadog: no title is unusable")
    void datadogNoTitle() {
        assertThrows(IllegalArgumentException.class, () -> datadog("{\"body\":\"x\",\"alert_id\":\"1\"}"));
    }

    // ═══ Sentry ══════════════════════════════════════════════════════════════

    private static final String SENTRY_ISSUE = "{\"action\":\"created\",\"data\":{\"issue\":{\"id\":\"4501\",\"shortId\":\"WEB-1A\","
            + "\"title\":\"TypeError: x is undefined\",\"culprit\":\"app/main.js in render\",\"level\":\"error\","
            + "\"status\":\"unresolved\",\"web_url\":\"https://sentry.io/organizations/acme/issues/4501/\","
            + "\"project\":{\"slug\":\"web\",\"name\":\"Web\"}}},\"actor\":{\"type\":\"application\",\"name\":\"Sentry\"}}";

    @Test
    @DisplayName("Sentry: a new issue opens a bug task")
    void sentryIssueCreated() {
        InboundEvent e = sentry(SENTRY_ISSUE, "issue");
        assertEquals(InboundEvent.Action.OPEN, e.action());
        assertEquals("4501", e.externalId());
        assertEquals("TypeError: x is undefined", e.title());
        assertEquals("BUG", e.type());
        assertEquals("HIGH", e.priority());
        assertTrue(e.tags().contains("web"));
        assertTrue(e.description().contains("app/main.js in render"));
        assertTrue(e.description().contains("https://sentry.io/organizations/acme/issues/4501/"));
    }

    @Test
    @DisplayName("Sentry: resolving the issue resolves the task; a regression reopens; assignment etc. are ignored")
    void sentryIssueLifecycle() {
        assertEquals(InboundEvent.Action.RESOLVE, sentry(SENTRY_ISSUE.replace("\"created\"", "\"resolved\""), "issue").action());
        assertEquals(InboundEvent.Action.OPEN, sentry(SENTRY_ISSUE.replace("\"created\"", "\"unresolved\""), "issue").action());
        assertEquals(InboundEvent.Action.IGNORE, sentry(SENTRY_ISSUE.replace("\"created\"", "\"assigned\""), "issue").action());
        assertEquals(InboundEvent.Action.IGNORE, sentry(SENTRY_ISSUE.replace("\"created\"", "\"archived\""), "issue").action());
    }

    @Test
    @DisplayName("Sentry: issue-alert events (via an alert rule) open a task keyed by the issue, with the rule named")
    void sentryEventAlert() {
        InboundEvent e = sentry("{\"action\":\"triggered\",\"data\":{\"event\":{\"event_id\":\"abcdef\",\"issue_id\":\"4501\","
                + "\"title\":\"TypeError: x is undefined\",\"level\":\"fatal\",\"culprit\":\"render\","
                + "\"web_url\":\"https://sentry.io/organizations/acme/issues/4501/events/abcdef/\"},"
                + "\"triggered_rule\":\"High volume\"}}", "event_alert");
        assertEquals("4501", e.externalId());
        assertEquals(InboundEvent.Action.OPEN, e.action());
        assertEquals("CRITICAL", e.severity());
        assertTrue(e.description().contains("Alert rule: High volume"));
    }

    @Test
    @DisplayName("Sentry: metric alerts open on critical/warning and resolve on resolved")
    void sentryMetricAlert() {
        String open = "{\"action\":\"critical\",\"data\":{\"metric_alert\":{\"id\":\"88\",\"title\":\"p95 latency\","
                + "\"alert_rule\":{\"name\":\"Latency rule\"}},\"web_url\":\"https://sentry.io/alerts/88/\"}}";
        InboundEvent e = sentry(open, "metric_alert");
        assertEquals("metric-88", e.externalId());
        assertEquals(InboundEvent.Action.OPEN, e.action());
        assertEquals("CRITICAL", e.severity());
        assertEquals(InboundEvent.Action.RESOLVE, sentry(open.replace("\"critical\"", "\"resolved\""), "metric_alert").action());
        assertEquals("MEDIUM", sentry(open.replace("\"critical\"", "\"warning\""), "metric_alert").severity());
    }

    @Test
    @DisplayName("Sentry: the legacy project webhook (flat payload) is understood")
    void sentryLegacy() {
        InboundEvent e = sentry("{\"id\":\"9001\",\"project\":\"web\",\"project_name\":\"Web\",\"culprit\":\"a.js\",\"level\":\"warning\","
                + "\"url\":\"https://sentry.io/acme/web/issues/9001/\",\"message\":\"Boom\",\"event\":{\"title\":\"Boom event\",\"event_id\":\"e1\"}}", null);
        assertEquals("9001", e.externalId());
        assertEquals("Boom event", e.title());
        assertEquals(InboundEvent.Action.OPEN, e.action());
        assertEquals("MEDIUM", e.priority());
        assertTrue(e.tags().contains("web"));
    }

    @Test
    @DisplayName("Sentry: numeric ids are read as ids, and payloads with nothing usable are rejected")
    void sentryOddities() {
        assertEquals("4501", sentry(SENTRY_ISSUE.replace("\"id\":\"4501\"", "\"id\":4501"), "issue").externalId());
        assertThrows(IllegalArgumentException.class, () -> sentry("{\"action\":\"created\",\"data\":{\"issue\":{\"id\":\"1\"}}}", "issue"));
        assertThrows(IllegalArgumentException.class, () -> sentry("{\"hello\":\"world\"}", null));
    }

    // ═══ Jenkins ═════════════════════════════════════════════════════════════

    private static String build(String phase, String status) {
        return "{\"name\":\"backend-build\",\"url\":\"job/backend-build/\",\"build\":{\"full_url\":\"https://jenkins.acme.com/job/backend-build/42/\","
                + "\"number\":42,\"phase\":\"" + phase + "\",\"status\":\"" + status + "\",\"url\":\"job/backend-build/42/\","
                + "\"scm\":{\"url\":\"https://git.acme.com/backend.git\",\"branch\":\"origin/main\",\"commit\":\"abc123\"}}}";
    }

    @Test
    @DisplayName("Jenkins: a failed build opens a bug task for the job, with build number, branch and commit")
    void jenkinsFailure() {
        InboundEvent e = jenkins(build("COMPLETED", "FAILURE"));
        assertEquals(InboundEvent.Action.OPEN, e.action());
        assertEquals("backend-build", e.externalId());
        assertEquals("Build failing: backend-build", e.title());
        assertEquals("HIGH", e.priority());
        assertEquals("BUG", e.type());
        assertTrue(e.description().contains("Build #42 of backend-build finished with status FAILURE."));
        assertTrue(e.description().contains("Branch: origin/main"));
        assertTrue(e.description().contains("Commit: abc123"));
        assertTrue(e.description().contains("https://jenkins.acme.com/job/backend-build/42/"));
    }

    @Test
    @DisplayName("Jenkins: a later successful build resolves the job's task")
    void jenkinsRecovery() {
        assertEquals(InboundEvent.Action.RESOLVE, jenkins(build("FINALIZED", "SUCCESS")).action());
        assertEquals(jenkins(build("COMPLETED", "FAILURE")).externalId(), jenkins(build("COMPLETED", "SUCCESS")).externalId());
    }

    @Test
    @DisplayName("Jenkins: unstable opens at medium priority; builds still running or aborted are ignored")
    void jenkinsOtherStates() {
        InboundEvent unstable = jenkins(build("COMPLETED", "UNSTABLE"));
        assertEquals(InboundEvent.Action.OPEN, unstable.action());
        assertEquals("MEDIUM", unstable.priority());
        assertEquals(InboundEvent.Action.IGNORE, jenkins(build("STARTED", "FAILURE")).action());
        assertEquals(InboundEvent.Action.IGNORE, jenkins(build("QUEUED", "SUCCESS")).action());
        assertEquals(InboundEvent.Action.IGNORE, jenkins(build("COMPLETED", "ABORTED")).action());
        assertEquals(InboundEvent.Action.IGNORE, jenkins(build("COMPLETED", "NOT_BUILT")).action());
    }

    @Test
    @DisplayName("Jenkins: job names become safe, bounded ids; a payload without a job name is rejected")
    void jenkinsIds() {
        assertEquals("folder_my_job__1_", InboundEventParser.sanitizeId("Folder/My Job (1)"));
        assertEquals(120, InboundEventParser.sanitizeId("x".repeat(500)).length());
        assertThrows(IllegalArgumentException.class, () -> jenkins("{\"build\":{\"phase\":\"COMPLETED\",\"status\":\"FAILURE\"}}"));
    }

    // ═══ common ══════════════════════════════════════════════════════════════

    @Test
    @DisplayName("empty payloads are rejected for every source")
    void emptyPayloads() {
        for (InboundSource s : InboundSource.values()) {
            assertThrows(IllegalArgumentException.class, () -> InboundEventParser.parse(s, Map.of(), Map.of()));
            assertThrows(IllegalArgumentException.class, () -> InboundEventParser.parse(s, null, Map.of()));
        }
    }

    @Test
    @DisplayName("titles and descriptions are bounded")
    void bounded() {
        InboundEvent e = datadog("{\"title\":\"" + "T".repeat(999) + "\",\"body\":\"" + "B".repeat(9999) + "\"}");
        assertEquals(InboundEventParser.MAX_TITLE, e.title().length());
        assertEquals(InboundEventParser.MAX_DESCRIPTION, e.description().length());
    }
}
