package com.prowosma.backend.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.integration.InboundEvent;
import com.prowosma.backend.integration.InboundEventParser;
import com.prowosma.backend.integration.InboundPlanner;
import com.prowosma.backend.integration.InboundSource;
import com.prowosma.backend.integration.InboundTokens;
import com.prowosma.backend.integration.Signatures;
import com.prowosma.backend.model.Integration;
import com.prowosma.backend.model.Task;
import com.prowosma.backend.repository.IntegrationRepository;
import com.prowosma.backend.repository.TaskRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

/**
 * Turns events posted by Datadog, Sentry and Jenkins into tasks.
 *
 * The caller is not a logged-in user, so who they are is decided by the secret in the URL:
 * it identifies one integration, and therefore one workspace, and everything below happens in
 * that workspace only. The token is compared by its SHA-256 hash; an unknown, disabled or
 * malformed token is always the same 404, so nothing can be learned about which tokens exist.
 *
 * What an event does (see {@link InboundPlanner}): a new problem creates a task; a repeat of
 * one that is still open does nothing; the same problem after its task was closed reopens it;
 * a recovery closes the task. Problems are identified by a stable external reference (a
 * monitor, an issue, a failing job) stored on the task.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class InboundEventService {

    static final int MAX_BODY_BYTES = 256 * 1024;

    private final IntegrationRepository integrationRepository;
    private final TaskRepository taskRepository;
    private final TaskService taskService;
    private final NotificationService notificationService;
    private final WorkspaceContext workspaceContext;
    private final ObjectMapper objectMapper;

    public Map<String, Object> ingest(InboundSource source, String token, byte[] body, Map<String, String> requestHeaders) {
        if (!InboundTokens.looksValid(token)) throw notFound();
        Integration integration = integrationRepository
                .findByTypeAndInboundTokenHash(source.integrationType(), InboundTokens.hash(token))
                .filter(Integration::isEnabled)
                .orElseThrow(InboundEventService::notFound);

        if (body == null || body.length == 0) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Empty request body");
        if (body.length > MAX_BODY_BYTES) throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "Request body too large");

        Map<String, String> headers = lowerCased(requestHeaders);
        if (source == InboundSource.SENTRY) {
            // Sentry signs every body with the integration's client secret. If one is configured
            // it is required; if not, the secret URL alone authenticates the call.
            String secret = integration.getConfig() == null ? null : integration.getConfig().get("clientSecret");
            if (secret != null && !secret.isBlank()
                    && !Signatures.matches(secret, body, headers.get("sentry-hook-signature"))) {
                throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid signature");
            }
        }

        final Map<String, Object> payload;
        try {
            payload = objectMapper.readValue(body, new TypeReference<Map<String, Object>>() { });
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Request body is not valid JSON");
        }
        final InboundEvent event;
        try {
            event = InboundEventParser.parse(source, payload, headers);
        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage());
        }

        // Everything from here behaves as a request for the integration's own workspace
        // (task creation, notifications, activity log and live updates all read this context).
        String orgId = integration.getOrganizationId();
        workspaceContext.setWorkspaceId(orgId);

        Optional<Task> existing = taskRepository.findByOrganizationIdAndExternalRef(orgId, event.externalRef())
                .stream().findFirst();
        InboundPlanner.Plan plan = InboundPlanner.plan(event.action(), existing.map(Task::getStatus).orElse(null));

        Map<String, Object> result = new LinkedHashMap<>();
        switch (plan) {
            case CREATE: {
                Task saved = taskService.create(newTask(orgId, event));
                result.put("status", "created");
                result.put("taskId", saved.getId());
                break;
            }
            case REOPEN: {
                Task task = existing.get();
                task.setStatus("TODO");
                task.setUpdatedAt(LocalDateTime.now());
                taskRepository.save(task);
                notificationService.create(event.source().displayName() + " problem returned",
                        task.getTitle(), "WARNING", "TASK", task.getId());
                result.put("status", "reopened");
                result.put("taskId", task.getId());
                break;
            }
            case RESOLVE: {
                Task task = existing.get();
                task.setStatus("DONE");
                task.setUpdatedAt(LocalDateTime.now());
                taskRepository.save(task);
                notificationService.create(event.source().displayName() + " problem resolved",
                        task.getTitle(), "SUCCESS", "TASK", task.getId());
                result.put("status", "resolved");
                result.put("taskId", task.getId());
                break;
            }
            default:
                result.put("status", "unchanged");
                existing.ifPresent(t -> result.put("taskId", t.getId()));
                break;
        }

        integration.setLastSyncAt(LocalDateTime.now());
        integrationRepository.save(integration);
        log.info("Inbound {} event {} -> {}", source.pathName(), event.externalRef(), result.get("status"));
        return result;
    }

    private static Task newTask(String orgId, InboundEvent event) {
        Task task = new Task();
        task.setOrganizationId(orgId);
        task.setTitle("[" + event.source().displayName() + "] " + event.title());
        task.setDescription(event.description());
        task.setStatus("TODO");
        task.setPriority(event.priority());
        task.setSeverity(event.severity());
        task.setType(event.type());
        task.setTags(new java.util.ArrayList<>(event.tags()));
        Map<String, String> external = new HashMap<>();
        external.put("externalRef", event.externalRef());
        external.put("externalSource", event.source().pathName());
        task.setCustomFieldValues(external);
        return task;
    }

    private static Map<String, String> lowerCased(Map<String, String> headers) {
        Map<String, String> out = new HashMap<>();
        if (headers != null) headers.forEach((k, v) -> { if (k != null) out.put(k.toLowerCase(Locale.ROOT), v); });
        return out;
    }

    private static ResponseStatusException notFound() {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "Not found");
    }
}
