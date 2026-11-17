package com.prowosma.backend.uma.provider;

import com.prowosma.backend.uma.core.UmaException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.util.List;
import java.util.Optional;

/** All platforms, and which one a meeting link belongs to. New platforms plug in by adding an adapter here. */
@Component
public class ProviderRegistry {
    private final List<MeetingProviderAdapter> all = List.of(new Providers.GoogleMeet(), new Providers.Teams(), new Providers.Zoom(),
            new Providers.Webex(), new Providers.Other());

    public List<MeetingProviderAdapter> all() { return all; }

    public Optional<MeetingProviderAdapter> byId(String id) { return all.stream().filter(a -> a.id().equals(id)).findFirst(); }

    public record Detected(MeetingProviderAdapter provider, String url) {}

    /** Recognises a meeting link. Only https links are accepted; unknown hosts are "Any other platform". */
    public Detected detect(String raw) {
        String s = raw == null ? "" : raw.strip();
        if (s.isEmpty()) throw new UmaException(HttpStatus.BAD_REQUEST, "INVALID_LINK", "Paste the meeting link.");
        if (!s.matches("(?i)^https?://.*")) s = "https://" + s;
        URI uri;
        try { uri = URI.create(s); } catch (IllegalArgumentException e) {
            throw new UmaException(HttpStatus.BAD_REQUEST, "INVALID_LINK", "That doesn't look like a meeting link.");
        }
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || !uri.getHost().contains("."))
            throw new UmaException(HttpStatus.BAD_REQUEST, "INVALID_LINK", "That doesn't look like a meeting link. It should start with https://");
        if (s.length() > 2000) throw new UmaException(HttpStatus.BAD_REQUEST, "INVALID_LINK", "That link is too long.");
        for (MeetingProviderAdapter a : all) if (a.matches(uri)) return new Detected(a, s);
        return new Detected(byId("OTHER").orElseThrow(), s);
    }
}
