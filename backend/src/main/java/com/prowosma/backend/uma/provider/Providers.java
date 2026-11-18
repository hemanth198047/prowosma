package com.prowosma.backend.uma.provider;

import java.util.List;

import static com.prowosma.backend.uma.provider.MeetingProviderAdapter.*;

/** The platforms. Capability states are kept honest: nothing is VERIFIED until it has run against the real service. */
final class Providers {
    private Providers() {}

    static final class GoogleMeet implements MeetingProviderAdapter {
        public String id() { return "GOOGLE_MEET"; }
        public String displayName() { return "Google Meet"; }
        public List<String> hosts() { return List.of("meet.google.com"); }
        public List<String> permissionsRequired() { return List.of("Read your Meet conference records and transcripts (meetings.space.readonly)", "Read your calendar events (calendar.events.readonly)"); }
        public List<Capability> capabilities() {
            return List.of(upload(), importTranscript(), browserRecording(), firefliesNotetaker(), firefliesImport(),
                    new Capability("postMeetingTranscript", "Read Google's transcript after the meeting", State.IMPLEMENTED,
                            "Each person connects their Google account (Connections). Needs Workspace with transcription turned on in the meeting, and the server's Google OAuth client."),
                    new Capability("postMeetingRecording", "Fetch the recording after the meeting", State.POSSIBLE, "Recordings are saved to the organiser's Drive."),
                    ownBot("Google offers no general bot API (the Meet Media API is a limited preview). Use the Fireflies notetaker or browser recording."),
                    new Capability("schedule", "Schedule a Meet meeting from Prowosma (with invitations)", State.IMPLEMENTED,
                            "Each person connects their Google account (Connections); needs the Calendar API in the company's Google Cloud project."),
                    new Capability("calendar", "Add upcoming Meet meetings from Google Calendar automatically", State.IMPLEMENTED,
                            "Switch on under Connections; optionally sends the Fireflies notetaker to each one."));
        }
    }

    static final class Teams implements MeetingProviderAdapter {
        public String id() { return "MS_TEAMS"; }
        public String displayName() { return "Microsoft Teams"; }
        public List<String> hosts() { return List.of("teams.microsoft.com", "teams.live.com"); }
        public List<String> permissionsRequired() { return List.of("Create Teams meetings in your calendar (Calendars.ReadWrite, OnlineMeetings.ReadWrite)",
                "Read transcripts of meetings you organised (OnlineMeetingTranscript.Read.All - your Microsoft 365 admin approves it once for the organisation)"); }
        public List<Capability> capabilities() {
            return List.of(upload(), importTranscript(), browserRecording(), firefliesNotetaker(), firefliesImport(),
                    new Capability("schedule", "Start or schedule a Teams meeting from Prowosma (with invitations)", State.IMPLEMENTED,
                            "Each person connects their Microsoft 365 account (Connections); needs the company's Microsoft Entra app registration. Built and tested with simulated Microsoft replies, not yet against a real tenant."),
                    new Capability("postMeetingTranscript", "Read Teams' transcript after the meeting", State.IMPLEMENTED,
                            "For meetings the connected person organised, with transcription turned on in the meeting. Needs admin consent for OnlineMeetingTranscript.Read.All. Tested with simulated replies only."),
                    new Capability("liveStatus", "Know when the call starts and ends", State.UNAVAILABLE,
                            "Microsoft only tells apps with organisation-wide call permissions. Prowosma looks for the transcript after the planned end instead."),
                    new Capability("postMeetingRecording", "Fetch the recording after the meeting", State.POSSIBLE, "Microsoft Graph, same approval."),
                    ownBot("Needs a separate Windows-hosted media bot service. Use the Fireflies notetaker or browser recording."));
        }
    }

    static final class Zoom implements MeetingProviderAdapter {
        public String id() { return "ZOOM"; }
        public String displayName() { return "Zoom"; }
        public List<String> hosts() { return List.of("zoom.us", "zoom.com", "zoomgov.com"); }
        public List<String> permissionsRequired() { return List.of("cloud_recording:read (recordings and audio transcripts)", "meeting:read"); }
        public List<Capability> capabilities() {
            return List.of(upload(), importTranscript(), browserRecording(), firefliesNotetaker(), firefliesImport(),
                    new Capability("postMeetingTranscript", "Fetch Zoom's transcript after the meeting", State.POSSIBLE, "Cloud Recording API; paid plan with audio transcripts on."),
                    new Capability("postMeetingRecording", "Fetch the cloud recording", State.POSSIBLE, "Cloud Recording API + 'recording completed' webhook."),
                    ownBot("Meeting SDK bots need Zoom's app review before joining other organisations' meetings. Use the Fireflies notetaker or browser recording."),
                    new Capability("calendar", "Find meetings", State.POSSIBLE, "Through your Google or Microsoft calendar."));
        }
    }

    static final class Webex implements MeetingProviderAdapter {
        public String id() { return "WEBEX"; }
        public String displayName() { return "Webex"; }
        public List<String> hosts() { return List.of("webex.com"); }
        public List<String> permissionsRequired() { return List.of("meeting:transcripts_read", "meeting:recordings_read"); }
        public List<Capability> capabilities() {
            return List.of(upload(), importTranscript(), browserRecording(), firefliesNotetaker(), firefliesImport(),
                    new Capability("postMeetingTranscript", "Fetch the Webex transcript after the meeting", State.POSSIBLE, "Meetings API; transcription must be on."),
                    new Capability("postMeetingRecording", "Fetch the recording", State.POSSIBLE, "Recordings API."),
                    ownBot("No general bot API for this. Use the Fireflies notetaker or browser recording."),
                    new Capability("calendar", "Find meetings", State.POSSIBLE, "Through your Google or Microsoft calendar."));
        }
    }

    static final class Other implements MeetingProviderAdapter {
        public String id() { return "OTHER"; }
        public String displayName() { return "Any other platform"; }
        public List<String> hosts() { return List.of(); }
        public List<String> permissionsRequired() { return List.of(); }
        public List<Capability> capabilities() { return List.of(upload(), importTranscript(), browserRecording()); }
    }
}
