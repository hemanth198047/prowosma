package com.prowosma.backend.integration;

import java.net.InetAddress;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.UnknownHostException;
import java.util.Collection;
import java.util.Locale;

/**
 * Rules for URLs the server will call on a user's behalf (a self-managed GitLab host, a
 * Teams webhook). Without them a workspace member could point the server at
 * {@code http://169.254.169.254/} (cloud credentials) or any internal service and read the
 * response, which is server-side request forgery.
 *
 * <ul>
 *   <li>{@link #parseHttps} — https only, no embedded credentials, has a host.</li>
 *   <li>{@link #requireHostMatches} — for services with known hosts (Teams).</li>
 *   <li>{@link #requirePublicAddress} — for services on an arbitrary host (self-managed
 *       GitLab): the host must resolve only to public addresses.</li>
 * </ul>
 * Address checking happens at validation time, so a host that later re-resolves to an
 * internal address (DNS rebinding) is not caught by it; callers also disable redirects.
 */
public final class OutboundUrlPolicy {

    /** Resolves a host name; replaceable so tests need no network. */
    @FunctionalInterface
    public interface Resolver {
        InetAddress[] resolve(String host) throws UnknownHostException;
    }

    public static final Resolver SYSTEM_RESOLVER = InetAddress::getAllByName;

    private OutboundUrlPolicy() {}

    public static URI parseHttps(String raw, String what) {
        if (raw == null || raw.isBlank()) throw bad(what, "is required");
        String s = raw.trim();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c <= ' ' || c == 127) throw bad(what, "contains whitespace or control characters");
        }
        final URI uri;
        try {
            uri = new URI(s);
        } catch (URISyntaxException e) {
            throw bad(what, "is not a valid URL");
        }
        if (!"https".equalsIgnoreCase(uri.getScheme())) throw bad(what, "must use https");
        if (uri.getRawUserInfo() != null) throw bad(what, "must not contain credentials");
        if (uri.getHost() == null || uri.getHost().isBlank()) throw bad(what, "has no host");
        return uri;
    }

    /** The host must equal one of the suffixes or be a subdomain of it. */
    public static void requireHostMatches(URI uri, Collection<String> suffixes, String what) {
        String host = uri.getHost().toLowerCase(Locale.ROOT);
        for (String raw : suffixes) {
            String suffix = raw.trim().toLowerCase(Locale.ROOT).replaceFirst("^\\.", "");
            if (!suffix.isEmpty() && (host.equals(suffix) || host.endsWith("." + suffix))) return;
        }
        throw bad(what, "host is not an allowed host");
    }

    /** Every address the host resolves to must be public. Fails closed if it does not resolve. */
    public static void requirePublicAddress(URI uri, Resolver resolver, String what) {
        String host = uri.getHost();
        if (host.startsWith("[") && host.endsWith("]")) host = host.substring(1, host.length() - 1);
        final InetAddress[] addresses;
        try {
            addresses = resolver.resolve(host);
        } catch (UnknownHostException e) {
            throw bad(what, "host could not be resolved");
        }
        if (addresses == null || addresses.length == 0) throw bad(what, "host could not be resolved");
        for (InetAddress address : addresses) {
            if (isInternal(address)) throw bad(what, "must not point at a private, loopback or link-local address");
        }
    }

    public static boolean isInternal(InetAddress a) {
        if (a.isAnyLocalAddress() || a.isLoopbackAddress() || a.isLinkLocalAddress()
                || a.isSiteLocalAddress() || a.isMulticastAddress()) {
            return true;
        }
        byte[] b = a.getAddress();
        if (b.length == 4) {
            int first = b[0] & 0xff, second = b[1] & 0xff;
            return first == 0                                            // 0.0.0.0/8
                    || (first == 100 && second >= 64 && second <= 127)   // 100.64.0.0/10 carrier-grade NAT
                    || (first == 198 && (second == 18 || second == 19))  // 198.18.0.0/15 benchmarking
                    || first >= 240;                                     // reserved / broadcast
        }
        return (b[0] & 0xfe) == 0xfc;                                    // fc00::/7 unique local
    }

    private static IllegalArgumentException bad(String what, String problem) {
        return new IllegalArgumentException(what + " " + problem);
    }
}
