package com.prowosma.backend.service.storage;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.InputStream;
import java.net.Socket;
import java.nio.charset.StandardCharsets;

/**
 * Scans uploaded content against a clamd (ClamAV daemon) instance using
 * clamd's own INSTREAM protocol directly over a TCP socket — no client
 * library dependency needed, since the protocol itself is simple and has
 * been stable for well over a decade:
 *
 *   1. Send "zINSTREAM\0"
 *   2. Send the content in chunks, each prefixed by its length as a
 *      4-byte big-endian integer
 *   3. Send a zero-length chunk (four 0x00 bytes) to signal end-of-stream
 *   4. Read the response — "stream: OK" (clean) or "stream: <name> FOUND" (infected)
 *
 * Enable with CLAMAV_ENABLED=true + CLAMAV_HOST/CLAMAV_PORT pointing at a
 * running clamd (e.g. the official clamav/clamav docker image). See
 * docs/FILE_STORAGE_SETUP.md for a docker-compose snippet.
 */
@Slf4j
@Component
@ConditionalOnProperty(name = "virus-scan.provider", havingValue = "clamav")
public class ClamAvVirusScanner implements VirusScanner {

    @Value("${virus-scan.clamav.host:localhost}")
    private String host;

    @Value("${virus-scan.clamav.port:3310}")
    private int port;

    @Value("${virus-scan.clamav.timeout-ms:15000}")
    private int timeoutMs;

    private static final int CHUNK_SIZE = 8192;

    @Override
    public boolean isClean(InputStream content, long contentLength) throws Exception {
        try (Socket socket = new Socket()) {
            socket.connect(new java.net.InetSocketAddress(host, port), timeoutMs);
            socket.setSoTimeout(timeoutMs);

            DataOutputStream out = new DataOutputStream(socket.getOutputStream());
            out.writeBytes("zINSTREAM\0");

            byte[] buffer = new byte[CHUNK_SIZE];
            int read;
            while ((read = content.read(buffer)) != -1) {
                out.writeInt(read); // 4-byte big-endian length prefix, per clamd's protocol
                out.write(buffer, 0, read);
            }
            out.writeInt(0); // zero-length chunk = end of stream
            out.flush();

            ByteArrayOutputStream responseBuf = new ByteArrayOutputStream();
            InputStream in = socket.getInputStream();
            int b;
            while ((b = in.read()) != -1) responseBuf.write(b);
            String response = responseBuf.toString(StandardCharsets.US_ASCII).trim();

            log.debug("[ClamAvVirusScanner] clamd response: {}", response);
            if (response.contains("FOUND")) {
                log.warn("[ClamAvVirusScanner] Malware signature match: {}", response);
                return false;
            }
            return response.contains("OK");
        }
    }

    @Override
    public String name() {
        return "clamav";
    }
}
