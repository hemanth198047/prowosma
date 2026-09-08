package com.prowosma.backend.controller;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.Scenario;
import com.prowosma.backend.repository.ScenarioRepository;
import com.prowosma.backend.service.ScenarioSimulationService;
import com.prowosma.backend.util.PagedResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/scenarios")
@RequiredArgsConstructor
public class ScenarioController {

    private final ScenarioRepository          scenarioRepo;
    private final ScenarioSimulationService   simulationService;
    private final WorkspaceContext            ws;

    @GetMapping
    public PagedResponse<Scenario> getAll(
            @RequestParam(defaultValue = "0")  int page,
            @RequestParam(defaultValue = "50") int size) {
        return PagedResponse.ofList(
            scenarioRepo.findByOrganizationIdOrderByCreatedAtDesc(ws.getWorkspaceId()),
            page, Math.min(size, 200));
    }

    @GetMapping("/{id}")
    public Scenario getById(@PathVariable String id) {
        return scenarioRepo.findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Scenario not found"));
    }

    @PostMapping
    public Scenario create(@RequestBody Scenario scenario, Authentication auth) {
        scenario.setOrganizationId(ws.getWorkspaceId());
        scenario.setCreatedBy(auth.getName());
        scenario.setCreatedAt(LocalDateTime.now());
        scenario.setStatus("DRAFT");
        return scenarioRepo.save(scenario);
    }

    @PutMapping("/{id}")
    public Scenario update(@PathVariable String id, @RequestBody Scenario patch) {
        return scenarioRepo.findById(id).map(s -> {
            if (patch.getName()        != null) s.setName(patch.getName());
            if (patch.getDescription() != null) s.setDescription(patch.getDescription());
            if (patch.getType()        != null) s.setType(patch.getType());
            if (patch.getInputs()      != null) s.setInputs(patch.getInputs());
            return scenarioRepo.save(s);
        }).orElseThrow();
    }

    @PostMapping("/{id}/simulate")
    public Scenario simulate(@PathVariable String id) {
        Scenario scenario = scenarioRepo.findById(id)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Scenario not found"));

        Scenario.ScenarioResults results = simulationService.simulate(scenario);
        scenario.setResults(results);
        scenario.setStatus("SIMULATED");
        scenario.setSimulatedAt(LocalDateTime.now());
        return scenarioRepo.save(scenario);
    }

    /** Run simulation without saving — for live preview */
    @PostMapping("/preview")
    public Map<String, Object> preview(@RequestBody Scenario scenario) {
        scenario.setOrganizationId(ws.getWorkspaceId());
        if (scenario.getInputs() == null) scenario.setInputs(new Scenario.ScenarioInputs());
        Scenario.ScenarioResults results = simulationService.simulate(scenario);
        Map<String, Object> r = new java.util.LinkedHashMap<>();
        r.put("results",     results);
        r.put("aiNarrative", scenario.getAiNarrative());
        return r;
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, String>> delete(@PathVariable String id) {
        scenarioRepo.deleteById(id);
        return ResponseEntity.ok(Map.of("message", "Deleted"));
    }

    /** Compare two scenarios side by side */
    @GetMapping("/compare")
    public Map<String, Object> compare(@RequestParam String a, @RequestParam String b) {
        Scenario sa = scenarioRepo.findById(a).orElseThrow();
        Scenario sb = scenarioRepo.findById(b).orElseThrow();
        Map<String, Object> result = new java.util.LinkedHashMap<>();
        result.put("scenarioA", sa);
        result.put("scenarioB", sb);
        return result;
    }
}
