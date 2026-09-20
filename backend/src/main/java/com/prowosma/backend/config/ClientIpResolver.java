package com.prowosma.backend.config;

import com.prowosma.backend.auth.ClientIp;
import com.prowosma.backend.auth.IpRanges;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * The client address for rate limiting, workspace IP allow-lists and login/audit records.
 *
 * {@code X-Forwarded-For} / {@code X-Real-IP} are believed only when the connection itself comes
 * from a trusted proxy (see {@link ClientIp}). By default that means loopback and private
 * addresses, which is where a reverse proxy or load balancer normally sits. Behind a proxy on a
 * public address, list it: {@code app.security.trusted-proxies=203.0.113.10,198.51.100.0/24}.
 * A malformed value stops the application at startup rather than silently changing who is trusted.
 */
@Component
public class ClientIpResolver {

    private final IpRanges trustedProxies;

    public ClientIpResolver(@Value("${app.security.trusted-proxies:}") String configured) {
        this.trustedProxies = (configured == null || configured.isBlank())
                ? IpRanges.LOOPBACK_AND_PRIVATE
                : IpRanges.parse(configured);
    }

    public String of(HttpServletRequest request) {
        return ClientIp.resolve(request.getRemoteAddr(), request.getHeader("X-Forwarded-For"),
                request.getHeader("X-Real-IP"), trustedProxies);
    }
}
