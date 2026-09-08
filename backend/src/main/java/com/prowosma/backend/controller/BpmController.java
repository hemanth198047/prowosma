package com.prowosma.backend.controller;

import com.prowosma.backend.model.BpmInstance;
import com.prowosma.backend.model.BpmProcess;
import com.prowosma.backend.service.BpmService;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/bpm")
@Tag(name = "BPM — Business Process Management + Human-in-the-Loop AI")
@RequiredArgsConstructor
public class BpmController {

    private final BpmService bpmService;

    // ── Process definitions ───────────────────────────────────

    @GetMapping("/processes")
    public List<BpmProcess> getProcesses() { return bpmService.getProcesses(); }

    @GetMapping("/processes/{id}")
    public BpmProcess getProcess(@PathVariable String id) { return bpmService.getProcess(id); }

    @PostMapping("/processes")
    public BpmProcess createProcess(@RequestBody BpmProcess process, Authentication auth) {
        return bpmService.saveProcess(process, auth.getName());
    }

    @PutMapping("/processes/{id}")
    public BpmProcess updateProcess(@PathVariable String id,
                                    @RequestBody BpmProcess process, Authentication auth) {
        process.setId(id);
        return bpmService.saveProcess(process, auth.getName());
    }

    @DeleteMapping("/processes/{id}")
    public ResponseEntity<Map<String, String>> deleteProcess(@PathVariable String id) {
        bpmService.deleteProcess(id);
        return ResponseEntity.ok(Map.of("message", "Deleted"));
    }

    // ── Instance management ───────────────────────────────────

    @GetMapping("/instances")
    public List<BpmInstance> getInstances(@RequestParam(required = false) String processId) {
        return bpmService.getInstances(processId);
    }

    @GetMapping("/instances/{id}")
    public BpmInstance getInstance(@PathVariable String id) { return bpmService.getInstance(id); }

    @PostMapping("/processes/{processId}/start")
    public BpmInstance startProcess(@PathVariable String processId,
                                    @RequestBody(required = false) Map<String, Object> variables,
                                    Authentication auth) {
        return bpmService.startProcess(processId, variables, auth.getName());
    }

    // ── Human-in-the-loop actions ─────────────────────────────

    @PostMapping("/instances/{id}/decide")
    public BpmInstance humanDecide(@PathVariable String id,
                                   @RequestBody Map<String, Object> body,
                                   Authentication auth) {
        String nodeId   = (String) body.get("nodeId");
        String decision = (String) body.get("decision");  // APPROVED | REJECTED | PROCEED
        String comment  = (String) body.getOrDefault("comment", "");
        return bpmService.humanDecide(id, nodeId, decision, comment, auth.getName());
    }

    @PostMapping("/instances/{id}/override")
    public BpmInstance aiOverride(@PathVariable String id,
                                  @RequestBody Map<String, Object> body,
                                  Authentication auth) {
        String nodeId        = (String) body.get("nodeId");
        String overrideValue = (String) body.get("overrideValue");
        String reason        = (String) body.getOrDefault("reason", "Manual override");
        return bpmService.aiOverride(id, nodeId, overrideValue, reason, auth.getName());
    }

    @PostMapping("/instances/{id}/cancel")
    public BpmInstance cancel(@PathVariable String id) {
        BpmInstance inst = bpmService.getInstance(id);
        inst.setStatus("CANCELLED");
        return bpmService.getInstance(id); // return current state
    }
}
