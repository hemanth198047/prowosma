package com.prowosma.backend.auth;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

@DisplayName("IpRanges / ClientIp — believing X-Forwarded-For only when a trusted proxy sent it")
class ClientIpTest {

    private static final IpRanges TRUSTED = IpRanges.LOOPBACK_AND_PRIVATE;

    // ── ranges ───────────────────────────────────────────────────────────────

    @Test
    @DisplayName("CIDR ranges match by address bits")
    void cidr() {
        IpRanges r = IpRanges.parse("10.0.0.0/8, 172.16.0.0/12, 192.168.1.0/24, 203.0.113.7");
        assertTrue(r.contains("10.255.255.255"));
        assertTrue(r.contains("172.16.0.1"));
        assertTrue(r.contains("172.31.255.255"));
        assertFalse(r.contains("172.32.0.1"));
        assertTrue(r.contains("192.168.1.200"));
        assertFalse(r.contains("192.168.2.1"));
        assertTrue(r.contains("203.0.113.7"));
        assertFalse(r.contains("203.0.113.8"));
        assertFalse(r.contains("11.0.0.1"));
    }

    @Test
    @DisplayName("IPv6, and IPv4-mapped IPv6, are handled")
    void ipv6() {
        IpRanges r = IpRanges.parse("fc00::/7, ::1/128, 10.0.0.0/8");
        assertTrue(r.contains("fd12:3456::1"));
        assertTrue(r.contains("::1"));
        assertFalse(r.contains("2606:4700::1111"));
        assertTrue(r.contains("::ffff:10.1.2.3"));
        assertFalse(r.contains("::ffff:11.1.2.3"));
    }

    @Test
    @DisplayName("anything that is not an IP literal does not match, and never triggers a DNS lookup")
    void nonLiterals() {
        IpRanges everything = IpRanges.parse("0.0.0.0/0, ::/0");
        for (String bad : new String[]{null, "", " ", "localhost", "example.com", "10.0.0.256", "10.0.0", "1.2.3.4.5", "::gggg", "10.0.0.1%eth0", "10.0.0.1/8", "unknown"}) {
            assertFalse(everything.contains(bad), String.valueOf(bad));
            assertFalse(IpRanges.isLiteral(bad), String.valueOf(bad));
        }
        assertTrue(IpRanges.isLiteral("8.8.8.8"));
        assertTrue(IpRanges.isLiteral("2606:4700:4700::1111"));
    }

    @Test
    @DisplayName("a malformed range is an error, not silently ignored (a typo must not widen or drop trust)")
    void invalidRanges() {
        for (String bad : new String[]{"10.0.0.0/33", "banana", "10.0.0.0/x", "10.0.0.0/-1", "::1/129", "10.0.0/8"}) {
            assertThrows(IllegalArgumentException.class, () -> IpRanges.parse(bad), bad);
        }
        assertTrue(IpRanges.parse("").isEmpty());
        assertTrue(IpRanges.parse(null).isEmpty());
        assertTrue(IpRanges.parse(" , ,").isEmpty());
    }

    @Test
    @DisplayName("the default trusted set is loopback and private ranges only")
    void defaultTrusted() {
        assertTrue(TRUSTED.contains("127.0.0.1"));
        assertTrue(TRUSTED.contains("::1"));
        assertTrue(TRUSTED.contains("10.20.30.40"));
        assertTrue(TRUSTED.contains("172.16.5.5"));
        assertTrue(TRUSTED.contains("192.168.0.10"));
        assertTrue(TRUSTED.contains("fd00::1"));
        assertFalse(TRUSTED.contains("8.8.8.8"));
        assertFalse(TRUSTED.contains("172.32.0.1"));
        assertFalse(TRUSTED.contains("203.0.113.9"));
    }

    // ── client address ───────────────────────────────────────────────────────

    @Test
    @DisplayName("a direct caller from the internet cannot choose its own address with headers")
    void untrustedPeerIgnoresHeaders() {
        assertEquals("203.0.113.9", ClientIp.resolve("203.0.113.9", "10.0.0.5", "10.0.0.6", TRUSTED));
        assertEquals("203.0.113.9", ClientIp.resolve("203.0.113.9", "1.2.3.4, 5.6.7.8", null, TRUSTED));
    }

