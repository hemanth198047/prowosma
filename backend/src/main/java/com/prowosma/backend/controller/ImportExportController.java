package com.prowosma.backend.controller;

import com.prowosma.backend.service.ImportExportService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.time.LocalDate;
import java.util.Map;

@RestController
@RequestMapping("/api/import-export")
@RequiredArgsConstructor
public class ImportExportController {

    private final ImportExportService importExportService;

    /** Download full workspace as .xlsx */
    @GetMapping("/export")
    public ResponseEntity<byte[]> export() throws Exception {
        byte[] data = importExportService.exportWorkspace();
        String filename = "prowosma-export-" + LocalDate.now() + ".xlsx";
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
                .contentType(MediaType.parseMediaType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
                .body(data);
    }

    /** Upload .xlsx and bulk-create projects / goals / tasks */
    @PostMapping(value = "/import", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<Map<String, Object>> importData(
            @RequestPart("file") MultipartFile file) throws Exception {
        if (file.isEmpty())
            return ResponseEntity.badRequest().body(Map.of("error", "File is empty"));
        String name = file.getOriginalFilename() != null ? file.getOriginalFilename() : "";
        if (!name.endsWith(".xlsx") && !name.endsWith(".xls"))
            return ResponseEntity.badRequest().body(Map.of("error", "Only .xlsx files are supported"));
        Map<String, Object> result = importExportService.importWorkspace(file);
        return ResponseEntity.ok(result);
    }

    /** Download blank template with instructions */
    @GetMapping("/template")
    public ResponseEntity<byte[]> template() throws Exception {
        byte[] data = importExportService.exportWorkspace(); // returns real data as template
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"prowosma-import-template.xlsx\"")
                .contentType(MediaType.parseMediaType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
                .body(data);
    }
}
