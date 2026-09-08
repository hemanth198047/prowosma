package com.prowosma.backend.service;

import com.prowosma.backend.service.storage.VirusScanner;
import io.micrometer.core.instrument.MeterRegistry;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.*;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;

import java.io.IOException;
import java.nio.file.*;
import java.time.Duration;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * FileStorageService — stores attachment uploads. Provider-agnostic
 * behind FILE_STORAGE_PROVIDER=local (default, unchanged behavior from
 * before) or FILE_STORAGE_PROVIDER=s3 (Amazon S3, or any S3-compatible
 * service — MinIO, Cloudflare R2, Backblaze B2, DigitalOcean Spaces, by
 * also setting FILE_STORAGE_S3_ENDPOINT). Switching is a config change
 * only — TaskService/GoalService callers are unaffected either way, since
 * store()/delete() keep the exact same signatures regardless of backend.
 *
 * Every upload is optionally scanned via VirusScanner before being stored
 * (VIRUS_SCAN_PROVIDER=clamav to turn on) — previously there was no
 * scanning of any kind, on either backend.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class FileStorageService {

    private final VirusScanner virusScanner;
    private final MeterRegistry meterRegistry;

    @Value("${file.upload.dir}")
    private String uploadDir;

    @Value("${file.storage.provider:local}")
    private String provider; // local | s3

    @Value("${file.storage.s3.bucket:}")
    private String s3Bucket;

    @Value("${file.storage.s3.region:us-east-1}")
    private String s3Region;

    /** Blank = real AWS S3. Set for S3-compatible services (MinIO, R2, B2, Spaces). */
    @Value("${file.storage.s3.endpoint:}")
    private String s3Endpoint;

    @Value("${file.storage.s3.key-prefix:attachments/}")
    private String s3KeyPrefix;

    /** If true, a scanner error (e.g. clamd unreachable) BLOCKS the upload rather than just warning. */
    @Value("${virus-scan.fail-closed:false}")
    private boolean scanFailClosed;

    // Small, explicit denylist as a second layer under virus scanning — an
    // uploaded .exe/.bat/etc has no legitimate reason to be a task
    // attachment in this app and is a common initial-access vector even
    // when it happens to be malware-free.
    private static final Set<String> BLOCKED_EXTENSIONS = Set.of(
        ".exe", ".bat", ".cmd", ".sh", ".ps1", ".msi", ".scr", ".jar", ".com", ".vbs"
    );

    private S3Client s3ClientInstance;
    private S3Presigner s3PresignerInstance;

    private synchronized S3Client s3Client() {
        if (s3ClientInstance == null) {
            var builder = S3Client.builder().region(Region.of(s3Region));
            if (s3Endpoint != null && !s3Endpoint.isBlank()) {
                // Required for most S3-compatible services (MinIO, etc.), which
                // expect path-style requests (http://host/bucket/key) rather
                // than AWS's own default virtual-hosted style (http://bucket.host/key).
                builder = builder.endpointOverride(java.net.URI.create(s3Endpoint))
                    .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true).build());
            }
            s3ClientInstance = builder.build();
        }
        return s3ClientInstance;
    }

    private synchronized S3Presigner s3Presigner() {
        if (s3PresignerInstance == null) {
            var builder = S3Presigner.builder().region(Region.of(s3Region));
            if (s3Endpoint != null && !s3Endpoint.isBlank()) {
                builder = builder.endpointOverride(java.net.URI.create(s3Endpoint));
            }
            s3PresignerInstance = builder.build();
        }
        return s3PresignerInstance;
    }

    public String store(MultipartFile file) throws IOException {
        String original = file.getOriginalFilename();
        String ext = "";
        if (original != null && original.contains(".")) {
            ext = original.substring(original.lastIndexOf(".")).toLowerCase();
        }
        if (BLOCKED_EXTENSIONS.contains(ext)) {
            meterRegistry.counter("file.upload.blocked", "reason", "extension").increment();
            throw new IOException("File type '" + ext + "' is not allowed as an attachment.");
        }

        // Scan BEFORE storing anywhere — a fresh InputStream each time
        // (MultipartFile supports being read more than once; the scan
        // stream is independent of the one used to actually store below).
        try (var scanStream = file.getInputStream()) {
            if (!virusScanner.isClean(scanStream, file.getSize())) {
                meterRegistry.counter("file.upload.blocked", "reason", "virus").increment();
                throw new IOException("This file was rejected by malware scanning and was not stored.");
            }
        } catch (IOException e) {
            throw e;
        } catch (Exception scannerError) {
            meterRegistry.counter("file.upload.scan-error").increment();
            log.warn("Virus scan ({}) failed, not a detection — scanner error: {}",
                virusScanner.name(), scannerError.getMessage());
            if (scanFailClosed) {
                throw new IOException("Malware scanning is unavailable and VIRUS_SCAN_FAIL_CLOSED=true — " +
                    "upload rejected rather than stored unscanned.");
            }
            // fail-open (default): scanner being down shouldn't block every upload in the app
        }

        String fileName = UUID.randomUUID() + ext;

        if ("s3".equalsIgnoreCase(provider)) {
            PutObjectRequest req = PutObjectRequest.builder()
                .bucket(s3Bucket)
                .key(s3KeyPrefix + fileName)
                .contentType(file.getContentType())
                .serverSideEncryption(ServerSideEncryption.AES256) // encryption at rest, on by default
                .build();
            s3Client().putObject(req, RequestBody.fromInputStream(file.getInputStream(), file.getSize()));
            meterRegistry.counter("file.upload.success", "backend", "s3").increment();
        } else {
            Path uploadPath = Paths.get(uploadDir);
            if (!Files.exists(uploadPath)) Files.createDirectories(uploadPath);
            Path filePath = uploadPath.resolve(fileName);
            Files.copy(file.getInputStream(), filePath, StandardCopyOption.REPLACE_EXISTING);
            meterRegistry.counter("file.upload.success", "backend", "local").increment();
        }
        return fileName;
    }

    public void delete(String fileName) throws IOException {
        if ("s3".equalsIgnoreCase(provider)) {
            s3Client().deleteObject(DeleteObjectRequest.builder()
                .bucket(s3Bucket).key(s3KeyPrefix + fileName).build());
        } else {
            Files.deleteIfExists(Paths.get(uploadDir).resolve(fileName));
        }
    }

    /** LOCAL provider only — used by TaskController for the existing FileSystemResource download path. */
    public Optional<Path> localPath(String fileName) {
        if ("s3".equalsIgnoreCase(provider)) return Optional.empty();
        return Optional.of(Paths.get(uploadDir).resolve(fileName));
    }

    /**
     * S3 provider only — a short-lived, signed URL the browser can be
     * redirected to directly, rather than proxying the file's bytes
     * through this app's own server (which doesn't scale as well and
     * adds pointless latency for large attachments).
     */
    public Optional<String> presignedDownloadUrl(String fileName, Duration ttl) {
        if (!"s3".equalsIgnoreCase(provider)) return Optional.empty();
        GetObjectRequest getReq = GetObjectRequest.builder()
            .bucket(s3Bucket).key(s3KeyPrefix + fileName).build();
        GetObjectPresignRequest presignReq = GetObjectPresignRequest.builder()
            .signatureDuration(ttl)
            .getObjectRequest(getReq)
            .build();
        String url = s3Presigner().presignGetObject(presignReq).url().toString();
        return Optional.of(url);
    }

    /** Legacy signature kept for any other caller expecting a Path — only valid for the local provider. */
    @Deprecated
    public Path load(String fileName) {
        return localPath(fileName).orElseThrow(() ->
            new IllegalStateException("load(fileName) returns a local Path only — file.storage.provider=s3 " +
                "is active, use presignedDownloadUrl() instead (see TaskController.getAttachment)."));
    }
}
