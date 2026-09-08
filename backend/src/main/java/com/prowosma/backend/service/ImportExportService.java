package com.prowosma.backend.service;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.Goal;
import com.prowosma.backend.model.Project;
import com.prowosma.backend.model.Task;
import com.prowosma.backend.repository.GoalRepository;
import com.prowosma.backend.repository.ProjectRepository;
import com.prowosma.backend.repository.TaskRepository;
import lombok.RequiredArgsConstructor;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;

@Service
@RequiredArgsConstructor
public class ImportExportService {

    private final ProjectRepository projectRepository;
    private final GoalRepository    goalRepository;
    private final TaskRepository    taskRepository;
    private final WorkspaceContext  workspaceContext;

    private static final DateTimeFormatter FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd");

    // ── EXPORT ──────────────────────────────────────────────────────────────

    public byte[] exportWorkspace() throws IOException {
        String orgId = workspaceContext.getWorkspaceId();
        List<Project> projects = projectRepository.findByOrganizationId(orgId);
        List<Goal>    goals    = goalRepository.findByOrganizationId(orgId);
        List<Task>    tasks    = taskRepository.findByOrganizationId(orgId);

        try (XSSFWorkbook wb = new XSSFWorkbook()) {
            CellStyle headerStyle = buildHeaderStyle(wb);
            CellStyle wrapStyle   = buildWrapStyle(wb);

            writeProjects(wb, projects, headerStyle, wrapStyle);
            writeGoals(wb, goals, headerStyle, wrapStyle);
            writeTasks(wb, tasks, headerStyle, wrapStyle);
            writeInstructions(wb, headerStyle);

            ByteArrayOutputStream out = new ByteArrayOutputStream();
            wb.write(out);
            return out.toByteArray();
        }
    }

    private void writeProjects(XSSFWorkbook wb, List<Project> projects,
                                CellStyle h, CellStyle w) {
        Sheet s = wb.createSheet("Projects");
        String[] cols = {"name","description","status","color","category","linkedGoalId",
                         "parentProjectId","dueDate","budget","currency"};
        writeHeader(s, h, cols);
        int r = 1;
        for (Project p : projects) {
            Row row = s.createRow(r++);
            setCell(row, 0, p.getName(), w);
            setCell(row, 1, p.getDescription(), w);
            setCell(row, 2, p.getStatus(), w);
            setCell(row, 3, p.getColor(), w);
            setCell(row, 4, p.getCategory(), w);
            setCell(row, 5, p.getLinkedGoalId(), w);
            setCell(row, 6, p.getParentProjectId(), w);
            setCell(row, 7, p.getDueDate() != null ? p.getDueDate().format(FMT) : "", w);
            setCell(row, 8, p.getBudget() != null ? String.valueOf(p.getBudget()) : "", w);
            setCell(row, 9, p.getCurrency(), w);
        }
        autoSize(s, cols.length);
    }

    private void writeGoals(XSSFWorkbook wb, List<Goal> goals,
                             CellStyle h, CellStyle w) {
        Sheet s = wb.createSheet("Goals");
        String[] cols = {"title","description","status","progress","level",
                         "owner","quarter","confidence","targetDate","parentGoalId"};
        writeHeader(s, h, cols);
        int r = 1;
        for (Goal g : goals) {
            Row row = s.createRow(r++);
            setCell(row, 0, g.getTitle(), w);
            setCell(row, 1, g.getDescription(), w);
            setCell(row, 2, g.getStatus(), w);
            setCell(row, 3, String.valueOf(g.getProgress()), w);
            setCell(row, 4, g.getLevel(), w);
            setCell(row, 5, g.getOwner(), w);
            setCell(row, 6, g.getQuarter(), w);
            setCell(row, 7, String.valueOf(g.getConfidence()), w);
            setCell(row, 8, g.getTargetDate() != null ? g.getTargetDate().format(FMT) : "", w);
            setCell(row, 9, g.getParentGoalId(), w);
        }
        autoSize(s, cols.length);
    }

