package com.prowosma.backend.service;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.Integration;
import com.prowosma.backend.model.Task;
import com.prowosma.backend.repository.IntegrationRepository;
import com.prowosma.backend.repository.TaskRepository;
import com.prowosma.backend.service.ActivityLogService;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import org.springframework.http.*;
import java.time.LocalDateTime;
import java.util.*;

@Service
@RequiredArgsConstructor
public class IntegrationService {

    private final IntegrationRepository integrationRepository;
    private final ObjectMapper objectMapper;
    private final ActivityLogService activityLogService;
    private final TaskRepository taskRepository;
    private final NotificationService notificationService;
    private final WorkspaceContext workspaceContext;
    public List<Integration> getAll() {
        return integrationRepository.findByOrganizationId(workspaceContext.getWorkspaceId());
    }

    public Integration save(Integration integration) {
        String orgId = workspaceContext.getWorkspaceId();
        // Always bind to current workspace
        integration.setOrganizationId(orgId);
        if (integration.getKey() == null && integration.getType() != null)
            integration.setKey(integration.getType());

        // Org-scoped upsert — try type first, then key, then key as type
        String lookupType = integration.getType() != null ? integration.getType().toUpperCase()
                : integration.getKey() != null ? integration.getKey().toUpperCase() : null;
        if (integration.getType() == null && integration.getKey() != null)
            integration.setType(integration.getKey().toUpperCase());

        Optional<Integration> existing = Optional.empty();
        if (lookupType != null) {
            existing = integrationRepository.findByOrganizationIdAndType(orgId, lookupType);
            if (existing.isEmpty()) // try case-insensitive scan
                existing = integrationRepository.findByOrganizationId(orgId).stream()
                    .filter(i -> lookupType.equalsIgnoreCase(i.getType()) || lookupType.equalsIgnoreCase(i.getKey()))
                    .findFirst();
        }

        if (existing.isPresent()) {
            Integration e = existing.get();
            e.setEnabled(integration.isEnabled());
            e.setConfig(integration.getConfig());
            if (integration.getName() != null) e.setName(integration.getName());
            if (integration.getKey() != null)  e.setKey(integration.getKey());
            return integrationRepository.save(e);
        }
        Integration saved = integrationRepository.save(integration);
        activityLogService.log("INTEGRATION", saved.getId(),
                saved.getName() != null ? saved.getName() : saved.getType(),
                "CREATED", null,
                saved.getName() != null ? saved.getName() : saved.getType(), null);
        return saved;
    }

    public Integration toggle(String id) {
        Integration integration = integrationRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Integration not found"));
        integration.setEnabled(!integration.isEnabled());
        Integration saved = integrationRepository.save(integration);
        activityLogService.log("INTEGRATION", saved.getId(), saved.getName(),
                "CREATED", null, saved.getName(), null);
        return saved;
    }

    public Map<String, Object> syncGitHub(String id) {
        Integration integration = integrationRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Integration not found"));
        String token = integration.getConfig().get("token");
        String repo = integration.getConfig().get("repo");
        if (token == null || repo == null)
            throw new RuntimeException("GitHub token and repo are required");
        try {
            RestTemplate rest = new RestTemplate();
            HttpHeaders headers = new HttpHeaders();
            headers.set("Authorization", "Bearer " + token);
            headers.set("Accept", "application/vnd.github.v3+json");
            HttpEntity<Void> entity = new HttpEntity<>(headers);
            ResponseEntity<List> response = rest.exchange(
                    "https://api.github.com/repos/" + repo + "/issues?state=open",
                    HttpMethod.GET, entity, List.class);
            List issues = response.getBody();
            int imported = 0;
            if (issues != null) {
                for (Object issue : issues) {
                    Map<String, Object> issueMap = (Map<String, Object>) issue;
                    String title = "[GitHub] " + issueMap.get("title");
                    boolean exists = taskRepository.findByTitleContainingIgnoreCase(
                                    (String) issueMap.get("title")).stream()
                            .anyMatch(t -> t.getTitle().startsWith("[GitHub]"));
                    if (!exists) {
                        Task task = new Task();
                        task.setTitle(title);
                        task.setDescription((String) issueMap.getOrDefault("body", ""));
                        task.setStatus("TODO");
                        task.setPriority("MEDIUM");
                        task.setTags(List.of("github", "issue"));
                        task.setCreatedAt(LocalDateTime.now());
                        task.setUpdatedAt(LocalDateTime.now());
                        taskRepository.save(task);
                        imported++;
                    }
                }
            }
            integration.setLastSyncAt(LocalDateTime.now());
            integrationRepository.save(integration);
            notificationService.create("GitHub Sync",
                    imported + " issues imported from " + repo,
                    "SUCCESS", "TASK", null);
            return Map.of("imported", imported, "total", issues != null ? issues.size() : 0);
        } catch (Exception e) {
            throw new RuntimeException("GitHub sync failed: " + e.getMessage());
        }
    }

