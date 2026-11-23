package com.prowosma.backend.uma.provider;

import com.prowosma.backend.uma.core.UmaException;
import org.springframework.http.HttpStatus;

import java.net.URI;
import java.util.List;
import java.util.Locale;

/**
 * One meeting platform. Every platform exposes different things, so each capability is reported separately with an honest state.
 * Methods for things a platform (or this version) can't do throw {@link UmaException} with code UNSUPPORTED — callers check
 * {@link #capabilities()} first.
 */
public interface MeetingProviderAdapter {

    /** VERIFIED: run by us against the real service · IMPLEMENTED: built and tested with simulations, not yet against a real account ·
     *  POSSIBLE: the platform officially supports it, not built yet · UNAVAILABLE: not offered (reason given). */
    enum State { VERIFIED, IMPLEMENTED, POSSIBLE, UNAVAILABLE }

    record Capability(String key, String label, State state, String note) {}

    String id();                       // GOOGLE_MEET | MS_TEAMS | ZOOM | WEBEX | OTHER

    String displayName();

    /** Host names whose links belong to this platform. */
    List<String> hosts();

    List<Capability> capabilities();

    /** Permissions a person or admin would grant when connecting (shown before connecting). */
    List<String> permissionsRequired();

    default boolean matches(URI uri) {
        String h = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
        return hosts().stream().anyMatch(x -> h.equals(x) || h.endsWith("." + x));
    }

    // ── operations (Phase 4); the default is an honest "not available yet" ──

    default void connect(String org, String user) { throw unsupported("Connecting " + displayName()); }

    default List<Object> discoverMeetings(String org, String user) { throw unsupported("Finding scheduled " + displayName() + " meetings"); }

    default byte[] fetchRecording(String org, String user, String meetingRef) { throw unsupported("Fetching " + displayName() + " recordings"); }

    default String fetchTranscript(String org, String user, String meetingRef) { throw unsupported("Fetching " + displayName() + " transcripts"); }

    default void join(String org, String user, String meetingUrl) { throw unsupported("Joining " + displayName() + " meetings live"); }

    private UmaException unsupported(String what) {
        return new UmaException(HttpStatus.NOT_IMPLEMENTED, "UNSUPPORTED", what + " isn't available yet.",
                "Upload the recording or import the transcript after the meeting instead.");
    }

    // shared capability rows
    static Capability upload() { return new Capability("uploadRecording", "Upload a recording", State.VERIFIED, "Transcribed by our own speech-to-text."); }
    static Capability importTranscript() { return new Capability("importTranscript", "Import a transcript", State.VERIFIED, "Paste text or a .vtt, .srt, .txt, .json, .pdf or .docx file."); }
    static Capability browserRecording() { return new Capability("browserRecording", "Record it live from your browser", State.IMPLEMENTED,
            "Chrome or Edge: share the meeting tab with its sound. Works with any meeting app; keep the tab open until you stop."); }
    static Capability firefliesNotetaker() { return new Capability("firefliesNotetaker", "Join live with your Fireflies notetaker", State.IMPLEMENTED,
            "Needs Fireflies connected (Connections). Fireflies joins the running meeting; its transcript is fetched automatically afterwards."); }
    static Capability firefliesImport() { return new Capability("firefliesImport", "Import from Fireflies", State.VERIFIED, "Needs Fireflies connected (Connections)."); }
    static Capability ownBot(String why) { return new Capability("liveJoin", "Join live with Prowosma's own bot", State.UNAVAILABLE, why); }
}
