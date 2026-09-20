package com.prowosma.backend.integration;

import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** GitLab REST v4 URL building and response mapping. No I/O. */
public final class GitLabApi {

    public static final String DEFAULT_HOST = "https://gitlab.com";

    private GitLabApi() {}

    /** The GitLab base URL without a trailing slash; blank means gitlab.com. */
    public static URI baseUri(String host) {
        String raw = (host == null || host.isBlank()) ? DEFAULT_HOST : host.trim();
        URI uri = OutboundUrlPolicy.parseHttps(raw, "GitLab URL");
        if (uri.getRawQuery() != null || uri.getRawFragment() != null) {
            throw new IllegalArgumentException("GitLab URL must not contain a query or fragment");
        }
        String s = uri.toString();
        while (s.endsWith("/")) s = s.substring(0, s.length() - 1);
        return URI.create(s);
    }

    public static boolean isDefaultHost(URI base) {
        return "gitlab.com".equalsIgnoreCase(base.getHost());
    }

    /**
     * The {@code :id} segment of {@code /projects/:id/...}: a numeric id as is, or a
     * {@code group/project} path with its slashes URL-encoded. Anything that could alter
     * the request path is refused.
     */
    public static String projectRef(String projectIdOrPath) {
        if (projectIdOrPath == null || projectIdOrPath.isBlank()) {
            throw new IllegalArgumentException("GitLab project ID or path is required");
        }
        String p = projectIdOrPath.trim();
        while (p.startsWith("/")) p = p.substring(1);
        while (p.endsWith("/")) p = p.substring(0, p.length() - 1);
        if (p.isEmpty() || !p.matches("[A-Za-z0-9_.\\-/]+") || p.contains("..") || p.contains("//")) {
            throw new IllegalArgumentException("GitLab project must be a numeric ID or a path like group/project");
        }
        return URLEncoder.encode(p, StandardCharsets.UTF_8).replace("+", "%20");
    }

    public static URI listUri(URI base, String projectRef, String resource, int page, int perPage) {
        return URI.create(base + "/api/v4/projects/" + projectRef + "/" + resource
                + "?state=opened&per_page=" + perPage + "&page=" + page);
    }

    /** {@code kind} is "issue" or "merge-request". Rows without a title or id are skipped. */
    public static List<ImportedItem> parse(String kind, List<Map<String, Object>> rows, String refPrefix) {
        List<ImportedItem> items = new ArrayList<>();
        if (rows == null) return items;
        for (Map<String, Object> row : rows) {
            Object title = row.get("title");
            Object iid = row.get("iid");
            if (!(title instanceof String t) || t.isBlank() || !(iid instanceof Number n)) continue;
            Object description = row.get("description");
            Object url = row.get("web_url");
            items.add(new ImportedItem(
                    kind,
                    n.longValue(),
                    t.trim(),
                    description instanceof String d ? d : "",
                    url instanceof String u ? u : "",
                    labelsOf(row.get("labels")),
                    refPrefix + ":" + kind + ":" + n.longValue()));
        }
        return items;
    }

    public static String refPrefix(URI base, String project) {
        return "gitlab:" + base.getAuthority().toLowerCase(Locale.ROOT) + ":" + project.trim().toLowerCase(Locale.ROOT);
    }

    private static List<String> labelsOf(Object labels) {
        List<String> out = new ArrayList<>();
        if (labels instanceof List<?> list) {
            for (Object o : list) if (o instanceof String s && !s.isBlank()) out.add(s);
        }
        return out;
    }
}
