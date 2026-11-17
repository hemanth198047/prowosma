package com.prowosma.backend.uma.core;

import org.springframework.web.multipart.MultipartFile;

import java.io.*;
import java.nio.file.Files;

/** A small in-memory file (one recorded piece, a few MB at most) handed to FileStorageService, which takes a MultipartFile. */
public final class BytesUpload implements MultipartFile {
    private final byte[] bytes;
    private final String name;
    private final String contentType;

    public BytesUpload(byte[] bytes, String name, String contentType) { this.bytes = bytes; this.name = name; this.contentType = contentType; }

    @Override public String getName() { return "file"; }
    @Override public String getOriginalFilename() { return name; }
    @Override public String getContentType() { return contentType; }
    @Override public boolean isEmpty() { return bytes.length == 0; }
    @Override public long getSize() { return bytes.length; }
    @Override public byte[] getBytes() { return bytes; }
    @Override public InputStream getInputStream() { return new ByteArrayInputStream(bytes); }
    @Override public void transferTo(File dest) throws IOException { Files.write(dest.toPath(), bytes); }
}
