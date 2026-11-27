package com.prowosma.backend.controller;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class ClientErrorControllerTest {
    SimpleMeterRegistry meters = new SimpleMeterRegistry();
    ClientErrorController controller = new ClientErrorController(meters);

    @Test
    void aReportIsAcceptedWithoutLoginAndCounted() {
        var res = controller.report(Map.of("message", "x.map is not a function", "page", "/meetings", "source", "page", "version", "abc-1"), null);
        assertThat(res.getStatusCode().value()).isEqualTo(204);
        assertThat(meters.counter("client.errors", "source", "page").count()).isEqualTo(1.0);
    }

    @Test
    void anEmptyBodyIsIgnoredNotAnError() {
        assertThat(controller.report(null, null).getStatusCode().value()).isEqualTo(204);
    }

    @Test
    void textFromTheBrowserCannotForgeLogLinesOrGrowWithoutLimit() {
        assertThat(ClientErrorController.clean("bad\n2026-11-27 INFO fake line\r\t\"quoted\"", 200)).doesNotContain("\n").doesNotContain("\r").doesNotContain("\"");
        assertThat(ClientErrorController.clean("x".repeat(1000), 50)).hasSize(53).endsWith("...");
        assertThat(ClientErrorController.clean(null, 10)).isEmpty();
    }

    @Test
    void noMoreThanTheLimitIsWrittenPerMinute() {
        long minute = 1000;
        int accepted = 0;
        for (int i = 0; i < ClientErrorController.MAX_PER_MINUTE + 50; i++) if (controller.allowed(minute)) accepted++;
        assertThat(accepted).isEqualTo(ClientErrorController.MAX_PER_MINUTE);
        assertThat(controller.allowed(minute + 1)).isTrue();
    }
}
