package com.prowosma.backend.controller;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.*;
import com.prowosma.backend.repository.*;
import com.prowosma.backend.util.PagedResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.*;

@RestController
@RequestMapping("/api/time")
@RequiredArgsConstructor
public class TimeTrackingController {

    private final TaskRepository        taskRepository;
    private final ProjectRepository     projectRepository;
    private final TeamMemberRepository  teamMemberRepository;
    private final InvoiceRepository     invoiceRepository;
    private final WorkspaceContext      workspaceContext;

    // ── Workspace-wide time report ────────────────────────────
    @GetMapping("/report")
    public Map<String, Object> getReport(
            @RequestParam(required = false) String projectId,
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to) {

        String orgId = workspaceContext.getWorkspaceId();
        LocalDateTime fromDate = from != null ? LocalDateTime.parse(from) : LocalDateTime.now().minusDays(30);
        LocalDateTime toDate   = to   != null ? LocalDateTime.parse(to)   : LocalDateTime.now();

        List<Task> tasks = projectId != null
                ? taskRepository.findByProjectId(projectId)
                : taskRepository.findByOrganizationId(orgId,
                    org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();

        // Flatten all time logs with task/project context
        List<Map<String, Object>> entries = new ArrayList<>();
        for (Task task : tasks) {
            if (task.getTimeLogs() == null) continue;
            Project proj = projectId != null ? null :
                    task.getProjectId() != null
                            ? projectRepository.findById(task.getProjectId()).orElse(null)
                            : null;
            for (TimeLog tl : task.getTimeLogs()) {
                if (tl.getLoggedAt() != null &&
                        (tl.getLoggedAt().isBefore(fromDate) || tl.getLoggedAt().isAfter(toDate)))
                    continue;
                Map<String, Object> e = new LinkedHashMap<>();
                e.put("timeLogId",   tl.getId());
                e.put("minutes",     tl.getMinutes());
                e.put("hours",       Math.round(tl.getMinutes() / 60.0 * 100.0) / 100.0);
                e.put("description", tl.getDescription());
                e.put("billable",    tl.isBillable());
                e.put("hourlyRate",  tl.getHourlyRate());
                e.put("amount",      Math.round(tl.getMinutes() / 60.0 * tl.getHourlyRate() * 100.0) / 100.0);
                e.put("loggedBy",    tl.getLoggedBy());
                e.put("loggedAt",    tl.getLoggedAt());
                e.put("taskId",      task.getId());
                e.put("taskTitle",   task.getTitle());
                e.put("projectId",   task.getProjectId());
                e.put("projectName", proj != null ? proj.getName() : null);
                entries.add(e);
            }
        }

        // Summaries
        int    totalMinutes   = entries.stream().mapToInt(e -> (int) e.get("minutes")).sum();
        int    billableMinutes= entries.stream().filter(e -> (boolean) e.get("billable")).mapToInt(e -> (int) e.get("minutes")).sum();
        double totalAmount    = entries.stream().mapToDouble(e -> (double) e.get("amount")).sum();

        // Group by project
        Map<String, IntSummaryStatistics> byProject = entries.stream()
                .filter(e -> e.get("projectId") != null)
                .collect(Collectors.groupingBy(
                        e -> (String) e.get("projectId"),
                        Collectors.summarizingInt(e -> (int) e.get("minutes"))));

        List<Map<String, Object>> projectBreakdown = byProject.entrySet().stream().map(en -> {
            Project p = projectRepository.findById(en.getKey()).orElse(null);
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("projectId",   en.getKey());
            row.put("projectName", p != null ? p.getName() : "Unknown");
            row.put("color",       p != null ? p.getColor() : "#6366f1");
            row.put("minutes",     (int) en.getValue().getSum());
            row.put("hours",       Math.round(en.getValue().getSum() / 60.0 * 100.0) / 100.0);
            return row;
        }).sorted((a, b) -> Integer.compare((int) b.get("minutes"), (int) a.get("minutes")))
          .collect(Collectors.toList());

        // Group by member
        Map<String, Integer> byMember = new LinkedHashMap<>();
        entries.stream().filter(e -> e.get("loggedBy") != null).forEach(e -> {
            String user = (String) e.get("loggedBy");
            byMember.merge(user, (int) e.get("minutes"), Integer::sum);
        });
        List<Map<String, Object>> memberBreakdown = byMember.entrySet().stream()
                .sorted((a, b) -> Integer.compare(b.getValue(), a.getValue()))
                .map(en -> {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("user",    en.getKey());
                    row.put("name",    en.getKey().contains("@") ? en.getKey().split("@")[0] : en.getKey());
                    row.put("minutes", en.getValue());
                    row.put("hours",   Math.round(en.getValue() / 60.0 * 100.0) / 100.0);
                    return row;
                }).collect(Collectors.toList());

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("entries",          entries);
        result.put("totalMinutes",     totalMinutes);
        result.put("totalHours",       Math.round(totalMinutes / 60.0 * 100.0) / 100.0);
        result.put("billableMinutes",  billableMinutes);
        result.put("billableHours",    Math.round(billableMinutes / 60.0 * 100.0) / 100.0);
        result.put("totalAmount",      Math.round(totalAmount * 100.0) / 100.0);
        result.put("projectBreakdown", projectBreakdown);
        result.put("memberBreakdown",  memberBreakdown);
        return result;
    }

    // ── Invoice CRUD ──────────────────────────────────────────
    @GetMapping("/invoices")
    public PagedResponse<Invoice> getInvoices(
            @RequestParam(defaultValue = "0")  int page,
            @RequestParam(defaultValue = "50") int size) {
        var items = invoiceRepository.findByOrganizationId(workspaceContext.getWorkspaceId());
        return PagedResponse.ofList(items, page, Math.min(size, 200));
    }

    @PostMapping("/invoices")
    public Invoice createInvoice(@RequestBody Invoice invoice, Authentication auth) {
        String orgId = workspaceContext.getWorkspaceId();
        invoice.setOrganizationId(orgId);
        invoice.setCreatedBy(auth.getName());
        invoice.setIssuedAt(LocalDateTime.now());
        // Auto-generate invoice number
        long count = invoiceRepository.countByOrganizationId(orgId);
        invoice.setInvoiceNumber("INV-" + String.format("%04d", count + 1));
        // Compute totals
        if (invoice.getLineItems() != null) {
            double subtotal = invoice.getLineItems().stream()
                    .mapToDouble(Invoice.InvoiceLineItem::getAmount).sum();
            double tax = Math.round(subtotal * invoice.getTaxRate() / 100.0 * 100.0) / 100.0;
            invoice.setSubtotal(Math.round(subtotal * 100.0) / 100.0);
            invoice.setTaxAmount(tax);
            invoice.setTotal(Math.round((subtotal + tax) * 100.0) / 100.0);
        }
        return invoiceRepository.save(invoice);
    }

    @PutMapping("/invoices/{id}")
    public Invoice updateInvoice(@PathVariable String id, @RequestBody Invoice updated) {
        Invoice existing = invoiceRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Invoice not found: " + id));
        if (updated.getStatus()      != null) existing.setStatus(updated.getStatus());
        if (updated.getClientName()  != null) existing.setClientName(updated.getClientName());
        if (updated.getClientEmail() != null) existing.setClientEmail(updated.getClientEmail());
        if (updated.getNotes()       != null) existing.setNotes(updated.getNotes());
        if (updated.getDueAt()       != null) existing.setDueAt(updated.getDueAt());
        if ("PAID".equals(updated.getStatus())) existing.setPaidAt(LocalDateTime.now());
        return invoiceRepository.save(existing);
    }

    @DeleteMapping("/invoices/{id}")
    public Map<String, String> deleteInvoice(@PathVariable String id) {
        invoiceRepository.deleteById(id);
        return Map.of("message", "Invoice deleted");
    }

    // ── Generate invoice from time logs ───────────────────────
    @PostMapping("/invoices/generate")
    public Invoice generateFromTimeLogs(@RequestBody Map<String, Object> req, Authentication auth) {
        String orgId     = workspaceContext.getWorkspaceId();
        String projId    = (String) req.get("projectId");
        double rate      = req.get("hourlyRate") != null ? ((Number) req.get("hourlyRate")).doubleValue() : 0;
        String client    = (String) req.getOrDefault("clientName", "");
        String clientEmail = (String) req.getOrDefault("clientEmail", "");
        double taxRate   = req.get("taxRate") != null ? ((Number) req.get("taxRate")).doubleValue() : 0;

        List<Task> tasks = projId != null
                ? taskRepository.findByProjectId(projId)
                : taskRepository.findByOrganizationId(orgId,
                    org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();

        Project project = projId != null ? projectRepository.findById(projId).orElse(null) : null;

        List<Invoice.InvoiceLineItem> lineItems = new ArrayList<>();
        for (Task task : tasks) {
            if (task.getTimeLogs() == null) continue;
            int taskMins = task.getTimeLogs().stream()
                    .filter(TimeLog::isBillable).mapToInt(TimeLog::getMinutes).sum();
            if (taskMins == 0) continue;
            double taskRate = rate > 0 ? rate :
                    task.getTimeLogs().stream().filter(TimeLog::isBillable)
                            .mapToDouble(TimeLog::getHourlyRate).average().orElse(0);
            Invoice.InvoiceLineItem li = new Invoice.InvoiceLineItem();
            li.setTaskTitle(task.getTitle());
            li.setDescription("Time logged: " + task.getTitle());
            li.setMinutes(taskMins);
            li.setHours(Math.round(taskMins / 60.0 * 100.0) / 100.0);
            li.setHourlyRate(taskRate);
            li.setAmount(Math.round(li.getHours() * taskRate * 100.0) / 100.0);
            lineItems.add(li);
        }

        Invoice invoice = new Invoice();
        invoice.setOrganizationId(orgId);
        invoice.setProjectId(projId);
        invoice.setProjectName(project != null ? project.getName() : "All Projects");
        invoice.setClientName(client);
        invoice.setClientEmail(clientEmail);
        invoice.setTaxRate(taxRate);
        invoice.setLineItems(lineItems);
        invoice.setCreatedBy(auth.getName());
        invoice.setIssuedAt(LocalDateTime.now());
        invoice.setDueAt(LocalDateTime.now().plusDays(30));
        long count = invoiceRepository.countByOrganizationId(orgId);
        invoice.setInvoiceNumber("INV-" + String.format("%04d", count + 1));
        double subtotal = lineItems.stream().mapToDouble(Invoice.InvoiceLineItem::getAmount).sum();
        double tax      = Math.round(subtotal * taxRate / 100.0 * 100.0) / 100.0;
        invoice.setSubtotal(Math.round(subtotal * 100.0) / 100.0);
        invoice.setTaxAmount(tax);
        invoice.setTotal(Math.round((subtotal + tax) * 100.0) / 100.0);
        return invoiceRepository.save(invoice);
    }
}
