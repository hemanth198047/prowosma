package com.prowosma.backend.attendance.app;

import org.apache.poi.ss.usermodel.*;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;

/** The attendance report as CSV or Excel for payroll. Times are shown in the workspace's time zone. */
public final class AttendanceExport {
    private AttendanceExport() {}

    static final String[] HEADERS = {"Date", "Name", "Email", "Workspace", "Department", "Manager", "Status", "First in", "Last out", "Worked (h)", "Breaks (h)",
            "Late (min)", "Overtime (h)", "Overtime status", "Comp-off earned (days)", "Work mode", "Project", "Sprint", "Leave type", "Holiday",
            "Auto clock-out", "IP", "Location"};

    static Object[] values(Map<String, Object> r, ZoneId zone) {
        DateTimeFormatter hm = DateTimeFormatter.ofPattern("HH:mm").withZone(zone);
        Object deps = r.get("departments") instanceof List<?> l && !l.isEmpty()
                ? String.join("; ", l.stream().map(String::valueOf).toList()) : r.get("department");
        return new Object[]{r.get("date"), r.get("name"), r.get("email"), r.get("workspace"), deps, r.get("managerName"), r.get("status"),
                r.get("firstIn") instanceof Instant i ? hm.format(i) : "", r.get("lastOut") instanceof Instant o ? hm.format(o) : "",
                hours(r.get("workedMinutes")), hours(r.get("breakMinutes")), r.get("lateMinutes") == null ? "" : r.get("lateMinutes"),
                hours(r.get("overtimeMinutes")), r.get("overtimeStatus"), r.get("compOffEarned"), r.get("workMode"), r.get("project"), r.get("sprint"),
                r.get("leaveType"), r.get("holiday"), Boolean.TRUE.equals(r.get("autoClosed")) ? "yes" : "", r.get("ip"), r.get("location")};
    }

    static Object hours(Object minutes) {
        if (!(minutes instanceof Number n)) return "";
        return Math.round(n.doubleValue() / 60.0 * 100) / 100.0;
    }

    public static byte[] csv(List<Map<String, Object>> rows, ZoneId zone) {
        StringBuilder sb = new StringBuilder("﻿");                // so Excel opens UTF-8 names correctly
        sb.append(String.join(",", HEADERS)).append("\r\n");
        for (Map<String, Object> r : rows) {
            Object[] v = values(r, zone);
            for (int i = 0; i < v.length; i++) {
                if (i > 0) sb.append(',');
                sb.append(cell(v[i]));
            }
            sb.append("\r\n");
        }
        return sb.toString().getBytes(StandardCharsets.UTF_8);
    }

    /** Quoted, and a leading = + - @ is neutralised so a name can't run as a spreadsheet formula. */
    static String cell(Object o) {
        if (o == null) return "";
        String s = String.valueOf(o);
        if (!s.isEmpty() && !(o instanceof Number) && "=+-@\t\r".indexOf(s.charAt(0)) >= 0) s = "'" + s;
        if (s.contains(",") || s.contains("\"") || s.contains("\n") || s.contains("\r") || s.startsWith("'")) s = "\"" + s.replace("\"", "\"\"") + "\"";
        return s;
    }

    public static byte[] xlsx(List<Map<String, Object>> rows, ZoneId zone) {
        try (Workbook wb = new XSSFWorkbook(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            Sheet sheet = wb.createSheet("Attendance");
            CellStyle bold = wb.createCellStyle();
            Font f = wb.createFont();
            f.setBold(true);
            bold.setFont(f);
            Row head = sheet.createRow(0);
            for (int i = 0; i < HEADERS.length; i++) {
                Cell c = head.createCell(i);
                c.setCellValue(HEADERS[i]);
                c.setCellStyle(bold);
            }
            int n = 1;
            for (Map<String, Object> r : rows) {
                Row row = sheet.createRow(n++);
                Object[] v = values(r, zone);
                for (int i = 0; i < v.length; i++) {
                    Cell c = row.createCell(i);
                    if (v[i] instanceof Number num) c.setCellValue(num.doubleValue());
                    else c.setCellValue(v[i] == null ? "" : String.valueOf(v[i]));   // text cells: never evaluated as formulas
                }
            }
            sheet.createFreezePane(0, 1);
            for (int i = 0; i < HEADERS.length; i++) sheet.setColumnWidth(i, Math.min(40, Math.max(10, HEADERS[i].length() + 4)) * 256);
            wb.write(out);
            return out.toByteArray();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
