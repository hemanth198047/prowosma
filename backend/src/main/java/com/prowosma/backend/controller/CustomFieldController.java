package com.prowosma.backend.controller;

import com.prowosma.backend.model.CustomField;
import com.prowosma.backend.service.CustomFieldService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/custom-fields")
@RequiredArgsConstructor
public class CustomFieldController {

    private final CustomFieldService customFieldService;

    @GetMapping
    public List<CustomField> getAll() {
        return customFieldService.getAll();
    }

    @GetMapping("/entity/{entityType}")
    public List<CustomField> getByEntityType(@PathVariable String entityType) {
        return customFieldService.getByEntityType(entityType);
    }

    @PostMapping
    public CustomField create(@RequestBody CustomField field) {
        return customFieldService.create(field);
    }

    @PutMapping("/{id}")
    public CustomField update(@PathVariable String id,
                              @RequestBody CustomField field) {
        return customFieldService.update(id, field);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> delete(@PathVariable String id) {
        customFieldService.delete(id);
        return ResponseEntity.ok(Map.of("message", "Deleted"));
    }
}