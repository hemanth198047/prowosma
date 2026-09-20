package com.prowosma.backend.auth;

/**
 * The address of the real client of a request.
 *
 * {@code X-Forwarded-For} is written by the client as much as by any proxy, so it can only be
 * believed when the request really arrived through a proxy we trust. Taking its first entry
 * unconditionally (as the rate limiter, the IP allow-list and login logging all did) lets any
 * caller choose their own "address": rotate it to dodge the rate limit, or write an allowed
 * address to walk through a workspace's IP restriction.
 *
 * Rule: if the TCP peer is not a trusted proxy, headers are ignored. If it is, walk
 * {@code X-Forwarded-For} from the right (the hop our own proxy added) and take the first
 * address that is not itself a trusted proxy; that is the closest untrusted hop and the most
 * an attacker cannot forge.
 */
public final class ClientIp {

    private ClientIp() {}

    public static String resolve(String remoteAddr, String forwardedFor, String realIp, IpRanges trustedProxies) {
        if (remoteAddr == null || !IpRanges.isLiteral(remoteAddr)) return remoteAddr;
        if (!trustedProxies.contains(remoteAddr)) return remoteAddr;

        if (forwardedFor != null && !forwardedFor.isBlank()) {
            String[] hops = forwardedFor.split(",");
            String leftmostValid = null;
            for (int i = hops.length - 1; i >= 0; i--) {
                String hop = hops[i].trim();
                if (!IpRanges.isLiteral(hop)) continue;             // garbage entries are skipped
                if (!trustedProxies.contains(hop)) return hop;
                leftmostValid = hop;
            }
            if (leftmostValid != null) return leftmostValid;        // every hop was one of our own proxies
        }
        if (realIp != null && IpRanges.isLiteral(realIp.trim())) return realIp.trim();
        return remoteAddr;
    }
}
