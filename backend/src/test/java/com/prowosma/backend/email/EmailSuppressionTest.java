package com.prowosma.backend.email;

import com.prowosma.backend.ProwosmaTestBase;
import com.prowosma.backend.repository.EmailSuppressionRepository;
import com.prowosma.backend.service.EmailService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Verifies the email suppression list — a provider-reported hard bounce
 * or spam complaint must actually stop future sends to that address,
 * otherwise deliverability protection is purely decorative.
 */
@DisplayName("EmailService — suppression list")
class EmailSuppressionTest extends ProwosmaTestBase {

    @Autowired private EmailService emailService;
    @Autowired private EmailSuppressionRepository suppressionRepository;

    @BeforeEach
    void cleanSuppressions() {
        suppressionRepository.deleteAll();
    }

    @Test
    @DisplayName("Suppressing an address is idempotent and case/whitespace-insensitive")
    void suppress_normalizesAndDeduplicates() {
        emailService.suppress("Bounced@Example.com ", "HARD_BOUNCE", "ses", "{}");
        emailService.suppress(" bounced@example.com", "HARD_BOUNCE", "ses", "{}");

        assertEquals(1, emailService.listSuppressions().size(),
            "Same address in different case/whitespace must not create duplicate entries");
        assertEquals("bounced@example.com", emailService.listSuppressions().get(0).getEmail());
    }

    @Test
    @DisplayName("A suppressed address is skipped on send, without attempting SMTP delivery")
    void suppressedAddress_sendIsSkipped() {
        emailService.suppress("blocked@example.com", "COMPLAINT", "sendgrid", "{}");

        boolean result = emailService.sendHtmlEmail(
            "blocked@example.com", "Blocked User", "Subject", "<p>body</p>");

        assertFalse(result, "Sending to a suppressed address must return false");
    }

    @Test
    @DisplayName("unsuppress() removes an address, allowing sends to resume")
    void unsuppress_removesEntry() {
        emailService.suppress("typo-fixed@example.com", "HARD_BOUNCE", "postmark", "{}");
        assertTrue(suppressionRepository.existsByEmail("typo-fixed@example.com"));

        emailService.unsuppress("typo-fixed@example.com");

        assertFalse(suppressionRepository.existsByEmail("typo-fixed@example.com"));
    }
}
