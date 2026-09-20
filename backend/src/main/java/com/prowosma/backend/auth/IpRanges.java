package com.prowosma.backend.auth;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * IP addresses and CIDR ranges, matched properly (by address bits, not by string prefix).
 * Never performs a DNS lookup: anything that is not an IP literal simply does not match.
 */
public final class IpRanges {

    private static final Pattern IPV4 = Pattern.compile("(25[0-5]|2[0-4]\\d|1?\\d?\\d)(\\.(25[0-5]|2[0-4]\\d|1?\\d?\\d)){3}");
    private static final Pattern IPV6 = Pattern.compile("[0-9a-fA-F:.]{2,45}");

    /** Loopback and private ranges: where a reverse proxy or load balancer normally sits. */
    public static final IpRanges LOOPBACK_AND_PRIVATE = parse(
            "127.0.0.0/8, ::1/128, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, fc00::/7");

    private record Range(byte[] network, int prefixBits) { }

    private final List<Range> ranges;

    private IpRanges(List<Range> ranges) {
        this.ranges = ranges;
    }

    /** @throws IllegalArgumentException for an entry that is neither an IP nor a CIDR range */
    public static IpRanges parse(String commaSeparated) {
        List<Range> ranges = new ArrayList<>();
        if (commaSeparated != null) {
            for (String raw : commaSeparated.split(",")) {
                String entry = raw.trim();
                if (!entry.isEmpty()) ranges.add(parseOne(entry));
            }
        }
        return new IpRanges(ranges);
    }

    public boolean contains(String ip) {
        byte[] address = address(ip);
        if (address == null) return false;
        for (Range range : ranges) if (matches(range, address)) return true;
        return false;
    }

    public boolean isEmpty() {
        return ranges.isEmpty();
    }

    /** True for an IPv4 or IPv6 literal (no DNS involved, no zone ids). */
    public static boolean isLiteral(String s) {
        return address(s) != null;
    }

    /**
     * One entry of a workspace's IP allow-list. Understands an exact address, a CIDR range
     * ({@code 10.1.0.0/16}) and the older wildcard/prefix forms ({@code 10.1.*}, {@code 10.1.})
     * that were previously matched by string prefix. Prefixes now end at an octet boundary, so
     * {@code 1.2} no longer matches 1.20.0.1.
     */
    public static boolean allowlistMatches(String entry, String ip) {
        if (entry == null || ip == null) return false;
        String e = entry.trim();
        if (e.isEmpty()) return false;
        if (e.equals("*")) return true;                         // long-standing "allow any address" spelling
        if (isLiteral(e)) return sameAddress(e, ip);
        if (e.contains("/")) {
            try {
                return new IpRanges(List.of(parseOne(e))).contains(ip);
            } catch (IllegalArgumentException invalid) {
                return false;
            }
        }
        String prefix = e.replace("*", "");
        if (prefix.isEmpty() || !prefix.matches("[0-9.]+")) return false;
        if (!prefix.endsWith(".")) prefix += ".";
        return isLiteral(ip) && ip.startsWith(prefix);
    }

    private static boolean sameAddress(String a, String b) {
        byte[] x = address(a), y = address(b);
        return x != null && y != null && java.util.Arrays.equals(x, y);
    }

    private static Range parseOne(String entry) {
        String addressPart = entry;
        int prefix = -1;
        int slash = entry.indexOf('/');
        if (slash >= 0) {
            addressPart = entry.substring(0, slash);
            try {
                prefix = Integer.parseInt(entry.substring(slash + 1).trim());
            } catch (NumberFormatException e) {
                throw new IllegalArgumentException("Invalid IP range: " + entry);
            }
        }
        byte[] network = address(addressPart.trim());
        if (network == null) throw new IllegalArgumentException("Invalid IP range: " + entry);
        int max = network.length * 8;
        if (slash < 0) prefix = max;                            // a bare address is a single host
        else if (prefix < 0 || prefix > max) throw new IllegalArgumentException("Invalid IP range: " + entry);
        return new Range(network, prefix);
    }

    private static boolean matches(Range range, byte[] address) {
        if (range.network().length != address.length) return false;
        int bits = range.prefixBits();
        for (int i = 0; i < address.length && bits > 0; i++, bits -= 8) {
            int mask = bits >= 8 ? 0xFF : (0xFF << (8 - bits)) & 0xFF;
            if ((address[i] & mask) != (range.network()[i] & mask)) return false;
        }
        return true;
    }

    /** Bytes of an IP literal (IPv4-mapped IPv6 collapses to IPv4), or null if it is not one. */
    private static byte[] address(String s) {
        if (s == null) return null;
        String t = s.trim();
        if (t.isEmpty()) return null;
        boolean v4 = IPV4.matcher(t).matches();
        boolean v6 = !v4 && t.contains(":") && IPV6.matcher(t).matches();
        if (!v4 && !v6) return null;
        try {
            return InetAddress.getByName(t).getAddress();       // a validated literal: no DNS lookup happens
        } catch (UnknownHostException e) {
            return null;
        }
    }
}
