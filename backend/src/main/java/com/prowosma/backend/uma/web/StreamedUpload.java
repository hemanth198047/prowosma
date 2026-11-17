package com.prowosma.backend.uma.web;

import com.prowosma.backend.uma.core.UmaException;
import org.springframework.http.HttpStatus;
import org.springframework.web.multipart.MultipartFile;

import java.io.*;
import java.nio.file.*;

/**
 * A recording sent as the raw request body, streamed to a temporary file with a hard size cap, so a 500 MB upload never sits in memory
 * and the app-wide multipart limit stays as it is. Exposed as a MultipartFile so FileStorageService (virus scan, S3/local) is reused unchanged.
 */
final class StreamedUpload implements MultipartFile, Closeable {
    private final Path path;
    private final String name;
    private final String contentType;
    private final long size;

    private StreamedUpload(Path path, String name, String contentType, long size) {
        this.path = path; this.name = name; this.contentType = contentType; this.size = size;
    }

    static StreamedUpload read(InputStream in, String fileName, String contentType, long maxBytes) throws IOException {
        Path tmp = Files.createTempFile("uma-upload-", ".part");
        long total = 0;
        try (OutputStream out = Files.newOutputStream(tmp)) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) {
                total += n;
                if (total > maxBytes) throw new UmaException(HttpStatus.CONTENT_TOO_LARGE, "FILE_TOO_LARGE",
                        "That recording is larger than " + (maxBytes / 1024 / 1024) + " MB.", "Split it into parts, or export only the audio.");
                out.write(buf, 0, n);
            }
        } catch (IOException | RuntimeException e) {
            Files.deleteIfExists(tmp);
            throw e;
        }
        String safe = fileName == null || fileName.isBlank() ? "recording" : Paths.get(fileName.replace('\\', '/')).getFileName().toString();
        return new StreamedUpload(tmp, safe, contentType, total);
    }

    @Override public String getName() { return "file"; }
    @Override public String getOriginalFilename() { return name; }
    @Override public String getContentType() { return contentType; }
    @Override public boolean isEmpty() { return size == 0; }
    @Override public long getSize() { return size; }
    @Override public byte[] getBytes() throws IOException { return Files.readAllBytes(path); }
    @Override public InputStream getInputStream() throws IOException { return Files.newInputStream(path); }
    @Override public void transferTo(File dest) throws IOException { Files.copy(path, dest.toPath(), StandardCopyOption.REPLACE_EXISTING); }
    @Override public void close() throws IOException { Files.deleteIfExists(path); }
}
