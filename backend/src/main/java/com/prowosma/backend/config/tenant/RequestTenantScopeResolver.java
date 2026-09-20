package com.prowosma.backend.config.tenant;

import com.prowosma.backend.config.WorkspaceContext;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.BeanFactory;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * Works out, for the call being made right now, whether the tenant guard applies
 * and for which workspace.
 *
 * It applies only to an <b>authenticated HTTP request to a tenant-scoped
 * {@code /api/**} path</b>. Everything else — schedulers, {@code @Async} work,
 * WebSocket frames, startup migrations, unauthenticated calls, and the
 * login/SSO/invitation/callback paths — gets {@link TenantScope#skip()}, so
 * background and system work keeps operating across workspaces as it does today.
 *
 * The workspace comes from {@link WorkspaceContext}, which {@code WorkspaceFilter}
 * fills only after verifying the caller is a member of the {@code X-Workspace-Id}
 * they asked for (and the API-key filter fills from the key). It is looked up
 * lazily, per call, because the bean is request-scoped.
 */
public class RequestTenantScopeResolver implements TenantScopeResolver {

    private final BeanFactory beanFactory;

    public RequestTenantScopeResolver(BeanFactory beanFactory) {
        this.beanFactory = beanFactory;
    }

    @Override
    public TenantScope current() {
        RequestAttributes attributes = RequestContextHolder.getRequestAttributes();
        boolean inHttpRequest = attributes instanceof ServletRequestAttributes;
        String path = inHttpRequest
                ? pathWithinApplication(((ServletRequestAttributes) attributes).getRequest())
                : null;
        return TenantGuardPolicy.scopeFor(
                inHttpRequest,
                path,
                isAuthenticated(SecurityContextHolder.getContext().getAuthentication()),
                () -> beanFactory.getBean(WorkspaceContext.class).getWorkspaceId());
    }

    private static boolean isAuthenticated(Authentication authentication) {
        return authentication != null
                && authentication.isAuthenticated()
                && !(authentication instanceof AnonymousAuthenticationToken)
                && !"anonymousUser".equals(authentication.getPrincipal());
    }

    private static String pathWithinApplication(HttpServletRequest request) {
        String uri = request.getRequestURI();
        String contextPath = request.getContextPath();
        if (uri != null && contextPath != null && !contextPath.isEmpty() && uri.startsWith(contextPath)) {
            return uri.substring(contextPath.length());
        }
        return uri;
    }
}
