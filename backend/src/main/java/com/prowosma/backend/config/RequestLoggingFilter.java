package com.prowosma.backend.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.util.ContentCachingRequestWrapper;
import org.springframework.web.util.ContentCachingResponseWrapper;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.Collections;
import java.util.stream.Collectors;

@Component
@Order(1) // Run first — before JWT and Workspace filters
public class RequestLoggingFilter extends OncePerRequestFilter {

    private static final String RESET  = "\u001B[0m";
    private static final String BOLD   = "\u001B[1m";
    private static final String GREEN  = "\u001B[32m";
    private static final String YELLOW = "\u001B[33m";
    private static final String CYAN   = "\u001B[36m";
    private static final String RED    = "\u001B[31m";
    private static final String PURPLE = "\u001B[35m";
    private static final String GRAY   = "\u001B[90m";
    private static final String WHITE  = "\u001B[97m";

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain)
            throws ServletException, IOException {

        // Skip static assets and actuator noise
        String uri = request.getRequestURI();
        if (uri.contains("/actuator") || uri.contains(".js") || uri.contains(".css")) {
            filterChain.doFilter(request, response);
            return;
        }

        // Wrap request and response to allow body reading
        ContentCachingRequestWrapper wrappedRequest = new ContentCachingRequestWrapper(request, 10240);
        ContentCachingResponseWrapper wrappedResponse = new ContentCachingResponseWrapper(response);

        long startTime = System.currentTimeMillis();

        // ── Print incoming request ──────────────────────────
        printRequest(wrappedRequest);

        // ── Execute the actual handler ──────────────────────
        filterChain.doFilter(wrappedRequest, wrappedResponse);

        long duration = System.currentTimeMillis() - startTime;

        // ── Print outgoing response ─────────────────────────
        printResponse(wrappedResponse, duration);

        // IMPORTANT: copy body back so the real response is sent to client
        wrappedResponse.copyBodyToResponse();
    }

    private void printRequest(ContentCachingRequestWrapper request) {
        String time = LocalTime.now().format(DateTimeFormatter.ofPattern("HH:mm:ss.SSS"));
        String method = request.getMethod();
        String uri = request.getRequestURI();
        String query = request.getQueryString() != null ? "?" + request.getQueryString() : "";
        String methodColor = methodColor(method);

        System.out.println();
        System.out.println(BOLD + CYAN + "┌─────────────────────────────────────────────────────" + RESET);
        System.out.println(BOLD + CYAN + "│ ◀ INCOMING REQUEST" + RESET
                + GRAY + "  [" + time + "]" + RESET);
        System.out.println(CYAN + "├─────────────────────────────────────────────────────" + RESET);
        System.out.printf(CYAN + "│" + RESET + " %s%-6s%s %s%s%s%n",
                methodColor + BOLD, method, RESET,
                WHITE, uri + query, RESET);

        // Headers
        System.out.println(CYAN + "│" + RESET + GRAY + " Headers:" + RESET);
        Collections.list(request.getHeaderNames()).forEach(headerName -> {
            String value = request.getHeader(headerName);
            // Mask Authorization token
            if (headerName.equalsIgnoreCase("authorization")) {
                value = value.substring(0, Math.min(value.length(), 20)) + "...[masked]";
            }
            System.out.printf(CYAN + "│" + RESET + "   %s%-25s%s %s%s%n",
                    YELLOW, headerName + ":", RESET, GRAY, value + RESET);
        });

        // Params
        if (request.getQueryString() != null) {
            System.out.println(CYAN + "│" + RESET + GRAY + " Query Params:" + RESET);
            request.getParameterMap().forEach((k, v) ->
                    System.out.printf(CYAN + "│" + RESET + "   %s%-20s%s %s%s%n",
                            YELLOW, k + ":", RESET, WHITE, String.join(", ", v) + RESET));
        }

        System.out.println(CYAN + "└─────────────────────────────────────────────────────" + RESET);
    }

    private void printResponse(ContentCachingResponseWrapper response, long duration) {
        int status = response.getStatus();
        String statusColor = status < 300 ? GREEN : status < 400 ? YELLOW : RED;
        String time = LocalTime.now().format(DateTimeFormatter.ofPattern("HH:mm:ss.SSS"));

        System.out.println();
        System.out.println(BOLD + PURPLE + "┌─────────────────────────────────────────────────────" + RESET);
        System.out.println(BOLD + PURPLE + "│ ▶ OUTGOING RESPONSE" + RESET
                + GRAY + "  [" + time + "]  (" + duration + "ms)" + RESET);
        System.out.println(PURPLE + "├─────────────────────────────────────────────────────" + RESET);
        System.out.printf(PURPLE + "│" + RESET + " Status: %s%s%d%s%n",
                BOLD, statusColor, status, RESET);

        // Response body (trimmed if large)
        byte[] bodyBytes = response.getContentAsByteArray();
        if (bodyBytes.length > 0) {
            String body = new String(bodyBytes, StandardCharsets.UTF_8);
            if (body.length() > 1000) {
                body = body.substring(0, 1000) + "\n  ... [truncated, total " + body.length() + " chars]";
            }
            System.out.println(PURPLE + "│" + RESET + GRAY + " Body:" + RESET);
            // Print each line with indent
            for (String line : body.split("\n")) {
                System.out.println(PURPLE + "│" + RESET + "   " + WHITE + line + RESET);
            }
        } else {
            System.out.println(PURPLE + "│" + RESET + GRAY + " Body: (empty)" + RESET);
        }

        System.out.println(PURPLE + "└─────────────────────────────────────────────────────" + RESET);
        System.out.println();
    }

    private String methodColor(String method) {
        return switch (method) {
            case "GET"    -> GREEN;
            case "POST"   -> YELLOW;
            case "PUT"    -> CYAN;
            case "DELETE" -> RED;
            case "PATCH"  -> PURPLE;
            default       -> WHITE;
        };
    }
}