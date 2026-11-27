package com.prowosma.backend.e2e;

import com.prowosma.backend.ProwosmaTestBase;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestPropertySource;

import java.nio.file.Files;
import java.nio.file.Path;

/**
 * NOT a test: it starts the real application on port 9090 with the usual seeded users (owner@test.com, admin@test.com, member@test.com, all
 * with password "pass") and keeps it running until the file named by E2E_STOP_FILE appears. A browser test (Playwright) drives the real UI
 * against it. Does nothing unless E2E_SERVER=true, so normal test runs are unaffected.
 */
@EnabledIfEnvironmentVariable(named = "E2E_SERVER", matches = "true")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.DEFINED_PORT)
@TestPropertySource(properties = {"server.port=9090", "app.uma.jobs-enabled=false", "app.meeting-assistant.jobs-enabled=false", "app.rate-limit.requests-per-minute=100000"})
class BrowserE2EServer extends ProwosmaTestBase {

    @Test
    void serveUntilToldToStop() throws Exception {
        Path stop = Path.of(System.getenv().getOrDefault("E2E_STOP_FILE", "/tmp/e2e.stop"));
        Files.deleteIfExists(stop);
        Files.writeString(Path.of("/tmp/e2e.ready"), "ready");
        long until = System.currentTimeMillis() + 50 * 60_000L;
        while (!Files.exists(stop) && System.currentTimeMillis() < until) Thread.sleep(500);
    }
}
