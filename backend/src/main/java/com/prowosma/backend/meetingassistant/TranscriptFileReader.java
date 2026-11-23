package com.prowosma.backend.meetingassistant;

import com.prowosma.backend.meetingassistant.TranscriptParser.TranscriptFormatException;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import javax.xml.stream.XMLInputFactory;
import javax.xml.stream.XMLStreamConstants;
import javax.xml.stream.XMLStreamException;
import javax.xml.stream.XMLStreamReader;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.Charset;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Turns an uploaded transcript FILE into plain text for {@link TranscriptParser}: .txt / .vtt / .srt / .md (any common text encoding) and Word (.docx —
 * what Google Meet transcripts saved to Drive and Teams transcripts downloaded from the meeting usually are). Pure logic, no dependencies.
 * The file is treated strictly as DATA: a .docx is only unzipped in memory (never to disk, with a hard size cap against zip bombs), only its text is read,
 * and XML entities / DTDs are switched off. PDFs (text layer only) and JSON exports (Fireflies, Whisper and similar) are read too. Old .doc, .rtf and other formats are refused with a message that says what to do instead.
 */
public final class TranscriptFileReader {

    private TranscriptFileReader() {}

    /** The text of the file and the format hint to give the parser (null = let it detect). */
    public record Content(String text, String formatHint) {}

    /** A .docx is a zip; its text is far smaller than this. Anything that unpacks beyond it is refused rather than held in memory. */
    static final long MAX_UNZIPPED_BYTES = 25L * 1024 * 1024;

    public static Content read(byte[] data, String filename) {
        if (data == null || data.length == 0) throw new TranscriptFormatException("EMPTY_TRANSCRIPT", "That file is empty.");
        String ext = extensionOf(filename);

        if (startsWith(data, '%', 'P', 'D', 'F') || ext.equals("pdf")) {
            if (!startsWith(data, '%', 'P', 'D', 'F')) throw new TranscriptFormatException("UNSUPPORTED_FILE", "That file ends in .pdf but isn't a PDF.");
            return new Content(pdfText(data), "TEXT");
        }
        if (startsWith(data, 0xD0, 0xCF, 0x11, 0xE0) || ext.equals("doc"))
            throw new TranscriptFormatException("UNSUPPORTED_FILE", "Old Word files (.doc) can't be read. Save it as .docx or .pdf, or paste the text instead.");
        if (startsWith(data, '{', '\\', 'r', 't', 'f') || ext.equals("rtf"))
            throw new TranscriptFormatException("UNSUPPORTED_FILE", "Rich Text files (.rtf) can't be read. Save it as .docx or .pdf, or paste the text instead.");
        if (ext.equals("json")) return jsonContent(data);
        if (ext.equals("xls") || ext.equals("xlsx") || ext.equals("csv") || ext.equals("pptx") || ext.equals("odt"))
            throw new TranscriptFormatException("UNSUPPORTED_FILE", "That kind of file can't be read. Use a .txt, .vtt, .srt, .json, .pdf or .docx transcript, or paste the text instead.");

        boolean zip = startsWith(data, 'P', 'K', 0x03, 0x04);
        if (zip || ext.equals("docx")) {
            if (!zip) throw new TranscriptFormatException("UNSUPPORTED_FILE", "That file ends in .docx but isn't a Word document.");
            return new Content(docxText(data), "TEXT");
        }
        String hint = ext.equals("vtt") ? "VTT" : ext.equals("srt") ? "SRT" : null;
        return new Content(decode(data), hint);
    }

    // ── text ─────────────────────────────────────────────────────────────────

