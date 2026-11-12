package com.prowosma.backend.config;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

class GlobalExceptionHandlerNotFoundTest {

    @Test
    void unknownPathIsReportedAs404NotServerError() {
        ResponseEntity<Map<String, Object>> res = new GlobalExceptionHandler()
            .handleNoResource(new NoResourceFoundException(HttpMethod.GET, "/swagger-ui.html", "swagger-ui.html"));

        assertEquals(404, res.getStatusCode().value());
        assertEquals("NOT_FOUND", res.getBody().get("error"));
    }
}
