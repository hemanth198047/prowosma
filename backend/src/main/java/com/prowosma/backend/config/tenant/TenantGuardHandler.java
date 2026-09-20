package com.prowosma.backend.config.tenant;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.function.Consumer;

/**
 * Wraps one Spring Data repository and makes by-id access tenant-safe.
 *
 * <h3>Why this exists</h3>
 * Dozens of services do {@code repository.findById(id)} and then act on the
 * result without checking that the record belongs to the caller's workspace, so
 * anyone who could guess or learn an id could read, edit or delete another
 * workspace's data. Fixing each call site by hand is error-prone and the next
 * new endpoint would reintroduce the hole, so the check lives here, once, on
 * the repository itself.
 *
 * <h3>Rules (only while {@link TenantScope#isEnforced()})</h3>
 * <ul>
 *   <li>{@code findById}, {@code existsById}, {@code findAllById}: a record that
 *       belongs to another workspace is reported as absent.</li>
 *   <li>{@code deleteById}, {@code deleteAllById}, {@code delete}: another
 *       workspace's record is left untouched, exactly like deleting an id that
 *       does not exist.</li>
 *   <li>{@code save}, {@code saveAll}: refuse to <em>overwrite</em> a stored record
 *       that belongs to another workspace (an upsert with someone else's id).
 *       Brand-new records (no id, or an id not stored yet) are never blocked.</li>
 * </ul>
 * Everything else (derived queries such as {@code findByOrganizationId}) passes
 * straight through: callers already scope those by workspace.
 *
 * Outside an enforced request (schedulers, async work, tests' own setup) every
 * call passes straight through untouched.
 */
public final class TenantGuardHandler implements InvocationHandler {

    private final Object target;
    private final String entity;
    private final Method tenantGetter;
    private final Method idGetter;          // may be null
    private final Method findById;
    private final Method findAllById;       // may be null
    private final TenantScopeResolver resolver;
    private final TenantGuardMode mode;
    private final Consumer<String> report;

    private TenantGuardHandler(Object target, String entity, Method tenantGetter, Method idGetter,
                               Method findById, Method findAllById,
                               TenantScopeResolver resolver, TenantGuardMode mode, Consumer<String> report) {
        this.target = target;
        this.entity = entity;
        this.tenantGetter = tenantGetter;
        this.idGetter = idGetter;
        this.findById = findById;
        this.findAllById = findAllById;
        this.resolver = resolver;
        this.mode = mode;
        this.report = report;
    }

    /**
     * @return a handler, or {@code null} when this repository needs no guard: the guard is
     *         off, the entity is exempt or has no tenant field, or the repository has no
     *         {@code findById} to build the rules on.
     */
    public static TenantGuardHandler create(Object target, Class<?> entityType, TenantScopeResolver resolver,
                                            TenantGuardMode mode, Consumer<String> report) {
        if (target == null || entityType == null || resolver == null || mode == TenantGuardMode.OFF) return null;
        if (TenantGuardPolicy.EXEMPT_ENTITIES.contains(entityType.getSimpleName())) return null;
        Method tenantGetter = TenantGuardPolicy.tenantGetter(entityType);
        if (tenantGetter == null) return null;
        Method findById = findInterfaceMethod(target, "findById", 1);
        if (findById == null) return null;
        return new TenantGuardHandler(
                target,
                entityType.getSimpleName(),
                tenantGetter,
                TenantGuardPolicy.idGetter(entityType),
                findById,
                findInterfaceMethod(target, "findAllById", 1),
                resolver,
                mode == null ? TenantGuardMode.ENFORCE : mode,
                report == null ? message -> { } : report);
    }

    // ── dispatch ────────────────────────────────────────────────────────

    @Override
    public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
        String name = method.getName();

        if (method.getDeclaringClass() == Object.class) {
            switch (name) {
                case "equals":   return proxy == args[0];
                case "hashCode": return System.identityHashCode(proxy);
                case "toString": return "TenantGuard[" + entity + "]";
                default:         return call(method, args);
            }
        }

