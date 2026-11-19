package com.prowosma.backend.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.ProwosmaTestBase;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/** "Keep me signed in on this device": a 30-day sign-in instead of the usual length (24 hours in production); without it, nothing changes. */
class KeepSignedInTest extends ProwosmaTestBase {
    final ObjectMapper om = new ObjectMapper();

    long lifetimeHours(String body) throws Exception {
        var r = mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content(body)).andReturn();
        assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isEqualTo(200);
        String token = om.readTree(r.getResponse().getContentAsString()).get("token").asText();
        var claims = om.readTree(new String(Base64.getUrlDecoder().decode(token.split("\\.")[1]), StandardCharsets.UTF_8));
        return (claims.get("exp").asLong() - claims.get("iat").asLong()) / 3600;
    }

    @Test
    void rememberGivesA30DaySignIn_otherwiseTheUsualLength() throws Exception {
        long usual = lifetimeHours("{\"email\":\"member@test.com\",\"password\":\"pass\"}");
        assertThat(usual).isLessThan(30 * 24);
        assertThat(lifetimeHours("{\"email\":\"member@test.com\",\"password\":\"pass\",\"remember\":true}")).isEqualTo(30 * 24);
        assertThat(lifetimeHours("{\"email\":\"member@test.com\",\"password\":\"pass\",\"remember\":false}")).isEqualTo(usual);
    }
}
