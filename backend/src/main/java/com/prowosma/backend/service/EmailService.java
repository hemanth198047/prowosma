package com.prowosma.backend.service;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.EmailSuppression;
import com.prowosma.backend.model.WorkspaceConfig;
import com.prowosma.backend.repository.EmailSuppressionRepository;
import com.prowosma.backend.repository.WorkspaceConfigRepository;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.mail.internet.MimeMessage;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;

import java.util.Properties;

/**
 * EmailService — sends real emails, with per-workspace SMTP settings.
 *
 * Each workspace can configure its own "From" address and mail server via
 * Admin -> Email Settings (see AdminController's /email-settings endpoints
 * and WorkspaceConfig's smtp* fields) instead of the app operator having to
 * set server-wide environment variables. If a workspace hasn't configured
 * anything, this falls back to the server-wide sender Spring Boot
 * auto-configures from spring.mail.* (SMTP_HOST/SMTP_USERNAME/SMTP_PASSWORD
 * etc — works with Amazon SES, SendGrid, Postmark, Mailgun, or Gmail; see
 * docs/EMAIL_SETUP.md), so nothing breaks for workspaces that don't need
 * per-workspace sending.
 *
 * Before every send, checks EmailSuppressionRepository — an address a
 * provider has reported as a hard bounce or spam complaint (see
 * EmailWebhookController) is skipped rather than retried, protecting the
 * sending domain's deliverability reputation for every other user.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class EmailService {

    /** The server-wide sender Spring Boot builds from spring.mail.* properties. */
    private final JavaMailSender defaultMailSender;
    private final WorkspaceConfigRepository workspaceConfigRepository;
    private final WorkspaceContext workspaceContext;
    private final EmailSuppressionRepository suppressionRepository;
    private final MeterRegistry meterRegistry;
    private final FieldEncryptionService fieldEncryptionService;

    @Value("${app.from.email:noreply@prowosma.com}")
    private String defaultFromEmail;

    @Value("${app.from.name:Prowosma}")
    private String defaultFromName;

    // Used by InvitationService, AuthEnhancementsController (HTML)
    public boolean sendHtmlEmail(String toEmail, String toName,
                               String subject, String html) {
        return send(toEmail, subject, html, true);
    }

    /**
     * Returns true if the email was actually handed off to a mail server
     * successfully, false otherwise. Never throws — callers that don't need
     * to know whether delivery succeeded (batch digests, scheduled
     * reminders) can keep ignoring the return value exactly as before.
     * Callers where silent failure would leave a user waiting on an email
     * that's never coming (invitations, magic links, verification codes)
     * should check it and surface a real error instead of claiming success.
     */
    private boolean send(String to, String subject,
                      String content, boolean isHtml) {
        if (to != null && suppressionRepository.existsByEmail(to.trim().toLowerCase())) {
            // This address previously hard-bounced or complained — a provider
            // told us, in writing, to stop. Sending again risks the sending
            // domain's deliverability reputation for EVERY user, not just this
            // one address, so this is a hard skip, not a retry-with-backoff.
            log.warn("Skipped email to {} — address is on the suppression list " +
                "(prior hard bounce or spam complaint). See /api/admin/email-suppressions.", to);
            meterRegistry.counter("email.send.suppressed").increment();
            return false;
        }

        ResolvedSender resolved = resolveSender();
        try {
            MimeMessage msg = resolved.sender().createMimeMessage();
            MimeMessageHelper helper =
                    new MimeMessageHelper(msg, true, "UTF-8");
            helper.setFrom(resolved.fromEmail(), resolved.fromName());
            helper.setTo(to);
            helper.setSubject(subject);
            helper.setText(content, isHtml);
            resolved.sender().send(msg);
            log.info("Email sent to {} (via {})", to, resolved.source());
            meterRegistry.counter("email.send.success", "source", resolved.source()).increment();
            return true;
        } catch (Exception e) {
            log.warn("Failed to send email to {} (via {}): {}", to, resolved.source(), e.getMessage());
            meterRegistry.counter("email.send.failure", "source", resolved.source()).increment();
            return false;
        }
    }

    /**
     * Sends a test email using settings that may not be saved yet — used by
     * the "Send test email" button so an admin can verify a config works
     * before committing it. Returns null on success, or the real error
     * message on failure so it can be shown directly in the UI.
     */
    public String sendTestEmail(String toEmail, WorkspaceConfig candidateConfig) {
        try {
            JavaMailSender sender = buildSenderFromConfig(candidateConfig);
            MimeMessage msg = sender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(msg, true, "UTF-8");
            String from = candidateConfig.getFromEmail() != null && !candidateConfig.getFromEmail().isBlank()
                    ? candidateConfig.getFromEmail() : candidateConfig.getSmtpUsername();
            helper.setFrom(from, candidateConfig.getFromName() != null ? candidateConfig.getFromName() : defaultFromName);
            helper.setTo(toEmail);
            helper.setSubject("Prowosma test email");
            helper.setText("<p>This is a test email from your Prowosma workspace's email settings. If you're reading this, they work.</p>", true);
            sender.send(msg);
            return null;
        } catch (Exception e) {
            log.warn("Test email failed: {}", e.getMessage());
            return e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
        }
    }

    private record ResolvedSender(JavaMailSender sender, String fromEmail, String fromName, String source) {}

    /**
     * Records a hard bounce or complaint reported by the mail provider itself
     * — called only from EmailWebhookController, never directly by app code.
     */
    public void suppress(String email, String reason, String source, String rawEvent) {
        if (email == null || email.isBlank()) return;
        String normalized = email.trim().toLowerCase();
        if (suppressionRepository.existsByEmail(normalized)) return; // already suppressed
        EmailSuppression s = new EmailSuppression();
        s.setEmail(normalized);
        s.setReason(reason);
        s.setSource(source);
        s.setRawEvent(rawEvent);
        suppressionRepository.save(s);
        log.warn("Suppressed {} — {} reported by {}", normalized, reason, source);
        meterRegistry.counter("email.suppression.added", "reason", reason, "source", source).increment();
    }

    /** For the admin "remove from suppression list" action — e.g. a customer fixed a typo'd address. */
    public void unsuppress(String email) {
        if (email == null) return;
        suppressionRepository.deleteByEmail(email.trim().toLowerCase());
    }

    public java.util.List<EmailSuppression> listSuppressions() {
        return suppressionRepository.findAll();
    }

    private ResolvedSender resolveSender() {
        String workspaceId = null;
        try {
            // WorkspaceContext is request-scoped - this throws if called from
            // a thread with no active HTTP request (the DigestService
            // scheduled jobs, for example). That's expected there, not an
            // error: those always use the server-wide sender.
            workspaceId = workspaceContext.getWorkspaceId();
        } catch (Exception ignored) {
            // no active request — fall through to the server-wide sender
        }

        if (workspaceId != null) {
            var cfg = workspaceConfigRepository.findByWorkspaceId(workspaceId).orElse(null);
            if (cfg != null && cfg.isEmailConfigured()
                    && cfg.getSmtpUsername() != null && !cfg.getSmtpUsername().isBlank()
                    && cfg.getSmtpPassword() != null && !cfg.getSmtpPassword().isBlank()) {
                String from = cfg.getFromEmail() != null && !cfg.getFromEmail().isBlank()
                        ? cfg.getFromEmail() : cfg.getSmtpUsername();
                String name = cfg.getFromName() != null && !cfg.getFromName().isBlank()
                        ? cfg.getFromName() : defaultFromName;
                return new ResolvedSender(buildSenderFromConfig(cfg), from, name, "workspace settings");
            }
        }

        return new ResolvedSender(defaultMailSender, defaultFromEmail, defaultFromName, "server default");
    }

    private JavaMailSender buildSenderFromConfig(WorkspaceConfig cfg) {
        JavaMailSenderImpl sender = new JavaMailSenderImpl();
        sender.setHost(cfg.getSmtpHost());
        sender.setPort(cfg.getSmtpPort());
        sender.setUsername(cfg.getSmtpUsername());
        sender.setPassword(fieldEncryptionService.decrypt(cfg.getSmtpPassword()));

        Properties props = sender.getJavaMailProperties();
        props.put("mail.transport.protocol", "smtp");
        props.put("mail.smtp.auth", "true");
        props.put("mail.smtp.starttls.enable", String.valueOf(cfg.isSmtpUseTls()));
        props.put("mail.smtp.connectiontimeout", "10000");
        props.put("mail.smtp.timeout", "10000");
        return sender;
    }
}