    /** UTF-8 (with or without a BOM) if it is valid UTF-8; UTF-16 when it has a BOM; otherwise Windows-1252, so an old export never shows garbage. */
    static String decode(byte[] d) {
        if (d.length >= 2 && (d[0] & 0xFF) == 0xFF && (d[1] & 0xFF) == 0xFE) return new String(d, 2, d.length - 2, StandardCharsets.UTF_16LE);
        if (d.length >= 2 && (d[0] & 0xFF) == 0xFE && (d[1] & 0xFF) == 0xFF) return new String(d, 2, d.length - 2, StandardCharsets.UTF_16BE);
        int off = d.length >= 3 && (d[0] & 0xFF) == 0xEF && (d[1] & 0xFF) == 0xBB && (d[2] & 0xFF) == 0xBF ? 3 : 0;
        try {
            return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(d, off, d.length - off)).toString();
        } catch (CharacterCodingException notUtf8) {
            return new String(d, off, d.length - off, Charset.forName("windows-1252"));
        }
    }

    // ── Word ─────────────────────────────────────────────────────────────────

    /** One line per paragraph (table cells too), in document order. Only the body text — never headers, macros, links or embedded files. */
    static String docxText(byte[] data) {
        byte[] xml = null;
        try (ZipInputStream zin = new ZipInputStream(new ByteArrayInputStream(data))) {
            for (ZipEntry e; (e = zin.getNextEntry()) != null; ) {
                if (!"word/document.xml".equals(e.getName())) continue;
                xml = readCapped(zin, MAX_UNZIPPED_BYTES);
                break;
            }
        } catch (TranscriptFormatException tooBig) {
            throw tooBig;
        } catch (IOException | RuntimeException bad) {
            throw new TranscriptFormatException("UNSUPPORTED_FILE", "That Word file couldn't be opened. It may be damaged, or password-protected.");
        }
        if (xml == null) throw new TranscriptFormatException("UNSUPPORTED_FILE", "That file isn't a Word document (.docx).");
        StringBuilder out = new StringBuilder();
        XMLInputFactory f = XMLInputFactory.newFactory();
        f.setProperty(XMLInputFactory.SUPPORT_DTD, false);
        f.setProperty(XMLInputFactory.IS_SUPPORTING_EXTERNAL_ENTITIES, false);
        try {
            XMLStreamReader r = f.createXMLStreamReader(new ByteArrayInputStream(xml));
            boolean inText = false;
            int cellDepth = 0;                                   // inside a table cell, a paragraph ends with a space so a row reads as ONE line
            while (r.hasNext()) {
                int ev = r.next();
                if (ev == XMLStreamConstants.START_ELEMENT) {
                    switch (r.getLocalName()) {
                        case "t" -> inText = true;
                        case "tc" -> cellDepth++;
                        case "tab", "br", "cr" -> out.append(' ');
                        default -> { }
                    }
                } else if (ev == XMLStreamConstants.END_ELEMENT) {
                    switch (r.getLocalName()) {
                        case "t" -> inText = false;
                        case "tc" -> cellDepth = Math.max(0, cellDepth - 1);
                        case "tr" -> out.append('\n');
                        case "p" -> out.append(cellDepth > 0 ? ' ' : '\n');
                        default -> { }
                    }
                } else if ((ev == XMLStreamConstants.CHARACTERS || ev == XMLStreamConstants.CDATA) && inText) {
                    out.append(r.getText());
                }
            }
            r.close();
        } catch (XMLStreamException bad) {
            throw new TranscriptFormatException("UNSUPPORTED_FILE", "That Word file couldn't be read. It may be damaged.");
        }
        return out.toString();
    }

    private static byte[] readCapped(InputStream in, long cap) throws IOException {
        java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[16 * 1024];
        long total = 0;
        for (int n; (n = in.read(buf)) > 0; ) {
            total += n;
            if (total > cap) throw new TranscriptFormatException("TRANSCRIPT_TOO_LARGE", "That document is too large to read. Split the transcript into parts.");
            bos.write(buf, 0, n);
        }
        return bos.toByteArray();
    }

    // ── PDF ──────────────────────────────────────────────────────────────────

    static final int MAX_PDF_PAGES = 1000;

    /** The text layer of a PDF. Nothing in it is executed, fetched or opened. A scanned PDF has no text layer and is refused with advice. */
    static String pdfText(byte[] data) {
        try (org.apache.pdfbox.pdmodel.PDDocument doc = org.apache.pdfbox.Loader.loadPDF(data)) {
            if (doc.isEncrypted()) throw new TranscriptFormatException("UNSUPPORTED_FILE", "That PDF is password-protected. Remove the password, or paste the text instead.");
            if (doc.getNumberOfPages() > MAX_PDF_PAGES)
                throw new TranscriptFormatException("TRANSCRIPT_TOO_LARGE", "That PDF has more than " + MAX_PDF_PAGES + " pages. Split the transcript into parts.");
            String text = new org.apache.pdfbox.text.PDFTextStripper().getText(doc);
            if (text == null || text.isBlank())
                throw new TranscriptFormatException("UNSUPPORTED_FILE", "That PDF has no readable text (it looks like a scan). Download the transcript as .txt, .vtt, .srt, .json or .docx, or paste the text.");
            return text;
        } catch (TranscriptFormatException e) {
            throw e;
        } catch (IOException | RuntimeException e) {
            throw new TranscriptFormatException("UNSUPPORTED_FILE", "That PDF couldn't be read. It may be damaged or password-protected. Try .docx or .txt, or paste the text.");
        }
    }

    // ── JSON ─────────────────────────────────────────────────────────────────

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String[] TEXT_KEYS = {"text", "sentence", "content", "transcript", "raw_text", "rawText", "message", "body", "utterance"};
    private static final String[] SPEAKER_KEYS = {"speaker_name", "speakerName", "speaker", "name", "participant", "author", "user", "who", "speaker_id", "speakerId"};
    private static final String[] START_KEYS = {"start_time", "startTime", "start", "start_ms", "startMs", "offset", "timestamp", "from", "time"};

    /**
     * A JSON export (Fireflies, Whisper, Otter-style, or a plain list of lines) read as a transcript: finds the list of spoken lines wherever it sits,
     * and writes "[hh:mm:ss] Speaker: text" lines (times and names only when present) for the parser.
     */
    static Content jsonContent(byte[] data) {
        JsonNode root;
        try {
            root = JSON.readTree(decode(data));
        } catch (IOException | RuntimeException e) {
            throw new TranscriptFormatException("UNSUPPORTED_FILE", "That JSON file couldn't be read. It may be damaged or cut off. Try .txt, .vtt, .srt or .docx, or paste the text.");
        }
        JsonNode lines = root == null ? null : findLines(root);
        if (lines != null) {
            String t = linesToText(lines);
            if (t != null) return new Content(t, "TEXT");
        }
        String longest = root == null ? null : longestString(root, 0);
        if (longest != null && longest.length() >= 20) return new Content(longest, "TEXT");
        throw new TranscriptFormatException("UNSUPPORTED_FILE", "No transcript text was found in that JSON file. Download it as .txt, .vtt, .srt or .docx instead, or paste the text.");
    }

    private static String textOf(JsonNode o) {
        for (String k : TEXT_KEYS) { JsonNode v = o.get(k); if (v != null && v.isTextual() && !v.asText().isBlank()) return v.asText(); }
        return null;
    }

    /** Breadth-first: the first array in which most items are objects with a text field. */
    private static JsonNode findLines(JsonNode root) {
        java.util.ArrayDeque<JsonNode> queue = new java.util.ArrayDeque<>();
        java.util.ArrayDeque<Integer> depth = new java.util.ArrayDeque<>();
        queue.add(root); depth.add(0);
        while (!queue.isEmpty()) {
            JsonNode n = queue.poll(); int d = depth.poll();
            if (n.isArray() && n.size() > 0) {
                int withText = 0;
                for (JsonNode e : n) if (e.isObject() && textOf(e) != null) withText++;
                if (withText > 0 && withText * 2 >= n.size()) return n;
            }
            if (d < 6 && n.isContainerNode()) for (JsonNode c : n) { queue.add(c); depth.add(d + 1); }
        }
        return null;
    }

    private static String longestString(JsonNode n, int depth) {
        if (depth > 8) return null;
        if (n.isTextual()) return n.asText();
        String best = null;
        if (n.isContainerNode()) for (JsonNode c : n) {
            String s = longestString(c, depth + 1);
            if (s != null && (best == null || s.length() > best.length())) best = s;
        }
        return best;
    }

    private static String speakerOf(JsonNode o) {
        for (String k : SPEAKER_KEYS) {
            JsonNode v = o.get(k);
            if (v == null || v.isNull()) continue;
            if (v.isTextual() && !v.asText().isBlank()) return v.asText().strip().replace(':', ' ');
            if (v.isNumber()) return "Speaker " + v.asInt();
            if (v.isObject()) for (String nk : new String[]{"name", "displayName", "display_name", "email"}) {
                JsonNode nv = v.get(nk);
                if (nv != null && nv.isTextual() && !nv.asText().isBlank()) return nv.asText().strip().replace(':', ' ');
            }
        }
        return null;
    }

    private static String linesToText(JsonNode arr) {
        java.util.List<String> who = new java.util.ArrayList<>(), text = new java.util.ArrayList<>();
        java.util.List<Double> start = new java.util.ArrayList<>();
        boolean msKey = false;
        for (JsonNode e : arr) {
            if (!e.isObject()) continue;
            String t = textOf(e);
            if (t == null) continue;
            Double st = null;
            for (String k : START_KEYS) {
                JsonNode v = e.get(k);
                if (v != null && v.isNumber()) { st = v.asDouble(); msKey |= k.toLowerCase(Locale.ROOT).endsWith("ms"); break; }
            }
            who.add(speakerOf(e)); text.add(t.replaceAll("\\s+", " ").strip()); start.add(st);
        }
        if (text.isEmpty()) return null;
        double max = start.stream().filter(java.util.Objects::nonNull).mapToDouble(Double::doubleValue).max().orElse(0);
        boolean ms = msKey || max > 36000;                       // plain numbers: seconds, unless too large to be (36000 s = 10 h)
        boolean timed = start.stream().allMatch(java.util.Objects::nonNull);
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < text.size(); i++) {
            if (timed) {
                long sec = Math.max(0, Math.round(ms ? start.get(i) / 1000.0 : start.get(i)));
                out.append(String.format(Locale.ROOT, "[%02d:%02d:%02d] ", sec / 3600, (sec / 60) % 60, sec % 60));
            }
            if (who.get(i) != null) out.append(who.get(i)).append(": ");
            out.append(text.get(i)).append('\n');
        }
        return out.toString();
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    static String extensionOf(String filename) {
        if (filename == null) return "";
        String n = filename.trim();
        int slash = Math.max(n.lastIndexOf('/'), n.lastIndexOf('\\'));
        if (slash >= 0) n = n.substring(slash + 1);
        int dot = n.lastIndexOf('.');
        return dot < 0 || dot == n.length() - 1 ? "" : n.substring(dot + 1).toLowerCase(Locale.ROOT);
    }

    /** The title to give a meeting made from a file: its name without the folder or extension, or null if that leaves nothing useful. */
    public static String titleFromFilename(String filename) {
        if (filename == null) return null;
        String n = filename.trim();
        int slash = Math.max(n.lastIndexOf('/'), n.lastIndexOf('\\'));
        if (slash >= 0) n = n.substring(slash + 1);
        int dot = n.lastIndexOf('.');
        if (dot > 0) n = n.substring(0, dot);
        n = n.replaceAll("[\\p{Cntrl}]", "").replaceAll("[_]+", " ").replaceAll("\\s+", " ").trim();
        if (n.length() > 200) n = n.substring(0, 200).trim();
        return n.isEmpty() ? null : n;
    }

    private static boolean startsWith(byte[] d, int... sig) {
        if (d.length < sig.length) return false;
        for (int i = 0; i < sig.length; i++) if ((d[i] & 0xFF) != sig[i]) return false;
        return true;
    }
}
