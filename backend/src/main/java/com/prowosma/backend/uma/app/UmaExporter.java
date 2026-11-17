package com.prowosma.backend.uma.app;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.prowosma.backend.uma.core.UmaException;
import com.prowosma.backend.uma.model.UmaInsights;
import com.prowosma.backend.uma.model.UmaMeeting;
import com.prowosma.backend.uma.model.UmaSegment;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.apache.poi.xwpf.usermodel.XWPFParagraph;
import org.apache.poi.xwpf.usermodel.XWPFRun;
import org.springframework.http.HttpStatus;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.*;

/** Turns a processed meeting into a file people can keep: Markdown, plain text, JSON or Word. PDF is made in the browser. */
public final class UmaExporter {
    private UmaExporter() {}

    public record Export(String fileName, String contentType, byte[] bytes) {}

    /** One logical block of the export, rendered differently per format. */
    record Line(int level, String text) {}   // level 0 = paragraph, 1 = h1, 2 = h2, 3 = bullet

    public static Export export(UmaMeeting m, UmaInsights ins, List<UmaSegment> segs, String format) {
        String f = format == null ? "md" : format.toLowerCase(Locale.ROOT);
        String base = slug(m.getTitle());
        try {
            return switch (f) {
                case "md", "markdown" -> new Export(base + ".md", "text/markdown; charset=utf-8", markdown(lines(m, ins, segs)).getBytes(StandardCharsets.UTF_8));
                case "txt", "text" -> new Export(base + ".txt", "text/plain; charset=utf-8", text(lines(m, ins, segs)).getBytes(StandardCharsets.UTF_8));
                case "json" -> new Export(base + ".json", "application/json", json(m, ins, segs));
                case "docx", "word" -> new Export(base + ".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", docx(lines(m, ins, segs)));
                default -> throw new UmaException(HttpStatus.BAD_REQUEST, "UNSUPPORTED_EXPORT", "Choose Markdown, text, JSON or Word.");
            };
        } catch (IOException e) {
            throw new UmaException(HttpStatus.INTERNAL_SERVER_ERROR, "EXPORT_FAILED", "The export couldn't be created. Try again.");
        }
    }

