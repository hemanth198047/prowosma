package com.prowosma.backend.controller;

import com.prowosma.backend.model.Integration;
import com.prowosma.backend.service.IntegrationService;
import com.prowosma.backend.repository.IntegrationRepository;
import com.prowosma.backend.config.WorkspaceContext;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/integrations")
@RequiredArgsConstructor
public class IntegrationController {

    private final IntegrationService integrationService;
    private final IntegrationRepository integrationRepository;
    private final WorkspaceContext workspaceContext;

    @GetMapping
    public List<Integration> getAll() {
        return integrationService.getAll();
    }

    @PostMapping
    public Integration save(@RequestBody Integration integration) {
        return integrationService.save(integration);
    }

    @PatchMapping("/{id}/toggle")
    public Integration toggle(@PathVariable String id) {
        return integrationService.toggle(id);
    }

    @PostMapping("/{id}/sync/github")
    public Map<String, Object> syncGitHub(@PathVariable String id) {
        return integrationService.syncGitHub(id);
    }

    @PostMapping("/{id}/sync/slack")
    public Map<String, Object> sendSlack(@PathVariable String id,
                                         @RequestBody Map<String, String> body) {
        return integrationService.sendSlackMessage(id, body.get("message"));
    }

    @PostMapping("/{id}/sync/calendar")
    public Map<String, Object> syncCalendar(@PathVariable String id) {
        return integrationService.syncGoogleCalendar(id);
    }

    @PostMapping("/{id}/sync/zapier")
    public Map<String, Object> sendZapier(@PathVariable String id) {
        return integrationService.sendZapierEvent(id);
    }


    @PutMapping("/{key}")
    public Integration saveByKey(@PathVariable String key,
                                  @RequestBody Integration integration) {
        integration.setType(key); integration.setKey(key);
        return integrationService.save(integration);
    }

    @PatchMapping("/{key}/toggle")
    public Integration toggleByKey(@PathVariable String key,
                                    @RequestBody(required=false) Map<String,Object> body) {
        boolean enabled = body != null && Boolean.TRUE.equals(body.get("enabled"));
        try { return integrationService.toggleByKey(key, enabled); }
        catch (Exception e) { return integrationService.toggle(key); }
    }

    // ── Confluence ────────────────────────────────────────────────────────
    /** Force update — deletes all existing records for this key and saves fresh */
    @PostMapping("/{key}/force-update")
    public Integration forceUpdate(@PathVariable String key,
                                    @RequestBody Integration integration) {
        String orgId = workspaceContext.getWorkspaceId();
        System.out.println("[force-update] key=" + key + " orgId=" + orgId);
        // Delete ALL existing records for this key across the org
        integrationRepository.findByOrganizationId(orgId).stream()
            .filter(i -> key.equalsIgnoreCase(i.getType()) || key.equalsIgnoreCase(i.getKey()))
            .forEach(i -> {
                System.out.println("[force-update] deleting id=" + i.getId());
                integrationRepository.deleteById(i.getId());
            });
        // Save fresh
        integration.setOrganizationId(orgId);
        integration.setKey(key.toUpperCase());
        integration.setType(key.toUpperCase());
        integration.setName(key);
        integration.setEnabled(true);
        Integration saved = integrationRepository.save(integration);
        System.out.println("[force-update] saved id=" + saved.getId() + " orgId=" + saved.getOrganizationId());
        return saved;
    }

    /** Debug: show what Confluence config is stored (masks token) */
    @GetMapping("/confluence/debug")
    public Map<String,Object> confluenceDebug() {
        var intg = integrationService.findByKey("CONFLUENCE");
        if (intg.isEmpty()) return Map.of("error","Confluence not found in DB");
        var cfg = intg.get().getConfig();
        Map<String,Object> safe = new java.util.LinkedHashMap<>();
        safe.put("id",         intg.get().getId());
        safe.put("enabled",    intg.get().isEnabled());
        safe.put("orgId",      intg.get().getOrganizationId());
        safe.put("baseUrl",    cfg != null ? cfg.getOrDefault("baseUrl","(missing)") : "(no config)");
        safe.put("email",      cfg != null ? cfg.getOrDefault("email","(missing)") : "(no config)");
        safe.put("tokenLength",cfg != null && cfg.get("apiToken") != null ? cfg.get("apiToken").length() : 0);
        return safe;
    }

    @GetMapping("/confluence/spaces")
    public Map<String,Object> confluenceSpaces() {
        return integrationService.getConfluenceSpaces();
    }

    @GetMapping("/confluence/search")
    public Map<String,Object> confluenceSearch(@RequestParam String q) {
        return integrationService.searchConfluence(q);
    }

    @PostMapping("/confluence/pages")
    public Map<String,Object> createConfluencePage(@RequestBody Map<String,String> body) {
        return integrationService.createConfluencePage(
                body.get("spaceKey"), body.get("title"), body.get("content"));
    }

    // ── Slack ─────────────────────────────────────────────────────────────
    @PostMapping("/slack/notify")
    public Map<String,Object> slackNotify(@RequestBody Map<String,String> body) {
        return integrationService.sendSlackNotification(
                body.get("title"), body.get("message"), body.get("color"));
    }

}