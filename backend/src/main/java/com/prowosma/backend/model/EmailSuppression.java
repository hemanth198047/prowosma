package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.LocalDateTime;

/**
 * An email address this app has been told, by the mail provider itself,
 * to stop sending to — a hard bounce (address doesn't exist / permanently
 * rejects mail) or a spam complaint. EmailService checks this before every
 * send; deliberately sending into a hard-bounce or a complaint again is
 * exactly the pattern that gets a sending domain's reputation destroyed
 * with providers like Gmail/Outlook, at which point EVERY email this app
 * sends starts landing in spam, not just the one bad address.
 *
 * Populated by EmailWebhookController from provider bounce/complaint
 * webhooks (SES via SNS, SendGrid, Postmark) — never written by hand.
 */
@Data
@Document(collection = "email_suppressions")
public class EmailSuppression {
    @Id private String id;

    @Indexed(unique = true)
    private String email;

    /** HARD_BOUNCE | COMPLAINT — SOFT bounces are NOT suppressed (temporary, e.g. full mailbox). */
    private String reason;

    /** Which provider reported this — ses | sendgrid | postmark — for audit/debugging only. */
    private String source;

    private LocalDateTime suppressedAt = LocalDateTime.now();

    /** Raw provider event payload, for investigating a disputed/incorrect suppression. */
    private String rawEvent;
}
