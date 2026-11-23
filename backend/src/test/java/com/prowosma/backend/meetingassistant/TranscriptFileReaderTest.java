package com.prowosma.backend.meetingassistant;

import com.prowosma.backend.meetingassistant.TranscriptParser.TranscriptFormatException;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.*;

class TranscriptFileReaderTest {

    private static byte[] b(String s) { return s.getBytes(StandardCharsets.UTF_8); }

    @Test
    void firefliesJsonBecomesTimedSpeakerLines() {
        String json = "{\"data\":{\"transcript\":{\"title\":\"Standup\",\"sentences\":["
                + "{\"speaker_name\":\"Asha\",\"text\":\"Let us start.\",\"start_time\":1.5,\"end_time\":3},"
                + "{\"speaker_name\":\"Ben\",\"text\":\"I fixed the login bug.\",\"start_time\":65,\"end_time\":70},"
                + "{\"speaker_name\":\"Asha\",\"text\":\"Great, thanks.\",\"start_time\":3700,\"end_time\":3702}]}}}";
        TranscriptFileReader.Content c = TranscriptFileReader.read(b(json), "standup.json");
        assertEquals("TEXT", c.formatHint());
        assertTrue(c.text().contains("[00:00:02] Asha: Let us start."), c.text());
        assertTrue(c.text().contains("[00:01:05] Ben: I fixed the login bug."), c.text());
        assertTrue(c.text().contains("[01:01:40] Asha: Great, thanks."), c.text());
        assertFalse(TranscriptParser.parse(c.text(), c.formatHint()).segments().isEmpty());
    }

    @Test
    void whisperStyleMillisecondsAndUntimedLists() {
        String ms = "{\"segments\":[{\"text\":\"Hello everyone\",\"start_ms\":0},{\"text\":\"Next topic\",\"start_ms\":125000}]}";
        String t = TranscriptFileReader.read(b(ms), "w.json").text();
        assertTrue(t.contains("[00:02:05] Next topic"), t);
        String plain = "[{\"speaker\":\"Asha\",\"text\":\"One\"},{\"speaker\":\"Asha\",\"text\":\"Two\"}]";
        assertEquals("Asha: One\nAsha: Two\n", TranscriptFileReader.read(b(plain), "p.json").text());
    }

    @Test
    void jsonWithoutTranscriptTextOrBrokenJsonIsRefusedClearly() {
        assertEquals("UNSUPPORTED_FILE", assertThrows(TranscriptFormatException.class,
                () -> TranscriptFileReader.read(b("{\"a\":1,\"b\":[1,2]}"), "x.json")).getCode());
        assertEquals("UNSUPPORTED_FILE", assertThrows(TranscriptFormatException.class,
                () -> TranscriptFileReader.read(b("{\"a\":"), "x.json")).getCode());
    }

    @Test
    void pdfTextLayerIsRead() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (org.apache.pdfbox.pdmodel.PDDocument doc = new org.apache.pdfbox.pdmodel.PDDocument()) {
            org.apache.pdfbox.pdmodel.PDPage page = new org.apache.pdfbox.pdmodel.PDPage();
            doc.addPage(page);
            try (org.apache.pdfbox.pdmodel.PDPageContentStream cs = new org.apache.pdfbox.pdmodel.PDPageContentStream(doc, page)) {
                cs.beginText();
                cs.setFont(new org.apache.pdfbox.pdmodel.font.PDType1Font(org.apache.pdfbox.pdmodel.font.Standard14Fonts.FontName.HELVETICA), 12);
                cs.newLineAtOffset(50, 700);
                cs.showText("Asha: We agreed to ship on Friday.");
                cs.endText();
            }
            doc.save(out);
        }
        String t = TranscriptFileReader.read(out.toByteArray(), "notes.pdf").text();
        assertTrue(t.contains("We agreed to ship on Friday."), t);
    }

    @Test
    void textlessOrFakePdfIsRefused() throws Exception {
        assertEquals("UNSUPPORTED_FILE", assertThrows(TranscriptFormatException.class,
                () -> TranscriptFileReader.read(b("not a pdf"), "x.pdf")).getCode());
        assertEquals("UNSUPPORTED_FILE", assertThrows(TranscriptFormatException.class,
                () -> TranscriptFileReader.read(b("%PDF-1.4 garbage"), "x.pdf")).getCode());
    }
}
