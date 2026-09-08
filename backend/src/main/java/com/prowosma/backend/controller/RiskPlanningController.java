package com.prowosma.backend.controller;
import com.prowosma.backend.service.RiskAdjustedPlanningService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import java.util.*;
@RestController @RequestMapping("/api/risk") @RequiredArgsConstructor
public class RiskPlanningController {
    private final RiskAdjustedPlanningService riskService;
    @GetMapping("/project/{id}")
    public Map<String, Object> analyseProject(@PathVariable String id) { return riskService.analyseProject(id); }
    @GetMapping("/portfolio")
    public List<Map<String, Object>> analysePortfolio() { return riskService.analysePortfolio(); }
}