    public Map<String, Object> sendSlackMessage(String id, String message) {
        Integration integration = integrationRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Integration not found"));
        String webhookUrl = integration.getConfig().get("webhookUrl");
        if (webhookUrl == null) throw new RuntimeException("Slack webhook URL is required");
        try {
            RestTemplate rest = new RestTemplate();
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            Map<String, String> body = Map.of("text", message);
            HttpEntity<Map<String, String>> entity = new HttpEntity<>(body, headers);
            rest.postForEntity(webhookUrl, entity, String.class);
            return Map.of("message", "Slack message sent successfully");
        } catch (Exception e) {
            throw new RuntimeException("Slack send failed: " + e.getMessage());
        }
    }

    public Map<String, Object> syncGoogleCalendar(String id) {
        Integration integration = integrationRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Integration not found"));
        String calendarId = integration.getConfig().get("calendarId");
        if (calendarId == null) throw new RuntimeException("Google Calendar ID is required");
        List<Task> dueTasks = taskRepository.findByOrganizationId(workspaceContext.getWorkspaceId()).stream()
                .filter(t -> t.getDueDate() != null && !"DONE".equals(t.getStatus()))
                .toList();
        integration.setLastSyncAt(LocalDateTime.now());
        integrationRepository.save(integration);
        notificationService.create("Google Calendar Sync",
                dueTasks.size() + " tasks ready to sync",
                "INFO", "TASK", null);
        return Map.of("taskCount", dueTasks.size(),
                "message", "Calendar sync configured. " + dueTasks.size() + " tasks with due dates found.");
    }

    public Map<String, Object> sendZapierEvent(String id) {
        Integration integration = integrationRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Integration not found"));
        String webhookUrl = integration.getConfig().get("webhookUrl");
        if (webhookUrl == null) throw new RuntimeException("Zapier webhook URL is required");
        try {
            RestTemplate rest = new RestTemplate();
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            // Send a test event payload
            Map<String, Object> payload = new java.util.LinkedHashMap<>();
            payload.put("event",     "prowosma.test");
            payload.put("workspace", workspaceContext.getWorkspaceId());
            payload.put("timestamp", java.time.Instant.now().toString());
            payload.put("message",   "Test event from Prowosma");
            HttpEntity<Map<String, Object>> entity = new HttpEntity<>(payload, headers);
            rest.postForEntity(webhookUrl, entity, String.class);
            integration.setLastSyncAt(java.time.LocalDateTime.now());
            integrationRepository.save(integration);
            notificationService.create("Zapier", "Test event sent to Zapier webhook", "SUCCESS", "INTEGRATION", id);
            return Map.of("message", "Test event sent to Zapier successfully");
        } catch (Exception e) {
            throw new RuntimeException("Zapier webhook failed: " + e.getMessage());
        }
    }