    @Test
    @DisplayName("behind our proxy, the client is the closest untrusted hop, and entries the client wrote are ignored")
    void trustedPeerUsesRightmostUntrustedHop() {
        assertEquals("203.0.113.9", ClientIp.resolve("10.0.0.2", "203.0.113.9", null, TRUSTED));
        // client sent "X-Forwarded-For: 1.1.1.1"; our proxy appended the address it actually saw
        assertEquals("203.0.113.9", ClientIp.resolve("10.0.0.2", "1.1.1.1, 203.0.113.9", null, TRUSTED));
        // extra internal hops (a load balancer in front of the proxy) are skipped
        assertEquals("203.0.113.9", ClientIp.resolve("10.0.0.2", "1.1.1.1, 203.0.113.9, 10.0.0.3", null, TRUSTED));
    }

    @Test
    @DisplayName("garbage entries are skipped; if every hop is internal the left-most valid one is used")
    void oddChains() {
        assertEquals("203.0.113.9", ClientIp.resolve("10.0.0.2", "203.0.113.9, not-an-ip, ", null, TRUSTED));
        assertEquals("10.9.9.9", ClientIp.resolve("10.0.0.2", "10.9.9.9, 10.0.0.3", null, TRUSTED));
    }

    @Test
    @DisplayName("X-Real-IP is used only via a trusted peer, and only if it is an address")
    void realIp() {
        assertEquals("203.0.113.9", ClientIp.resolve("10.0.0.2", null, "203.0.113.9", TRUSTED));
        assertEquals("203.0.113.9", ClientIp.resolve("10.0.0.2", "", " 203.0.113.9 ", TRUSTED));
        assertEquals("10.0.0.2", ClientIp.resolve("10.0.0.2", null, "evil<script>", TRUSTED));
        assertEquals("10.0.0.2", ClientIp.resolve("10.0.0.2", null, null, TRUSTED));
        assertEquals("203.0.113.9", ClientIp.resolve("203.0.113.9", null, "1.1.1.1", TRUSTED));
    }

    @Test
    @DisplayName("an operator can trust a specific proxy address instead of the private ranges")
    void customTrust() {
        IpRanges only = IpRanges.parse("198.51.100.10");
        assertEquals("203.0.113.9", ClientIp.resolve("198.51.100.10", "203.0.113.9", null, only));
        assertEquals("10.0.0.2", ClientIp.resolve("10.0.0.2", "203.0.113.9", null, only));   // private, but not trusted here
    }

    @Test
    @DisplayName("an unknown or missing peer address is returned as is")
    void oddPeers() {
        assertNull(ClientIp.resolve(null, "1.2.3.4", null, TRUSTED));
        assertEquals("unknown", ClientIp.resolve("unknown", "1.2.3.4", null, TRUSTED));
    }

    // ── workspace IP allow-list entries ──────────────────────────────────────

    @Test
    @DisplayName("allow-list: exact addresses and CIDR ranges (CIDR used to never match at all)")
    void allowlistCidr() {
        assertTrue(IpRanges.allowlistMatches("203.0.113.9", "203.0.113.9"));
        assertFalse(IpRanges.allowlistMatches("203.0.113.9", "203.0.113.90"));       // was a string-prefix match
        assertTrue(IpRanges.allowlistMatches("10.0.0.0/8", "10.5.5.5"));
        assertFalse(IpRanges.allowlistMatches("10.0.0.0/8", "11.0.0.1"));
        assertTrue(IpRanges.allowlistMatches("0.0.0.0/0", "8.8.8.8"));
    }

    @Test
    @DisplayName("allow-list: older wildcard/prefix entries keep working, but only on whole octets")
    void allowlistLegacyPrefixes() {
        assertTrue(IpRanges.allowlistMatches("10.1.*", "10.1.2.3"));
        assertTrue(IpRanges.allowlistMatches("10.1.", "10.1.2.3"));
        assertTrue(IpRanges.allowlistMatches("10.1", "10.1.2.3"));
        assertTrue(IpRanges.allowlistMatches("192.168.7.*", "192.168.7.200"));
        assertFalse(IpRanges.allowlistMatches("1.2", "1.20.0.1"));                   // used to match
        assertFalse(IpRanges.allowlistMatches("10.1.*", "10.10.2.3"));
        assertTrue(IpRanges.allowlistMatches("*", "203.0.113.9"));                   // the old "any address" spelling
    }

    @Test
    @DisplayName("allow-list: garbage entries and garbage addresses never match")
    void allowlistGarbage() {
        for (String entry : new String[]{null, "", " ", "banana", "10.0.0.0/99", "../", "10.1.x"}) {
            assertFalse(IpRanges.allowlistMatches(entry, "10.1.2.3"), String.valueOf(entry));
        }
        assertFalse(IpRanges.allowlistMatches("10.1.*", "not-an-ip"));
        assertFalse(IpRanges.allowlistMatches("10.1.*", null));
    }
}
