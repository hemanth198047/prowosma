package com.prowosma.backend.integration;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.net.InetAddress;
import java.net.URI;
import java.net.UnknownHostException;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

@DisplayName("OutboundUrlPolicy — URLs the server will call on a user's behalf")
class OutboundUrlPolicyTest {

    private static InetAddress ip(int... octets) throws UnknownHostException {
        byte[] b = new byte[octets.length];
        for (int i = 0; i < b.length; i++) b[i] = (byte) octets[i];
        return InetAddress.getByAddress(b);
    }

    private static URI uri(String s) { return OutboundUrlPolicy.parseHttps(s, "URL"); }

    // ── parseHttps ───────────────────────────────────────────────────────────

    @Test
    @DisplayName("a plain https URL is accepted")
    void acceptsHttps() {
        assertTrue(uri("https://gitlab.example.com/base").getHost().equals("gitlab.example.com"));
    }

    @Test
    @DisplayName("http, other schemes, blanks, credentials, missing hosts and control characters are refused")
    void refusesUnsafeShapes() {
        for (String bad : new String[]{
                null, "", "   ", "http://example.com", "ftp://example.com", "file:///etc/passwd",
                "https://user:pw@example.com/", "https://outlook.office.com@evil.com/", "https:///nohost",
                "example.com", "https://exa mple.com", "https://example.com/\nX-Injected: 1"}) {
            assertThrows(IllegalArgumentException.class, () -> uri(bad), String.valueOf(bad));
        }
    }

    // ── host allow-list ──────────────────────────────────────────────────────

    @Test
    @DisplayName("host matching accepts the host and its subdomains, and rejects look-alikes")
    void hostMatching() {
        List<String> allowed = List.of("webhook.office.com", ".logic.azure.com");
        OutboundUrlPolicy.requireHostMatches(uri("https://webhook.office.com/x"), allowed, "URL");
        OutboundUrlPolicy.requireHostMatches(uri("https://acme.WEBHOOK.office.com/x"), allowed, "URL");
        OutboundUrlPolicy.requireHostMatches(uri("https://prod-1.westus.logic.azure.com:443/x"), allowed, "URL");
        for (String bad : new String[]{
                "https://webhook.office.com.evil.com/x", "https://evil.com/webhook.office.com",
                "https://notwebhook.office.com/x", "https://logic.azure.com.attacker.io/", "https://evil.com/"}) {
            assertThrows(IllegalArgumentException.class,
                    () -> OutboundUrlPolicy.requireHostMatches(uri(bad), allowed, "URL"), bad);
        }
    }

    // ── public-address check ─────────────────────────────────────────────────

    @Test
    @DisplayName("private, loopback, link-local (cloud metadata), CGNAT and unique-local addresses are all internal")
    void internalAddresses() throws Exception {
        assertTrue(OutboundUrlPolicy.isInternal(ip(127, 0, 0, 1)));
        assertTrue(OutboundUrlPolicy.isInternal(ip(10, 1, 2, 3)));
        assertTrue(OutboundUrlPolicy.isInternal(ip(172, 16, 0, 1)));
        assertTrue(OutboundUrlPolicy.isInternal(ip(172, 31, 255, 255)));
        assertTrue(OutboundUrlPolicy.isInternal(ip(192, 168, 1, 1)));
        assertTrue(OutboundUrlPolicy.isInternal(ip(169, 254, 169, 254)));      // cloud instance metadata
        assertTrue(OutboundUrlPolicy.isInternal(ip(100, 64, 0, 1)));
        assertTrue(OutboundUrlPolicy.isInternal(ip(0, 0, 0, 0)));
        assertTrue(OutboundUrlPolicy.isInternal(ip(224, 0, 0, 1)));
        assertTrue(OutboundUrlPolicy.isInternal(InetAddress.getByName("::1")));
        assertTrue(OutboundUrlPolicy.isInternal(InetAddress.getByName("fc00::1")));
        assertTrue(OutboundUrlPolicy.isInternal(InetAddress.getByName("fd12:3456::1")));
        assertTrue(OutboundUrlPolicy.isInternal(InetAddress.getByName("fe80::1")));
    }

    @Test
    @DisplayName("ordinary public addresses are not")
    void publicAddresses() throws Exception {
        assertFalse(OutboundUrlPolicy.isInternal(ip(8, 8, 8, 8)));
        assertFalse(OutboundUrlPolicy.isInternal(ip(172, 32, 0, 1)));          // just outside 172.16/12
        assertFalse(OutboundUrlPolicy.isInternal(ip(100, 128, 0, 1)));         // just outside 100.64/10
        assertFalse(OutboundUrlPolicy.isInternal(InetAddress.getByName("2606:4700:4700::1111")));
    }

    @Test
    @DisplayName("a host is accepted only if EVERY address it resolves to is public")
    void resolvedAddressesAllChecked() throws Exception {
        OutboundUrlPolicy.requirePublicAddress(uri("https://git.example.com/"), h -> new InetAddress[]{ip(8, 8, 8, 8)}, "URL");
        assertThrows(IllegalArgumentException.class, () -> OutboundUrlPolicy.requirePublicAddress(
                uri("https://git.example.com/"), h -> new InetAddress[]{ip(8, 8, 8, 8), ip(10, 0, 0, 5)}, "URL"));
        assertThrows(IllegalArgumentException.class, () -> OutboundUrlPolicy.requirePublicAddress(
                uri("https://git.example.com/"), h -> new InetAddress[]{ip(169, 254, 169, 254)}, "URL"));
    }

    @Test
    @DisplayName("a host that does not resolve is refused (fail closed)")
    void unresolvableIsRefused() {
        assertThrows(IllegalArgumentException.class, () -> OutboundUrlPolicy.requirePublicAddress(
                uri("https://nope.invalid/"), h -> { throw new UnknownHostException(h); }, "URL"));
        assertThrows(IllegalArgumentException.class, () -> OutboundUrlPolicy.requirePublicAddress(
                uri("https://nope.invalid/"), h -> new InetAddress[0], "URL"));
    }

    @Test
    @DisplayName("literal IPs and localhost are refused with the real resolver, with no network needed")
    void literalsWithSystemResolver() {
        for (String bad : new String[]{"https://127.0.0.1/", "https://[::1]/", "https://10.0.0.1/",
                "https://169.254.169.254/latest/meta-data/", "https://localhost/"}) {
            assertThrows(IllegalArgumentException.class,
                    () -> OutboundUrlPolicy.requirePublicAddress(uri(bad), OutboundUrlPolicy.SYSTEM_RESOLVER, "URL"), bad);
        }
    }

    @Test
    @DisplayName("the resolver is asked about the bare host (IPv6 brackets removed)")
    void ipv6BracketsStripped() {
        String[] asked = new String[1];
        OutboundUrlPolicy.requirePublicAddress(uri("https://[2606:4700:4700::1111]/"), h -> {
            asked[0] = h;
            return new InetAddress[]{InetAddress.getByName("2606:4700:4700::1111")};
        }, "URL");
        assertTrue("2606:4700:4700::1111".equals(asked[0]));
    }
}
