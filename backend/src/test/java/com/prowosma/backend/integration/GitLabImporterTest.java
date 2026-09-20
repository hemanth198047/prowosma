package com.prowosma.backend.integration;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

@DisplayName("GitLabImporter — issues and merge requests become tasks")
class GitLabImporterTest {

    private final Map<String, List<Map<String, Object>>> responses = new HashMap<>();
    private final List<String> requested = new ArrayList<>();
    private final List<Map<String, String>> requestHeaders = new ArrayList<>();
    private final Set<String> existing = new HashSet<>();
    private final List<ImportedItem> created = new ArrayList<>();
    private final List<URI> checkedHosts = new ArrayList<>();
    private GitLabImporter importer;

    private final GitLabImporter.Fetcher fetcher = (uri, headers) -> {
        requested.add(uri.toString());
        requestHeaders.add(headers);
        return responses.getOrDefault(uri.toString(), List.of());
    };
    private final GitLabImporter.Sink sink = new GitLabImporter.Sink() {
        @Override public boolean exists(String externalRef) { return existing.contains(externalRef); }
        @Override public void create(ImportedItem item) { created.add(item); existing.add(item.externalRef()); }
    };
    private final GitLabImporter.HostCheck hostCheck = checkedHosts::add;

    @BeforeEach
    void setUp() { importer = new GitLabImporter(); }

    private static Map<String, String> config(String project) {
        Map<String, String> c = new HashMap<>();
        c.put("token", "glpat-secret");
        c.put("projectId", project);
        return c;
    }

    private static Map<String, Object> row(long iid, String title) {
        return TinyJson.object("{\"iid\":" + iid + ",\"title\":\"" + title + "\",\"description\":\"desc " + iid
                + "\",\"web_url\":\"https://gitlab.com/g/p/-/issues/" + iid + "\",\"labels\":[\"bug\",\"p1\"]}");
    }

    private static List<Map<String, Object>> rows(int count, int firstIid) {
        List<Map<String, Object>> l = new ArrayList<>();
        for (int i = 0; i < count; i++) l.add(row(firstIid + i, "Item " + (firstIid + i)));
        return l;
    }

    @Test
    @DisplayName("imports open issues and merge requests from gitlab.com, using a URL-encoded project path")
    void importsBoth() throws Exception {
        responses.put("https://gitlab.com/api/v4/projects/group%2Fproject/issues?state=opened&per_page=100&page=1", List.of(row(1, "Broken login"), row(2, "Slow page")));
        responses.put("https://gitlab.com/api/v4/projects/group%2Fproject/merge_requests?state=opened&per_page=100&page=1", List.of(row(7, "Fix login")));

        GitLabImporter.Result r = importer.run(config("group/project"), fetcher, sink, hostCheck);

        assertEquals(3, r.imported());
        assertEquals(3, r.total());
        assertFalse(r.truncated());
        assertEquals(2, requested.size());
        assertEquals("issue", created.get(0).kind());
        assertEquals("merge-request", created.get(2).kind());
        assertEquals("Broken login", created.get(0).title());
        assertEquals(List.of("bug", "p1"), created.get(0).labels());
        assertEquals("https://gitlab.com/g/p/-/issues/1", created.get(0).url());
        assertTrue(checkedHosts.isEmpty(), "gitlab.com is trusted and is not put through the address check");
    }

    @Test
    @DisplayName("a numeric project id is used as is")
    void numericProject() throws Exception {
        importer.run(config("12345"), fetcher, sink, hostCheck);
        assertEquals("https://gitlab.com/api/v4/projects/12345/issues?state=opened&per_page=100&page=1", requested.get(0));
    }

    @Test
    @DisplayName("the access token is sent as PRIVATE-TOKEN and never appears in a URL")
    void tokenInHeaderOnly() throws Exception {
        importer.run(config("g/p"), fetcher, sink, hostCheck);
        assertEquals("glpat-secret", requestHeaders.get(0).get("PRIVATE-TOKEN"));
        for (String url : requested) assertFalse(url.contains("glpat"));
    }

    @Test
    @DisplayName("items already imported are not created again, and issue #1 and merge request !1 don't collide")
    void deduplicates() throws Exception {
        responses.put("https://gitlab.com/api/v4/projects/g%2Fp/issues?state=opened&per_page=100&page=1", List.of(row(1, "Issue one")));
        responses.put("https://gitlab.com/api/v4/projects/g%2Fp/merge_requests?state=opened&per_page=100&page=1", List.of(row(1, "MR one")));

        GitLabImporter.Result first = importer.run(config("g/p"), fetcher, sink, hostCheck);
        assertEquals(2, first.imported());

        created.clear();
        GitLabImporter.Result second = importer.run(config("g/p"), fetcher, sink, hostCheck);
        assertEquals(0, second.imported());
        assertEquals(2, second.total());
        assertTrue(created.isEmpty());
    }

