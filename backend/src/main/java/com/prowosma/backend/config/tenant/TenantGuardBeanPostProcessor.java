package com.prowosma.backend.config.tenant;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.BeansException;
import org.springframework.beans.factory.BeanFactory;
import org.springframework.beans.factory.BeanFactoryAware;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.context.EnvironmentAware;
import org.springframework.core.GenericTypeResolver;
import org.springframework.core.env.Environment;
import org.springframework.data.repository.Repository;
import org.springframework.stereotype.Component;
import org.springframework.util.ClassUtils;

import java.lang.reflect.Proxy;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Wraps every Spring Data repository of a workspace-owned entity in a
 * {@link TenantGuardHandler}, so by-id access is tenant-safe everywhere
 * (see that class for the rules and the reason).
 *
 * It has no injected dependencies on purpose: a post-processor with
 * dependencies forces them to be created too early to be post-processed
 * themselves. It finds what it needs lazily instead.
 *
 * Switch with {@code app.tenant-guard.mode} = {@code enforce} (default) |
 * {@code log} | {@code off}.
 */
@Component
public class TenantGuardBeanPostProcessor implements BeanPostProcessor, BeanFactoryAware, EnvironmentAware {

    private static final Logger log = LoggerFactory.getLogger(TenantGuardBeanPostProcessor.class);

    private final AtomicInteger guarded = new AtomicInteger();
    private TenantScopeResolver resolver;
    private TenantGuardMode mode = TenantGuardMode.ENFORCE;

    @Override
    public void setBeanFactory(BeanFactory beanFactory) throws BeansException {
        this.resolver = new RequestTenantScopeResolver(beanFactory);
    }

    @Override
    public void setEnvironment(Environment environment) {
        String configured = environment.getProperty("app.tenant-guard.mode");
        this.mode = TenantGuardMode.parse(configured);
        if (mode == TenantGuardMode.OFF) {
            log.warn("[TenantGuard] DISABLED (app.tenant-guard.mode={}). Cross-workspace by-id access is NOT prevented.", configured);
        } else if (mode == TenantGuardMode.LOG) {
            log.warn("[TenantGuard] LOG-ONLY mode: cross-workspace access is reported but NOT blocked.");
        }
    }

    @Override
    public Object postProcessAfterInitialization(Object bean, String beanName) throws BeansException {
        if (mode == TenantGuardMode.OFF || !(bean instanceof Repository)) {
            return bean;
        }
        Class<?> entityType = entityTypeOf(bean);
        TenantGuardHandler handler = TenantGuardHandler.create(
                bean, entityType, resolver, mode, message -> log.warn("{}", message));
        if (handler == null) {
            return bean;                                     // exempt / not workspace-owned: nothing to guard
        }
        try {
            Object proxy = Proxy.newProxyInstance(
                    bean.getClass().getClassLoader(), ClassUtils.getAllInterfaces(bean), handler);
            guarded.incrementAndGet();
            log.info("[TenantGuard] {} guarding {} ({} repositories so far)",
                    mode, entityType.getSimpleName(), guarded.get());
            return proxy;
        } catch (RuntimeException e) {
            // Never break startup over this, but never fail silently either.
            log.error("[TenantGuard] COULD NOT guard repository bean '{}' ({}): its by-id access is UNPROTECTED",
                    beanName, entityType.getSimpleName(), e);
            return bean;
        }
    }

    /** The entity type of a Spring Data repository, e.g. Task for TaskRepository extends MongoRepository&lt;Task, String&gt;. */
    private static Class<?> entityTypeOf(Object repository) {
        for (Class<?> type : ClassUtils.getAllInterfaces(repository)) {
            Class<?>[] arguments = GenericTypeResolver.resolveTypeArguments(type, Repository.class);
            if (arguments != null && arguments.length > 0 && arguments[0] != null) {
                return arguments[0];
            }
        }
        return null;
    }
}