        if (args != null && args.length == 1) {
            Object arg = args[0];
            switch (name) {
                case "findById":      return guardedFindById(method, arg);
                case "existsById":    return guardedExistsById(method, arg);
                case "deleteById":    return guardedDeleteById(method, arg);
                case "findAllById":   return guardedFindAllById(method, arg);
                case "deleteAllById": return guardedDeleteAllById(method, arg);
                case "delete":        return guardedDelete(method, arg);
                case "save":          return guardedSave(method, arg);
                case "saveAll":       return guardedSaveAll(method, arg);
                default:              break;
            }
        }
        return call(method, args);
    }

    // ── reads ───────────────────────────────────────────────────────────

    private Object guardedFindById(Method method, Object id) throws Throwable {
        TenantScope scope = resolver.current();
        if (!scope.isEnforced()) return call1(method, id);
        Optional<?> found = lookup(id);
        if (found.isEmpty()) return found;
        return allowed(scope, found.get(), "findById(" + id + ")") ? found : Optional.empty();
    }

    private Object guardedExistsById(Method method, Object id) throws Throwable {
        TenantScope scope = resolver.current();
        if (!scope.isEnforced()) return call1(method, id);
        Optional<?> found = lookup(id);
        if (found.isEmpty()) return Boolean.FALSE;
        return allowed(scope, found.get(), "existsById(" + id + ")");
    }

    private Object guardedFindAllById(Method method, Object ids) throws Throwable {
        Object result = call1(method, ids);
        TenantScope scope = resolver.current();
        if (!scope.isEnforced() || !(result instanceof Iterable<?> items)) return result;
        List<Object> visible = new ArrayList<>();
        for (Object item : items) {
            if (allowed(scope, item, "findAllById")) visible.add(item);
        }
        return visible;
    }

    // ── deletes ─────────────────────────────────────────────────────────

    private Object guardedDeleteById(Method method, Object id) throws Throwable {
        TenantScope scope = resolver.current();
        if (scope.isEnforced()) {
            Optional<?> found = lookup(id);
            if (found.isPresent() && !allowed(scope, found.get(), "deleteById(" + id + ")")) return null;
        }
        return call1(method, id);
    }

    private Object guardedDeleteAllById(Method method, Object ids) throws Throwable {
        TenantScope scope = resolver.current();
        if (!scope.isEnforced() || !(ids instanceof Iterable<?> requested)) return call1(method, ids);
        List<Object> deletable = new ArrayList<>();
        for (Object id : requested) {
            Optional<?> found = lookup(id);
            if (found.isEmpty() || allowed(scope, found.get(), "deleteAllById(" + id + ")")) deletable.add(id);
        }
        return call1(method, deletable);
    }

    private Object guardedDelete(Method method, Object candidate) throws Throwable {
        TenantScope scope = resolver.current();
        if (scope.isEnforced()) {
            if (!allowed(scope, candidate, "delete")) return null;
            // The caller-supplied object could have been edited (e.g. deserialised from a request
            // body) to look like it is ours; what is actually stored under that id is what counts.
            Object id = idOf(candidate);
            if (id != null) {
                Optional<?> stored = lookup(id);
                if (stored.isPresent() && !allowed(scope, stored.get(), "delete(" + id + ")")) return null;
            }
        }
        return call1(method, candidate);
    }

    // ── writes ──────────────────────────────────────────────────────────

    private Object guardedSave(Method method, Object candidate) throws Throwable {
        TenantScope scope = resolver.current();
        if (scope.isEnforced()) rejectIfOverwritesForeignRecord(scope, candidate, "save");
        return call1(method, candidate);
    }

    private Object guardedSaveAll(Method method, Object candidates) throws Throwable {
        TenantScope scope = resolver.current();
        if (!scope.isEnforced() || !(candidates instanceof Iterable<?> iterable)) return call1(method, candidates);

        List<Object> batch = new ArrayList<>();
        List<Object> ids = new ArrayList<>();
        for (Object candidate : iterable) {
            batch.add(candidate);
            Object id = idOf(candidate);
            if (id != null) ids.add(id);
        }
        if (!ids.isEmpty()) {
            Object stored = findAllById != null ? call1(findAllById, ids) : null;
            if (stored instanceof Iterable<?> rows) {
                for (Object row : rows) rejectIfForeign(scope, row, "saveAll");
            } else {
                for (Object id : ids) lookup(id).ifPresent(row -> rejectIfForeign(scope, row, "saveAll"));
            }
        }
        return call1(method, batch);
    }

    private void rejectIfOverwritesForeignRecord(TenantScope scope, Object candidate, String operation) throws Throwable {
        Object id = idOf(candidate);
        if (id == null) return;                                  // a brand-new record
        Optional<?> stored = lookup(id);
        if (stored.isPresent()) rejectIfForeign(scope, stored.get(), operation + "(" + id + ")");
    }

    private void rejectIfForeign(TenantScope scope, Object stored, String operation) {
        String owner = tenantOf(stored);
        if (scope.permits(owner)) return;
        report(scope, owner, "overwrite via " + operation);
        if (mode == TenantGuardMode.ENFORCE) {
            throw new TenantViolationException(entity + " not found");
        }
    }

    // ── helpers ─────────────────────────────────────────────────────────

    private boolean allowed(TenantScope scope, Object record, String operation) {
        String owner = tenantOf(record);
        if (scope.permits(owner)) return true;
        report(scope, owner, operation);
        return mode == TenantGuardMode.LOG;     // LOG reports but lets it through; ENFORCE denies
    }

    private void report(TenantScope scope, String owner, String operation) {
        report.accept("[TenantGuard:" + mode + "] " + operation + " on " + entity
                + " — record belongs to tenant '" + owner + "' but the request is for '" + scope.tenantId() + "'");
    }

    /** Raw, unguarded findById on the wrapped repository. */
    private Optional<?> lookup(Object id) throws Throwable {
        Object result = call1(findById, id);
        return result instanceof Optional<?> optional ? optional : Optional.empty();
    }

    private String tenantOf(Object record) {
        Object value = read(tenantGetter, record);
        return value == null ? null : value.toString();
    }

    private Object idOf(Object record) {
        return idGetter == null ? null : read(idGetter, record);
    }

    private static Object read(Method getter, Object record) {
        try {
            return getter.invoke(record);
        } catch (IllegalAccessException | InvocationTargetException | IllegalArgumentException e) {
            throw new IllegalStateException("TenantGuard cannot read " + getter.getName() + "()", e);
        }
    }

    private Object call1(Method method, Object argument) throws Throwable {
        return call(method, new Object[]{argument});
    }

    private Object call(Method method, Object[] args) throws Throwable {
        try {
            return method.invoke(target, args);
        } catch (InvocationTargetException e) {
            throw e.getCause() != null ? e.getCause() : e;
        }
    }

    private static Method findInterfaceMethod(Object target, String name, int parameterCount) {
        for (Class<?> type = target.getClass(); type != null; type = type.getSuperclass()) {
            for (Class<?> iface : type.getInterfaces()) {
                for (Method m : iface.getMethods()) {
                    if (m.getName().equals(name) && m.getParameterCount() == parameterCount && !m.isBridge()) return m;
                }
            }
        }
        return null;
    }
}