    private void writeTasks(XSSFWorkbook wb, List<Task> tasks,
                             CellStyle h, CellStyle w) {
        Sheet s = wb.createSheet("Tasks");
        String[] cols = {"title","description","status","priority","projectId",
                         "dueDate","storyPoints","type","severity","tags"};
        writeHeader(s, h, cols);
        int r = 1;
        for (Task t : tasks) {
            Row row = s.createRow(r++);
            setCell(row, 0, t.getTitle(), w);
            setCell(row, 1, t.getDescription(), w);
            setCell(row, 2, t.getStatus(), w);
            setCell(row, 3, t.getPriority(), w);
            setCell(row, 4, t.getProjectId(), w);
            setCell(row, 5, t.getDueDate() != null ? t.getDueDate().format(FMT) : "", w);
            setCell(row, 6, t.getStoryPoints() != null ? String.valueOf(t.getStoryPoints()) : "", w);
            setCell(row, 7, t.getType(), w);
            setCell(row, 8, t.getSeverity(), w);
            setCell(row, 9, t.getTags() != null ? String.join(",", t.getTags()) : "", w);
        }
        autoSize(s, cols.length);
    }

    private void writeInstructions(XSSFWorkbook wb, CellStyle h) {
        Sheet s = wb.createSheet("Instructions");
        CellStyle bold = wb.createCellStyle();
        Font f = wb.createFont(); f.setBold(true); f.setFontHeightInPoints((short)11);
        bold.setFont(f);

        String[][] rows = {
            {"Prowosma Import/Export Template"},
            {""},
            {"PROJECTS sheet columns:"},
            {"name *","Required. Project name."},
            {"description","Optional description."},
            {"status","ACTIVE | PAUSED | DONE  (default: ACTIVE)"},
            {"color","Hex color e.g. #6366f1"},
            {"category","Category name (text)"},
            {"linkedGoalId","Goal ID to link (leave blank for new imports)"},
            {"parentProjectId","Parent project ID for sub-projects"},
            {"dueDate","yyyy-MM-dd format e.g. 2026-12-31"},
            {"budget","Numeric value e.g. 50000"},
            {"currency","USD | EUR | GBP etc."},
            {""},
            {"GOALS sheet columns:"},
            {"title *","Required. Goal title."},
            {"description","Optional description."},
            {"status","ACTIVE | ACHIEVED | PAUSED  (default: ACTIVE)"},
            {"progress","0–100 (default: 0)"},
            {"level","COMPANY | TEAM | INDIVIDUAL  (default: COMPANY)"},
            {"owner","Owner name or email"},
            {"quarter","e.g. Q1 2026"},
            {"confidence","0–100 (default: 50)"},
            {"targetDate","yyyy-MM-dd format"},
            {"parentGoalId","Parent goal ID for sub-goals"},
            {""},
            {"TASKS sheet columns:"},
            {"title *","Required. Task title."},
            {"description","Optional description."},
            {"status","TODO | IN_PROGRESS | DONE  (default: TODO)"},
            {"priority","LOW | MEDIUM | HIGH  (default: MEDIUM)"},
            {"projectId","Project ID to link task to"},
            {"dueDate","yyyy-MM-dd format"},
            {"storyPoints","Numeric value e.g. 3"},
            {"type","TASK | BUG | STORY | EPIC | FEATURE"},
            {"severity","NONE | LOW | MEDIUM | HIGH | CRITICAL"},
            {"tags","Comma-separated e.g. frontend,backend"},
            {""},
            {"NOTES:"},
            {"- Rows with empty 'name' / 'title' are skipped."},
            {"- IDs in linkedGoalId / projectId / parentProjectId must exist in the system."},
            {"- On re-import duplicates will be created — use export + edit + import for migrations."},
        };
        for (int i = 0; i < rows.length; i++) {
            Row row = s.createRow(i);
            for (int j = 0; j < rows[i].length; j++) {
                Cell c = row.createCell(j);
                c.setCellValue(rows[i][j]);
                if (i == 0 || (rows[i].length == 1 && rows[i][0].endsWith(":")))
                    c.setCellStyle(bold);
            }
        }
        s.setColumnWidth(0, 7000); s.setColumnWidth(1, 18000);
    }

    // ── IMPORT ──────────────────────────────────────────────────────────────