    @Test
    @DisplayName("external references distinguish hosts and projects, case-insensitively")
    void referencesAreScoped() throws Exception {
        responses.put("https://gitlab.com/api/v4/projects/G%2FP/issues?state=opened&per_page=100&page=1", List.of(row(3, "T")));
        importer.run(config("G/P"), fetcher, sink, hostCheck);
        assertEquals("gitlab:gitlab.com:g/p:issue:3", created.get(0).externalRef());
    }

    @Test
    @DisplayName("follows pages until a short page")
    void paginates() throws Exception {
        responses.put("https://gitlab.com/api/v4/projects/g%2Fp/issues?state=opened&per_page=100&page=1", rows(100, 1));
        responses.put("https://gitlab.com/api/v4/projects/g%2Fp/issues?state=opened&per_page=100&page=2", rows(3, 101));
        GitLabImporter.Result r = importer.run(config("g/p"), fetcher, sink, hostCheck);
        assertEquals(103, r.imported());
        assertFalse(r.truncated());
        assertFalse(requested.contains("https://gitlab.com/api/v4/projects/g%2Fp/issues?state=opened&per_page=100&page=3"));
    }

    @Test
    @DisplayName("paging is bounded, and the result says so when it was cut short")
    void boundedPaging() throws Exception {
        for (int page = 1; page <= 10; page++) {
            responses.put("https://gitlab.com/api/v4/projects/g%2Fp/issues?state=opened&per_page=100&page=" + page, rows(100, page * 1000));
        }
        GitLabImporter.Result r = importer.run(config("g/p"), fetcher, sink, hostCheck);
        assertTrue(r.truncated());
        assertEquals(GitLabImporter.MAX_PAGES * GitLabImporter.PAGE_SIZE, r.total());
        assertFalse(requested.contains("https://gitlab.com/api/v4/projects/g%2Fp/issues?state=opened&per_page=100&page=6"));
    }

    // ── self-managed hosts ───────────────────────────────────────────────────

    @Test
    @DisplayName("a self-managed host is put through the host check first, and a trailing slash or sub-path is handled")
    void selfManagedHost() throws Exception {
        Map<String, String> c = config("g/p");
        c.put("host", "https://git.corp.example.com/gitlab/");
        importer.run(c, fetcher, sink, hostCheck);
        assertEquals(1, checkedHosts.size());
        assertEquals("git.corp.example.com", checkedHosts.get(0).getHost());
        assertEquals("https://git.corp.example.com/gitlab/api/v4/projects/g%2Fp/issues?state=opened&per_page=100&page=1", requested.get(0));
    }

    @Test
    @DisplayName("if the host check refuses, nothing is sent to the host")
    void hostCheckRefusal() {
        Map<String, String> c = config("g/p");
        c.put("host", "https://internal.example.com");
        assertThrows(IllegalArgumentException.class, () -> importer.run(c, fetcher, sink, uri -> {
            throw new IllegalArgumentException("must not point at a private address");
        }));
        assertTrue(requested.isEmpty());
    }

    // ── bad configuration ────────────────────────────────────────────────────

    @Test
    @DisplayName("missing token or project is a clear error")
    void missingConfig() {
        assertThrows(IllegalArgumentException.class, () -> importer.run(Map.of("projectId", "g/p"), fetcher, sink, hostCheck));
        assertThrows(IllegalArgumentException.class, () -> importer.run(Map.of("token", "t"), fetcher, sink, hostCheck));
        assertThrows(IllegalArgumentException.class, () -> importer.run(null, fetcher, sink, hostCheck));
        assertTrue(requested.isEmpty());
    }

    @Test
    @DisplayName("a project value that could change the request path is refused")
    void hostilePaths() {
        for (String bad : new String[]{"../admin", "g/p?x=1", "g/p#f", "a//b", "g/p/../../x", "g p", "g/p%2F.."}) {
            assertThrows(IllegalArgumentException.class, () -> importer.run(config(bad), fetcher, sink, hostCheck), bad);
        }
        assertTrue(requested.isEmpty());
    }

    @Test
    @DisplayName("an http host, a host with credentials, or one with a query is refused")
    void hostilePorts() {
        for (String bad : new String[]{"http://git.example.com", "https://u:p@git.example.com", "https://git.example.com?x=1"}) {
            Map<String, String> c = config("g/p");
            c.put("host", bad);
            assertThrows(IllegalArgumentException.class, () -> importer.run(c, fetcher, sink, hostCheck), bad);
        }
    }

    @Test
    @DisplayName("rows without a title or id are skipped rather than failing the whole import")
    void skipsMalformedRows() throws Exception {
        responses.put("https://gitlab.com/api/v4/projects/g%2Fp/issues?state=opened&per_page=100&page=1", List.of(
                TinyJson.object("{\"iid\":1}"), TinyJson.object("{\"title\":\"no id\"}"),
                TinyJson.object("{\"iid\":2,\"title\":\"  \"}"), row(3, "Good one")));
        GitLabImporter.Result r = importer.run(config("g/p"), fetcher, sink, hostCheck);
        assertEquals(1, r.imported());
        assertEquals("Good one", created.get(0).title());
    }
}
