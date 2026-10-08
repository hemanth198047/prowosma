package com.prowosma.backend.service;

import com.prowosma.backend.config.WorkspaceContext;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.lang.reflect.Proxy;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

/**
 * Lets background work call the application's existing services (which are written for a signed-in web request) as a NAMED actor in
 * exactly ONE workspace. While the action runs: the workspace is bound, the actor is the authenticated principal (so records and the
 * activity log show who created them), and the tenant guard treats it as a normal request — so it still enforces that nothing outside
 * that workspace can be read or written. Everything is restored afterwards, even on failure; nothing leaks to the next job.
 */
@Component
public class MeetingSystemContext {

    private final WorkspaceContext workspaceContext;

    public MeetingSystemContext(WorkspaceContext workspaceContext) { this.workspaceContext = workspaceContext; }

    public <T> T run(String workspaceId, String actor, Supplier<T> action) {
        if (workspaceId == null || workspaceId.isBlank() || actor == null || actor.isBlank())
            throw new IllegalArgumentException("A workspace and an actor are required");
        RequestAttributes previousRequest = RequestContextHolder.getRequestAttributes();
        Authentication previousAuth = SecurityContextHolder.getContext().getAuthentication();
        ServletRequestAttributes attrs = new ServletRequestAttributes(internalRequest());
        try {
            RequestContextHolder.setRequestAttributes(attrs);
            workspaceContext.setWorkspaceId(workspaceId);
            SecurityContextHolder.getContext().setAuthentication(
                    new UsernamePasswordAuthenticationToken(actor, null, List.of(new SimpleGrantedAuthority("ROLE_SYSTEM"))));
            return action.get();
        } finally {
            attrs.requestCompleted();
            RequestContextHolder.setRequestAttributes(previousRequest);
            SecurityContextHolder.getContext().setAuthentication(previousAuth);
        }
    }

    /** A minimal in-memory request: just enough for request-scoped beans and the tenant guard; it carries no headers, body or session. */
    private static jakarta.servlet.http.HttpServletRequest internalRequest() {
        Map<String, Object> attributes = new HashMap<>();
        return (jakarta.servlet.http.HttpServletRequest) Proxy.newProxyInstance(MeetingSystemContext.class.getClassLoader(),
                new Class<?>[]{jakarta.servlet.http.HttpServletRequest.class}, (proxy, method, args) -> {
                    switch (method.getName()) {
                        case "getAttribute": return attributes.get((String) args[0]);
                        case "setAttribute": if (args[1] == null) attributes.remove((String) args[0]); else attributes.put((String) args[0], args[1]); return null;
                        case "removeAttribute": attributes.remove((String) args[0]); return null;
                        case "getAttributeNames": return Collections.enumeration(attributes.keySet());
                        case "getRequestURI": return "/internal/meeting-assistant";
                        case "getContextPath": return "";
                        case "getMethod": return "POST";
                        case "hashCode": return System.identityHashCode(proxy);
                        case "equals": return proxy == args[0];
                        case "toString": return "internal-meeting-assistant-request";
                        default:
                            Class<?> r = method.getReturnType();
                            if (r == boolean.class) return false;
                            if (r == int.class) return 0;
                            if (r == long.class) return 0L;
                            return null;
                    }
                });
    }
}
