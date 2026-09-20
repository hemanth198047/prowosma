package com.prowosma.backend.ratelimit;

import com.prowosma.backend.ProwosmaTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Anonymous callers are limited per client address. That address came from X-Forwarded-For
 * whoever sent it, so a caller could send a different value with every request and never reach
 * the limit (which also made password guessing unlimited). It is now believed only from a trusted
 * proxy.
 */
@DisplayName("RateLimitFilter — the client address can't be forged with headers")
@TestPropertySource(properties = "app.rate-limit.requests-per-minute=3")
class ClientIpRateLimitTest extends ProwosmaTestBase {

    private org.springframework.test.web.servlet.ResultActions login(String remoteAddr, String forwardedFor) throws Exception {
        return mvc.perform(post("/api/auth/login")
                .with(request -> { request.setRemoteAddr(remoteAddr); return request; })
                .header("X-Forwarded-For", forwardedFor)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"nobody@test.com\",\"password\":\"x\"}"));
    }

    @Test
    @DisplayName("a caller connecting directly can't dodge the limit by rotating X-Forwarded-For")
    void directCallerCannotRotate() throws Exception {
        for (int i = 0; i < 3; i++) login("203.0.113.9", "198.51.100." + i).andExpect(status().isUnauthorized());
        login("203.0.113.9", "198.51.100.77").andExpect(status().isTooManyRequests());
    }

    @Test
    @DisplayName("behind a trusted proxy, different real clients still get their own limits")
    void clientsBehindProxyAreSeparate() throws Exception {
        for (int i = 0; i < 6; i++) login("10.0.0.2", "203.0.113." + i).andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("behind a trusted proxy, one client is still limited, and can't add a fake left-most entry to escape")
    void oneClientBehindProxyIsLimited() throws Exception {
        for (int i = 0; i < 3; i++) login("10.0.0.2", "1.1." + i + ".1, 203.0.113.50").andExpect(status().isUnauthorized());
        login("10.0.0.2", "9.9.9.9, 203.0.113.50").andExpect(status().isTooManyRequests());
    }
}
