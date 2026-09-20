package com.prowosma.backend.integration;

import java.net.URI;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Imports a GitLab project's open issues and merge requests as tasks.
 *
 * Mirrors the existing GitHub/Bitbucket sync, with the three problems of those fixed by
 * construction: de-duplication is by an external reference (not a workspace-wide title
 * search), it is done by the {@link Sink} within one workspace, and paging is bounded.
 *
 * All I/O is behind {@link Fetcher} and {@link Sink} so the logic can be tested without a
 * network or a database.
 */
public final class GitLabImporter {

    public interface Fetcher {
        List<Map<String, Object>> getList(URI uri, Map<String, String> headers) throws Exception;
    }

    public interface Sink {
        boolean exists(String externalRef);
        void create(ImportedItem item);
    }

    /** Applied to a non-gitlab.com host before anything is sent to it (SSRF policy). */
    public interface HostCheck {
        void check(URI base);
    }

    public record Result(int imported, int total, boolean truncated) { }

    public static final int PAGE_SIZE = 100;
    public static final int MAX_PAGES = 5;

    private static final String[][] RESOURCES = {{"issue", "issues"}, {"merge-request", "merge_requests"}};

    public Result run(Map<String, String> config, Fetcher fetcher, Sink sink, HostCheck hostCheck) throws Exception {
        String token = config == null ? null : config.get("token");
        String project = config == null ? null : config.get("projectId");
        if (token == null || token.isBlank() || project == null || project.isBlank()) {
            throw new IllegalArgumentException("GitLab access token and project are required");
        }
        URI base = GitLabApi.baseUri(config.get("host"));
        if (!GitLabApi.isDefaultHost(base)) hostCheck.check(base);

        String ref = GitLabApi.projectRef(project);
        String prefix = GitLabApi.refPrefix(base, project);
        Map<String, String> headers = new HashMap<>();
        headers.put("PRIVATE-TOKEN", token.trim());
        headers.put("Accept", "application/json");

        int imported = 0, total = 0;
        boolean truncated = false;
        for (String[] resource : RESOURCES) {
            for (int page = 1; page <= MAX_PAGES; page++) {
                List<Map<String, Object>> rows = fetcher.getList(
                        GitLabApi.listUri(base, ref, resource[1], page, PAGE_SIZE), headers);
                int received = rows == null ? 0 : rows.size();
                for (ImportedItem item : GitLabApi.parse(resource[0], rows, prefix)) {
                    total++;
                    if (!sink.exists(item.externalRef())) {
                        sink.create(item);
                        imported++;
                    }
                }
                if (received < PAGE_SIZE) break;
                if (page == MAX_PAGES) truncated = true;
            }
        }
        return new Result(imported, total, truncated);
    }
}
