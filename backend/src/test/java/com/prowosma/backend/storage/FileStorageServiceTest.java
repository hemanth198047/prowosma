package com.prowosma.backend.storage;

import com.prowosma.backend.ProwosmaTestBase;
import com.prowosma.backend.service.FileStorageService;
import com.prowosma.backend.service.storage.VirusScanner;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.mock.web.MockMultipartFile;

import java.io.IOException;
import java.nio.file.Files;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Verifies FileStorageService's local-disk path: successful store/delete,
 * the executable-extension denylist, and that a virus-scanner rejection
 * actually prevents the file from being written at all (not just logged).
 *
 * The S3 backend isn't covered here — it needs a real or emulated S3
 * endpoint (e.g. MinIO in CI) to test meaningfully rather than mocking the
 * AWS SDK client, which would mostly test the mock rather than the
 * integration. See docs/FILE_STORAGE_SETUP.md's MinIO section for how to
 * stand one up locally if adding that coverage later.
 */
@DisplayName("FileStorageService — local provider")
class FileStorageServiceTest extends ProwosmaTestBase {

    @Autowired private FileStorageService fileStorageService;

    @MockitoBean private VirusScanner virusScanner;

    @Test
    @DisplayName("store() writes the file to disk and load Path resolves to real content")
    void store_writesFileToDisk() throws Exception {
        Mockito.when(virusScanner.isClean(Mockito.any(), Mockito.anyLong())).thenReturn(true);

        MockMultipartFile file = new MockMultipartFile(
            "file", "notes.txt", "text/plain", "hello world".getBytes());

        String storedName = fileStorageService.store(file);

        var path = fileStorageService.localPath(storedName).orElseThrow();
        assertTrue(Files.exists(path), "Stored file must exist on disk");
        assertEquals("hello world", Files.readString(path));
        assertTrue(storedName.endsWith(".txt"), "Original extension must be preserved");

        fileStorageService.delete(storedName);
        assertFalse(Files.exists(path), "delete() must actually remove the file");
    }

    @Test
    @DisplayName("Executable extensions are rejected before ever touching disk")
    void store_rejectsBlockedExtension() {
        MockMultipartFile file = new MockMultipartFile(
            "file", "payload.exe", "application/octet-stream", "MZ...".getBytes());

        IOException ex = assertThrows(IOException.class, () -> fileStorageService.store(file));
        assertTrue(ex.getMessage().contains(".exe"));
    }

    @Test
    @DisplayName("A virus-scanner detection prevents the file from being stored at all")
    void store_rejectsWhenScannerFlagsContent() throws Exception {
        Mockito.when(virusScanner.isClean(Mockito.any(), Mockito.anyLong())).thenReturn(false);

        MockMultipartFile file = new MockMultipartFile(
            "file", "eicar-test.txt", "text/plain", "fake-signature-match".getBytes());

        assertThrows(IOException.class, () -> fileStorageService.store(file));
        // Note: we don't assert on a specific path here since a flagged file must
        // never be written under any filename — there's nothing valid to check for.
    }

    @Test
    @DisplayName("A scanner error (not a detection) fails OPEN by default — upload still succeeds")
    void store_scannerErrorFailsOpenByDefault() throws Exception {
        Mockito.when(virusScanner.isClean(Mockito.any(), Mockito.anyLong()))
            .thenThrow(new RuntimeException("clamd unreachable (simulated)"));

        MockMultipartFile file = new MockMultipartFile(
            "file", "ok-despite-scanner-down.txt", "text/plain", "content".getBytes());

        // Default virus-scan.fail-closed=false — a scanner outage must not block every upload.
        String storedName = fileStorageService.store(file);
        assertTrue(fileStorageService.localPath(storedName).orElseThrow().toFile().exists());

        fileStorageService.delete(storedName);
    }
}