    public Optional<Integration> findByKey(String key) {
        String orgId = workspaceContext.getWorkspaceId();
        // Try direct repo lookup first (faster)
        Optional<Integration> direct = integrationRepository
                .findByOrganizationIdAndType(orgId, key.toUpperCase());
        if (direct.isPresent()) return direct;
        // Fallback: scan org's integrations
        return integrationRepository.findByOrganizationId(orgId)
                .stream().filter(i ->
                    key.equalsIgnoreCase(i.getType()) ||
                    key.equalsIgnoreCase(i.getKey()))
                .findFirst();
    }
    public Integration toggleByKey(String key, boolean enabled) {
        Integration intg = findByKey(key)
                .orElseThrow(() -> new RuntimeException(
                    "Integration '" + key + "' not found for this workspace"));
        intg.setOrganizationId(workspaceContext.getWorkspaceId());
        intg.setEnabled(enabled);
        return integrationRepository.save(intg);
    }
    public Map<String, Object> searchConfluence(String query) {
        Integration intg = findByKey("CONFLUENCE")
                .orElseThrow(() -> new RuntimeException("Confluence not connected"));
        Map<String,String> cfg = intg.getConfig();
        String baseUrl = cfg.getOrDefault("baseUrl","").replaceAll("/+$","").trim();
        String email   = cfg.getOrDefault("email","").trim();
        String token   = cfg.getOrDefault("apiToken","").trim();
        String apiBase = baseUrl.contains("/wiki") ? baseUrl : baseUrl + "/wiki";
        try {
            RestTemplate rest = new RestTemplate();
            HttpHeaders h = new HttpHeaders();
            String creds = java.util.Base64.getEncoder().encodeToString((email+":"+token).getBytes(java.nio.charset.StandardCharsets.UTF_8));
            h.set("Authorization","Basic "+creds);
            h.set("Accept","application/json");
            // Build CQL safely — use title contains OR text contains
            String safeQuery = query.replaceAll("[^ww-zA-Z0-9 ]", "").trim();
            // Use /rest/api/content with title contains (~ operator)
            // URI constructor encodes the query param value safely
            java.net.URI searchUri = new java.net.URI("https", null,
                "prowosma.atlassian.net", 443,
                "/wiki/rest/api/content",
                "title~" + safeQuery + "&limit=15&expand=space,_links&type=page",
                null);
            System.out.println("[Confluence Search] uri=" + searchUri);
            ResponseEntity<String> res = rest.exchange(searchUri, HttpMethod.GET, new HttpEntity<>(h), String.class);
            String body = res.getBody();
            if (body == null || body.trim().startsWith("<"))
                throw new RuntimeException("Confluence returned HTML. Check your URL and credentials.");
            return objectMapper.readValue(body, Map.class);
        } catch(RuntimeException e){ throw e; }
          catch(Exception e){ throw new RuntimeException("Confluence search failed: "+e.getMessage()); }
    }
    public Map<String, Object> getConfluenceSpaces() {
        Integration intg = findByKey("CONFLUENCE")
                .orElseThrow(() -> new RuntimeException("Confluence not connected. Please configure Confluence in Integrations."));
        Map<String,String> cfg = intg.getConfig();
        if (cfg == null) throw new RuntimeException("Confluence config is empty. Please reconfigure.");
        String baseUrl = cfg.getOrDefault("baseUrl","").replaceAll("/+$","").trim();
        String email   = cfg.getOrDefault("email","").trim();
        String token   = cfg.getOrDefault("apiToken","").trim();
        if (baseUrl.isEmpty()) throw new RuntimeException("Confluence URL is missing. Please reconfigure.");
        if (email.isEmpty())   throw new RuntimeException("Confluence email is missing. Please reconfigure.");
        if (token.isEmpty())   throw new RuntimeException("Confluence API token is missing. Please reconfigure.");
        // Normalize URL — strip /wiki suffix if user included it in baseUrl
        // Confluence Cloud REST API is at: https://org.atlassian.net/wiki/rest/api
        // Users often paste their full site URL like https://org.atlassian.net
        String cleanBase = baseUrl.replaceAll("/wiki/?$","").replaceAll("/rest.*$","").trim();
        String apiBase   = cleanBase + "/wiki";
        try {
            RestTemplate rest = new RestTemplate();
            // Add error handler that reads body instead of throwing immediately
            rest.setErrorHandler(new org.springframework.web.client.DefaultResponseErrorHandler() {
                @Override public boolean hasError(org.springframework.http.client.ClientHttpResponse r) { return false; }
            });
            HttpHeaders h = new HttpHeaders();
            String creds = java.util.Base64.getEncoder()
                .encodeToString((email + ":" + token).getBytes(java.nio.charset.StandardCharsets.UTF_8));
            h.set("Authorization", "Basic " + creds);
            h.set("Accept",        "application/json");
            h.set("X-Atlassian-Token", "no-check");

            // Try with /wiki first (Confluence Cloud standard)
            String url = apiBase + "/rest/api/space?limit=50";
            ResponseEntity<String> res = rest.exchange(url, HttpMethod.GET, new HttpEntity<>(h), String.class);
            String body = res.getBody() != null ? res.getBody().trim() : "";

            // If we got HTML or 401/403, give a clear actionable error
            if (body.startsWith("<") || res.getStatusCode().value() == 401) {
                throw new RuntimeException(
                    "Confluence authentication failed (401). " +
                    "Please verify: " +
                    "(1) Email = the email you log into Atlassian with. " +
                    "(2) API Token = generated at id.atlassian.com/manage-profile/security/api-tokens " +
                    "— copy the token VALUE, not the token name. " +
                    "(3) Confluence URL = https://" + cleanBase.replaceAll("https?://","") + " (no /wiki suffix needed). " +
                    "Then click Reconfigure in Integrations and save again.");
            }
            if (res.getStatusCode().value() == 403) {
                throw new RuntimeException(
                    "Confluence access denied (403). " +
                    "Your API token works but your account may not have permission to list spaces. " +
                    "Check your Confluence site permissions.");
            }
            if (!body.startsWith("{")) {
                throw new RuntimeException("Unexpected response from Confluence: " + body.substring(0, Math.min(200, body.length())));
            }
            return objectMapper.readValue(body, Map.class);
        } catch(RuntimeException e){ throw e; }
          catch(Exception e){ throw new RuntimeException("Confluence spaces failed: " + e.getMessage()); }
    }
    public Map<String, Object> createConfluencePage(String spaceKey, String title, String body) {
        Integration intg = findByKey("CONFLUENCE")
                .orElseThrow(() -> new RuntimeException("Confluence not connected"));
        Map<String,String> cfg = intg.getConfig();
        String baseUrl = cfg.getOrDefault("baseUrl","").replaceAll("/+$","").trim();
        String email   = cfg.getOrDefault("email","").trim();
        String token   = cfg.getOrDefault("apiToken","").trim();
        String apiBase = baseUrl.contains("/wiki") ? baseUrl : baseUrl + "/wiki";
        try {
            RestTemplate rest = new RestTemplate();
            HttpHeaders h = new HttpHeaders();
            String creds = java.util.Base64.getEncoder().encodeToString((email+":"+token).getBytes(java.nio.charset.StandardCharsets.UTF_8));
            h.set("Authorization","Basic "+creds);
            h.set("Accept","application/json");
            h.setContentType(MediaType.APPLICATION_JSON);
            h.set("X-Atlassian-Token","no-check");
            Map<String,Object> payload = new LinkedHashMap<>();
            payload.put("type","page"); payload.put("title",title);
            payload.put("space",Map.of("key",spaceKey));
            payload.put("body",Map.of("storage",Map.of("value", body != null ? body : "", "representation","storage")));
            ResponseEntity<String> res = rest.exchange(
                apiBase+"/rest/api/content", HttpMethod.POST,
                new HttpEntity<>(payload, h), String.class);
            String respBody = res.getBody();
            return respBody != null ? objectMapper.readValue(respBody, Map.class) : Map.of();
        } catch(RuntimeException e){ throw e; }
          catch(Exception e){ throw new RuntimeException("Create Confluence page failed: "+e.getMessage()); }
    }
    public Map<String, Object> sendSlackNotification(String title, String message, String color) {
        Integration intg = findByKey("SLACK")
                .orElseThrow(() -> new RuntimeException("Slack not connected"));
        String webhook = intg.getConfig().get("webhookUrl");
        if (webhook==null) throw new RuntimeException("Slack webhook not configured");
        try {
            RestTemplate rest = new RestTemplate();
            HttpHeaders h = new HttpHeaders(); h.setContentType(MediaType.APPLICATION_JSON);
            Map<String,Object> attachment = new LinkedHashMap<>();
            attachment.put("color",color!=null?color:"#6366f1");
            attachment.put("title",title); attachment.put("text",message);
            attachment.put("footer","Prowosma"); attachment.put("ts",System.currentTimeMillis()/1000);
            rest.exchange(webhook,HttpMethod.POST,new HttpEntity<>(Map.of("attachments",List.of(attachment)),h),Map.class);
            return Map.of("ok",true);
        } catch(Exception e){ throw new RuntimeException("Slack failed: "+e.getMessage()); }
    }

    public void deleteById(String id) { integrationRepository.deleteById(id); }
}