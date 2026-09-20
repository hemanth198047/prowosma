package com.prowosma.backend.controller;

import com.prowosma.backend.integration.InboundSource;
import com.prowosma.backend.service.InboundEventService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;

/**
 * Where Datadog, Sentry and Jenkins post their events:
 * {@code POST /api/inbound-events/{datadog|sentry|jenkins}/{token}}.
 *
 * Public at the HTTP layer (SecurityConfig): these callers have no login. The secret in the
 * URL is the authentication; see {@link InboundEventService}. The body is read as raw bytes
 * because Sentry's signature is computed over exactly those bytes.
 */
@RestController
@RequestMapping("/api/inbound-events")
@RequiredArgsConstructor
public class InboundEventController {

    private final InboundEventService inboundEventService;

    @PostMapping("/{source}/{token}")
    public ResponseEntity<Map<String, Object>> receive(@PathVariable String source,
                                                       @PathVariable String token,
                                                       @RequestBody(required = false) byte[] body,
                                                       @RequestHeader Map<String, String> headers) {
        InboundSource parsed = InboundSource.fromPath(source)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Not found"));
        return ResponseEntity.ok(inboundEventService.ingest(parsed, token, body, headers));
    }
}
