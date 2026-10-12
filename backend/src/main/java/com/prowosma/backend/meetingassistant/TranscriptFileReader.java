package com.prowosma.backend.meetingassistant;

import com.prowosma.backend.meetingassistant.TranscriptParser.TranscriptFormatException;

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
 * and XML entities / DTDs are switched off. PDFs, old .doc, .rtf and other formats are refused with a message that says what to do instead.
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

        if (startsWith(data, '%', 'P', 'D', 'F') || ext.equals("pdf"))
            throw new TranscriptFormatException("UNSUPPORTED_FILE", "PDF files can't be read yet. Open it and save or download it as a Word (.docx) or text (.txt) file, or paste the text instead.");
        if (startsWith(data, 0xD0, 0xCF, 0x11, 0xE0) || ext.equals("doc"))
            throw new TranscriptFormatException("UNSUPPORTED_FILE", "Old Word files (.doc) can't be read. Save it as .docx or .txt, or paste the text instead.");
        if (startsWith(data, '{', '\\', 'r', 't', 'f') || ext.equals("rtf"))
            throw new TranscriptFormatException("UNSUPPORTED_FILE", "Rich Text files (.rtf) can't be read. Save it as .docx or .txt, or paste the text instead.");
        if (ext.equals("json") || ext.equals("xls") || ext.equals("xlsx") || ext.equals("csv") || ext.equals("pptx") || ext.equals("odt"))
            throw new TranscriptFormatException("UNSUPPORTED_FILE", "That kind of file can't be read. Use a .txt, .vtt, .srt or .docx transcript, or paste the text instead.");

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
