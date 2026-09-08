package com.prowosma.backend.security;

import com.prowosma.backend.ProwosmaTestBase;
import com.prowosma.backend.config.RequestIdFilter;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@DisplayName("RequestIdFilter — request correlation for logs")
class RequestIdFilterTest extends ProwosmaTestBase {

    @Test
    @DisplayName("T1: a request with no X-Request-Id header gets one generated and returned")
    void generatesRequestIdWhenNoneProvided() throws Exception {
        mvc.perform(get("/api/health/live"))
           .andExpect(status().isOk())
           .andExpect(header().exists(RequestIdFilter.REQUEST_ID_HEADER));
    }

    @Test
    @DisplayName("T2: a request that already provides X-Request-Id gets the SAME one echoed back, not a new one")
    void echoesBackCallerProvidedRequestId() throws Exception {
        String callerRequestId = "test-correlation-id-12345";

        mvc.perform(get("/api/health/live").header(RequestIdFilter.REQUEST_ID_HEADER, callerRequestId))
           .andExpect(status().isOk())
           .andExpect(header().string(RequestIdFilter.REQUEST_ID_HEADER, callerRequestId));
    }

    @Test
    @DisplayName("T3: two separate requests with no header get two DIFFERENT generated ids, not a cached/reused one")
    void differentRequestsGetDifferentIds() throws Exception {
        var first  = mvc.perform(get("/api/health/live")).andReturn();
        var second = mvc.perform(get("/api/health/live")).andReturn();

        String firstId  = first.getResponse().getHeader(RequestIdFilter.REQUEST_ID_HEADER);
        String secondId = second.getResponse().getHeader(RequestIdFilter.REQUEST_ID_HEADER);

        org.junit.jupiter.api.Assertions.assertNotNull(firstId);
        org.junit.jupiter.api.Assertions.assertNotNull(secondId);
        org.junit.jupiter.api.Assertions.assertNotEquals(firstId, secondId);
    }
}