    static String slug(String title) {
        String s = (title == null ? "meeting" : title).toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "-").replaceAll("^-|-$", "");
        if (s.isEmpty()) s = "meeting";
        return s.length() > 60 ? s.substring(0, 60) : s;
    }

    private static String refs(List<Integer> ev) {
        if (ev == null || ev.isEmpty()) return "";
        return " [" + String.join(", ", ev.stream().map(i -> "#" + i).toList()) + "]";
    }

    static List<Line> lines(UmaMeeting m, UmaInsights ins, List<UmaSegment> segs) {
        List<Line> out = new ArrayList<>();
        out.add(new Line(1, m.getTitle()));
        ZoneId zone;
        try { zone = m.getTimezone() == null ? ZoneId.of("UTC") : ZoneId.of(m.getTimezone()); } catch (Exception e) { zone = ZoneId.of("UTC"); }
        if (m.getMeetingAt() != null)
            out.add(new Line(0, "Date: " + DateTimeFormatter.ofPattern("d MMM yyyy, HH:mm").withZone(zone).format(m.getMeetingAt()) + " (" + zone.getId() + ")"));
        out.add(new Line(0, "Numbers in [#n] point to lines of the transcript at the end of this document."));
        if (ins != null) {
            if (ins.getSummary() != null && !ins.getSummary().isBlank()) { out.add(new Line(2, "Summary")); out.add(new Line(0, ins.getSummary())); }
            if (!ins.getDecisions().isEmpty()) {
                out.add(new Line(2, "Decisions"));
                for (UmaInsights.Decision d : ins.getDecisions())
                    out.add(new Line(3, d.getText() + (d.getDecidedBy() != null ? " (" + d.getDecidedBy() + ")" : "") + refs(d.getEvidence())));
            }
            if (!ins.getActions().isEmpty()) {
                out.add(new Line(2, "Action items"));
                for (UmaInsights.ActionItem a : ins.getActions()) {
                    if ("REJECTED".equals(a.getStatus())) continue;
                    StringBuilder sb = new StringBuilder(a.getTitle());
                    sb.append(" — owner: ").append(a.getOwnerSpoken() != null ? a.getOwnerSpoken() : "not named");
                    sb.append(", due: ").append(a.getDueDate() != null ? a.getDueDate().toString() : a.getDueSpoken() != null ? a.getDueSpoken() : "not stated");
                    if ("CREATED".equals(a.getStatus())) sb.append(", task created");
                    out.add(new Line(3, sb + refs(a.getEvidence())));
                }
            }
            addFindings(out, "Risks and blockers", ins.getRisks());
            addFindings(out, "Open questions", ins.getQuestions());
            addFindings(out, "Follow-ups", ins.getFollowUps());
            if (!ins.getNotes().isEmpty()) {
                out.add(new Line(2, "Notes"));
                for (UmaInsights.Topic t : ins.getNotes()) {
                    out.add(new Line(0, t.getTitle()));
                    for (UmaInsights.Point p : t.getPoints()) out.add(new Line(3, p.getText() + refs(p.getEvidence())));
                }
            }
        }
        if (segs != null && !segs.isEmpty()) {
            out.add(new Line(2, "Transcript"));
            for (UmaSegment s : segs)
                out.add(new Line(0, "#" + s.getSeq() + (s.getStartMs() != null ? " " + clock(s.getStartMs()) : "")
                        + (s.getSpeaker() != null ? " " + s.getSpeaker() + ":" : "") + " " + s.getText()));
        }
        return out;
    }

    private static void addFindings(List<Line> out, String heading, List<UmaInsights.Finding> list) {
        if (list == null || list.isEmpty()) return;
        out.add(new Line(2, heading));
        for (UmaInsights.Finding f : list) out.add(new Line(3, f.getText() + refs(f.getEvidence())));
    }

    static String clock(long ms) {
        long s = ms / 1000;
        return s >= 3600 ? String.format("%d:%02d:%02d", s / 3600, (s / 60) % 60, s % 60) : String.format("%d:%02d", s / 60, s % 60);
    }

    static String markdown(List<Line> lines) {
        StringBuilder sb = new StringBuilder();
        for (Line l : lines) {
            switch (l.level()) {
                case 1 -> sb.append("# ").append(l.text()).append("\n\n");
                case 2 -> sb.append("\n## ").append(l.text()).append("\n\n");
                case 3 -> sb.append("- ").append(l.text()).append('\n');
                default -> sb.append(l.text()).append("\n\n");
            }
        }
        return sb.toString().replaceAll("\n{3,}", "\n\n");
    }

    static String text(List<Line> lines) {
        StringBuilder sb = new StringBuilder();
        for (Line l : lines) {
            switch (l.level()) {
                case 1 -> sb.append(l.text().toUpperCase(Locale.ROOT)).append("\n\n");
                case 2 -> sb.append('\n').append(l.text().toUpperCase(Locale.ROOT)).append('\n');
                case 3 -> sb.append("  * ").append(l.text()).append('\n');
                default -> sb.append(l.text()).append('\n');
            }
        }
        return sb.toString();
    }

    static byte[] json(UmaMeeting m, UmaInsights ins, List<UmaSegment> segs) throws IOException {
        ObjectMapper om = new ObjectMapper().registerModule(new JavaTimeModule()).disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS).enable(SerializationFeature.INDENT_OUTPUT);
        Map<String, Object> root = new LinkedHashMap<>();
        Map<String, Object> meeting = new LinkedHashMap<>();
        meeting.put("id", m.getId()); meeting.put("title", m.getTitle()); meeting.put("meetingAt", m.getMeetingAt());
        meeting.put("timezone", m.getTimezone()); meeting.put("source", m.getSource()); meeting.put("provider", m.getProvider()); meeting.put("status", m.getStatus());
        root.put("meeting", meeting);
        root.put("insights", ins);
        List<Map<String, Object>> t = new ArrayList<>();
        for (UmaSegment s : segs) {
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("line", s.getSeq()); r.put("startMs", s.getStartMs()); r.put("endMs", s.getEndMs()); r.put("speaker", s.getSpeaker()); r.put("text", s.getText());
            t.add(r);
        }
        root.put("transcript", t);
        return om.writeValueAsBytes(root);
    }

    static byte[] docx(List<Line> lines) throws IOException {
        try (XWPFDocument doc = new XWPFDocument(); ByteArrayOutputStream bos = new ByteArrayOutputStream()) {
            for (Line l : lines) {
                XWPFParagraph p = doc.createParagraph();
                XWPFRun r = p.createRun();
                switch (l.level()) {
                    case 1 -> { r.setBold(true); r.setFontSize(20); r.setText(l.text()); }
                    case 2 -> { r.setBold(true); r.setFontSize(14); p.setSpacingBefore(240); r.setText(l.text()); }
                    case 3 -> { p.setIndentationLeft(360); r.setText("• " + l.text()); }
                    default -> r.setText(l.text());
                }
            }
            doc.write(bos);
            return bos.toByteArray();
        }
    }
}
