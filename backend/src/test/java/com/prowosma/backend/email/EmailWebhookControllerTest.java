package com.prowosma.backend.email;

import com.prowosma.backend.ProwosmaTestBase;
import com.prowosma.backend.repository.EmailSuppressionRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Verifies the ESP bounce/complaint webhooks (SendGrid, Postmark) actually
 * add entries to the suppression list, and that the shared-secret
 * authorization check genuinely rejects unauthenticated calls once a
 * secret is configured.
 */
@DisplayName("EmailWebhookController — bounce/complaint ingestion")
@TestPropertySource(properties = "email.webhook.shared-secret=test-webhook-secret")
class EmailWebhookControllerTest extends ProwosmaTestBase {

    @Autowired private EmailSuppressionRepository suppressionRepository;

    @BeforeEach
    void cleanSuppressions() {
        suppressionRepository.deleteAll();
    }

    @Test
    @DisplayName("SendGrid bounce event (with correct secret) suppresses the address")
    void sendgrid_bounce_suppresses() throws Exception {
        String body = "[{\"email\":\"hardbounce@example.com\",\"event\":\"bounce\"}]";

        mvc.perform(post("/api/webhooks/email/sendgrid?secret=test-webhook-secret")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
           .andExpect(status().isOk());

        assertTrue(suppressionRepository.existsByEmail("hardbounce@example.com"));
    }

    @Test
    @DisplayName("SendGrid delivered/open/click events do NOT suppress")
    void sendgrid_nonBounceEvents_doNotSuppress() throws Exception {
        String body = "[{\"email\":\"fine@example.com\",\"event\":\"delivered\"}," +
                       "{\"email\":\"fine@example.com\",\"event\":\"open\"}]";

        mvc.perform(post("/api/webhooks/email/sendgrid?secret=test-webhook-secret")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
           .andExpect(status().isOk());

        org.junit.jupiter.api.Assertions.assertFalse(suppressionRepository.existsByEmail("fine@example.com"));
    }

    @Test
    @DisplayName("Postmark SpamComplaint event suppresses the address")
    void postmark_spamComplaint_suppresses() throws Exception {
        String body = "{\"RecordType\":\"SpamComplaint\",\"Email\":\"complainer@example.com\"}";

        mvc.perform(post("/api/webhooks/email/postmark?secret=test-webhook-secret")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
           .andExpect(status().isOk());

        assertTrue(suppressionRepository.existsByEmail("complainer@example.com"));
    }

    @Test
    @DisplayName("Postmark soft/transient bounce does NOT suppress")
    void postmark_softBounce_doesNotSuppress() throws Exception {
        String body = "{\"RecordType\":\"Bounce\",\"Type\":\"Transient\",\"Email\":\"tempfail@example.com\"}";

        mvc.perform(post("/api/webhooks/email/postmark?secret=test-webhook-secret")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
           .andExpect(status().isOk());

        org.junit.jupiter.api.Assertions.assertFalse(suppressionRepository.existsByEmail("tempfail@example.com"));
    }

    @Test
    @DisplayName("Wrong/missing secret is rejected with 401, and does NOT suppress")
    void wrongSecret_isRejected() throws Exception {
        String body = "[{\"email\":\"shouldnotbesuppressed@example.com\",\"event\":\"bounce\"}]";

        mvc.perform(post("/api/webhooks/email/sendgrid?secret=wrong")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
           .andExpect(status().isUnauthorized());

        mvc.perform(post("/api/webhooks/email/sendgrid") // no secret at all
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
           .andExpect(status().isUnauthorized());

        org.junit.jupiter.api.Assertions.assertFalse(
            suppressionRepository.existsByEmail("shouldnotbesuppressed@example.com"));
    }

    @Test
    @DisplayName("X-Webhook-Secret header is accepted as an alternative to the ?secret= query param")
    void headerSecret_isAccepted() throws Exception {
        String body = "{\"RecordType\":\"SpamComplaint\",\"Email\":\"via-header@example.com\"}";

        mvc.perform(post("/api/webhooks/email/postmark")
                .header("X-Webhook-Secret", "test-webhook-secret")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
           .andExpect(status().isOk());

        assertTrue(suppressionRepository.existsByEmail("via-header@example.com"));
    }
}