    public Map<String, Object> importWorkspace(MultipartFile file) throws IOException {
        String orgId = workspaceContext.getWorkspaceId();
        int projCreated = 0, goalCreated = 0, taskCreated = 0;
        List<String> errors = new ArrayList<>();

        try (Workbook wb = new XSSFWorkbook(file.getInputStream())) {
            // Import Goals first (projects may link to them)
            Sheet goalSheet = wb.getSheet("Goals");
            if (goalSheet != null) {
                Map<Integer, String> hdr = readHeader(goalSheet);
                for (int i = 1; i <= goalSheet.getLastRowNum(); i++) {
                    Row row = goalSheet.getRow(i);
                    if (row == null) continue;
                    String title = cellStr(row, colIdx(hdr, "title"));
                    if (title.isBlank()) continue;
                    try {
                        Goal g = new Goal();
                        g.setOrganizationId(orgId);
                        g.setTitle(title);
                        g.setDescription(cellStr(row, colIdx(hdr, "description")));
                        g.setStatus(def(cellStr(row, colIdx(hdr, "status")), "ACTIVE"));
                        g.setProgress(parseInt(cellStr(row, colIdx(hdr, "progress")), 0));
                        g.setLevel(def(cellStr(row, colIdx(hdr, "level")), "COMPANY"));
                        g.setOwner(cellStr(row, colIdx(hdr, "owner")));
                        g.setQuarter(cellStr(row, colIdx(hdr, "quarter")));
                        g.setConfidence(parseInt(cellStr(row, colIdx(hdr, "confidence")), 50));
                        String td = cellStr(row, colIdx(hdr, "targetDate"));
                        if (!td.isBlank()) g.setTargetDate(LocalDateTime.parse(td + "T00:00:00"));
                        String pgId = cellStr(row, colIdx(hdr, "parentGoalId"));
                        if (!pgId.isBlank()) g.setParentGoalId(pgId);
                        goalRepository.save(g);
                        goalCreated++;
                    } catch (Exception e) {
                        errors.add("Goal row " + (i+1) + ": " + e.getMessage());
                    }
                }
            }

            // Import Projects
            Sheet projSheet = wb.getSheet("Projects");
            if (projSheet != null) {
                Map<Integer, String> hdr = readHeader(projSheet);
                for (int i = 1; i <= projSheet.getLastRowNum(); i++) {
                    Row row = projSheet.getRow(i);
                    if (row == null) continue;
                    String name = cellStr(row, colIdx(hdr, "name"));
                    if (name.isBlank()) continue;
                    try {
                        Project p = new Project();
                        p.setOrganizationId(orgId);
                        p.setName(name);
                        p.setDescription(cellStr(row, colIdx(hdr, "description")));
                        p.setStatus(def(cellStr(row, colIdx(hdr, "status")), "ACTIVE"));
                        p.setColor(def(cellStr(row, colIdx(hdr, "color")), "#6366f1"));
                        p.setCategory(def(cellStr(row, colIdx(hdr, "category")), "General"));
                        p.setLinkedGoalId(nullIfBlank(cellStr(row, colIdx(hdr, "linkedGoalId"))));
                        p.setParentProjectId(nullIfBlank(cellStr(row, colIdx(hdr, "parentProjectId"))));
                        p.setCurrency(def(cellStr(row, colIdx(hdr, "currency")), "USD"));
                        String dd = cellStr(row, colIdx(hdr, "dueDate"));
                        if (!dd.isBlank()) p.setDueDate(LocalDateTime.parse(dd + "T00:00:00"));
                        String bgt = cellStr(row, colIdx(hdr, "budget"));
                        if (!bgt.isBlank()) p.setBudget(Double.parseDouble(bgt));
                        projectRepository.save(p);
                        projCreated++;
                    } catch (Exception e) {
                        errors.add("Project row " + (i+1) + ": " + e.getMessage());
                    }
                }
            }

            // Import Tasks
            Sheet taskSheet = wb.getSheet("Tasks");
            if (taskSheet != null) {
                Map<Integer, String> hdr = readHeader(taskSheet);
                for (int i = 1; i <= taskSheet.getLastRowNum(); i++) {
                    Row row = taskSheet.getRow(i);
                    if (row == null) continue;
                    String title = cellStr(row, colIdx(hdr, "title"));
                    if (title.isBlank()) continue;
                    try {
                        Task t = new Task();
                        t.setOrganizationId(orgId);
                        t.setTitle(title);
                        t.setDescription(cellStr(row, colIdx(hdr, "description")));
                        t.setStatus(def(cellStr(row, colIdx(hdr, "status")), "TODO"));
                        t.setPriority(def(cellStr(row, colIdx(hdr, "priority")), "MEDIUM"));
                        t.setProjectId(nullIfBlank(cellStr(row, colIdx(hdr, "projectId"))));
                        String dd = cellStr(row, colIdx(hdr, "dueDate"));
                        if (!dd.isBlank()) t.setDueDate(LocalDateTime.parse(dd + "T00:00:00"));
                        String sp = cellStr(row, colIdx(hdr, "storyPoints"));
                        if (!sp.isBlank()) t.setStoryPoints(Integer.parseInt(sp.trim()));
                        t.setType(def(cellStr(row, colIdx(hdr, "type")), "TASK"));
                        t.setSeverity(def(cellStr(row, colIdx(hdr, "severity")), "NONE"));
                        String tags = cellStr(row, colIdx(hdr, "tags"));
                        if (!tags.isBlank())
                            t.setTags(Arrays.asList(tags.split(",")));
                        taskRepository.save(t);
                        taskCreated++;
                    } catch (Exception e) {
                        errors.add("Task row " + (i+1) + ": " + e.getMessage());
                    }
                }
            }
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("projectsCreated", projCreated);
        result.put("goalsCreated",    goalCreated);
        result.put("tasksCreated",    taskCreated);
        result.put("errors",          errors);
        result.put("success",         errors.isEmpty());
        return result;
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private void writeHeader(Sheet s, CellStyle style, String[] cols) {
        Row row = s.createRow(0);
        for (int i = 0; i < cols.length; i++) {
            Cell c = row.createCell(i);
            c.setCellValue(cols[i]);
            c.setCellStyle(style);
        }
    }

    private void setCell(Row row, int col, String val, CellStyle style) {
        Cell c = row.createCell(col);
        c.setCellValue(val != null ? val : "");
        c.setCellStyle(style);
    }

    private void autoSize(Sheet s, int cols) {
        for (int i = 0; i < cols; i++) s.autoSizeColumn(i);
    }

    private CellStyle buildHeaderStyle(XSSFWorkbook wb) {
        CellStyle s = wb.createCellStyle();
        Font f = wb.createFont();
        f.setBold(true); f.setColor(IndexedColors.WHITE.getIndex());
        f.setFontHeightInPoints((short) 11);
        s.setFont(f);
        s.setFillForegroundColor(IndexedColors.INDIGO.getIndex());
        s.setFillPattern(FillPatternType.SOLID_FOREGROUND);
        s.setBorderBottom(BorderStyle.THIN);
        s.setAlignment(HorizontalAlignment.CENTER);
        return s;
    }

    private CellStyle buildWrapStyle(XSSFWorkbook wb) {
        CellStyle s = wb.createCellStyle();
        s.setWrapText(false);
        s.setVerticalAlignment(VerticalAlignment.CENTER);
        return s;
    }

    private Map<Integer, String> readHeader(Sheet s) {
        Row hdr = s.getRow(0);
        Map<Integer, String> map = new HashMap<>();
        if (hdr == null) return map;
        for (Cell c : hdr) map.put(c.getColumnIndex(), c.getStringCellValue().trim().toLowerCase());
        return map;
    }

    private int colIdx(Map<Integer, String> hdr, String name) {
        return hdr.entrySet().stream()
                .filter(e -> e.getValue().equalsIgnoreCase(name))
                .mapToInt(Map.Entry::getKey).findFirst().orElse(-1);
    }

    private String cellStr(Row row, int col) {
        if (col < 0 || row == null) return "";
        Cell c = row.getCell(col);
        if (c == null) return "";
        return switch (c.getCellType()) {
            case STRING  -> c.getStringCellValue().trim();
            case NUMERIC -> {
                double d = c.getNumericCellValue();
                yield d == Math.floor(d) ? String.valueOf((long) d) : String.valueOf(d);
            }
            case BOOLEAN -> String.valueOf(c.getBooleanCellValue());
            case FORMULA -> c.getCachedFormulaResultType() == CellType.NUMERIC
                    ? String.valueOf((long) c.getNumericCellValue())
                    : c.getRichStringCellValue().getString().trim();
            default -> "";
        };
    }

    private String def(String v, String dflt)    { return (v == null || v.isBlank()) ? dflt : v; }
    private String nullIfBlank(String v)          { return (v == null || v.isBlank()) ? null : v; }
    private int    parseInt(String v, int dflt)   {
        try { return v.isBlank() ? dflt : Integer.parseInt(v.trim()); }
        catch (NumberFormatException e) { return dflt; }
    }
}
