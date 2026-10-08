/**
 * GoogleMeetTranscriptGuide — a detailed, plain-language walkthrough of how to get a transcript out of Google Meet.
 * Most "nothing arrived" problems are not Prowosma problems: captions and Gemini notes are NOT transcripts, and Meet's saved
 * transcripts only exist when someone starts one during the meeting. This explains what to check before, what to click during,
 * and what to do if it didn't work. Based on Google's help page "Use transcripts with Google Meet"; Google can change editions and menus.
 */
const GOOGLE_HELP = "https://support.google.com/meet/answer/12849897";

function Steps({ children }) { return <ol className="ma-guide-steps">{children}</ol>; }

export default function GoogleMeetTranscriptGuide({ defaultOpen = false, title = "How to turn on a transcript in Google Meet (step by step)" }) {
  return (
    <details className="ma-guide" open={defaultOpen}>
      <summary>{title}</summary>

      <div className="ma-guide-body">
        <div className="ma-guide-key">
          <strong>The most common mistake:</strong> turning on <em>captions</em> or Gemini&rsquo;s <em>&ldquo;Take notes for me&rdquo;</em> is <strong>not</strong> the same as
          starting a <em>transcript</em>. Captions are live subtitles that are never saved, and Gemini&rsquo;s notes are a summary document. Prowosma can only import a
          <strong> transcript</strong> &mdash; and Google creates one only if someone clicks <strong>Start transcription</strong> during the meeting.
        </div>

        <h4>The short version</h4>
        <Steps>
          <li>Use a <strong>computer</strong> (not the Meet phone app) and a Google account that has Meet transcripts (a Google Workspace account).</li>
          <li>In the meeting click <strong>Activities</strong> &rarr; <strong>Transcripts</strong> &rarr; <strong>Start transcription</strong> &rarr; <strong>Start</strong>.</li>
          <li>Wait for the <strong>&ldquo;Transcribing&rdquo;</strong> badge at the top left. Then hold your meeting.</li>
          <li>When you finish, <strong>make sure everyone has left</strong> the call. Prowosma imports the transcript a few minutes later.</li>
        </Steps>

        <h4>1. Check you can use transcripts (once, before your first meeting)</h4>
        <ul>
          <li><strong>Your Google account.</strong> Saved transcripts are a Google Workspace feature &mdash; for example Business Standard and Plus, Enterprise, Education Plus, the
            Teaching and Learning Upgrade and Workspace Individual. Google has said they are <strong>not available on personal Google accounts</strong> (addresses ending in
            @gmail.com). Not sure? Start a meeting and open <em>Activities</em>: if there is no <em>Transcripts</em> option, your account doesn&rsquo;t have the feature.</li>
          <li><strong>Your administrator.</strong> Workspace admins can switch transcripts off for the organization. If the option is missing on a supported edition, ask your admin to check the Google Meet settings in the Admin console.</li>
          <li><strong>Language.</strong> Saved transcripts support a limited set of languages (English, French and German, plus a few others Google has added). Check Google&rsquo;s list if you speak another language.</li>
          <li><strong>Device.</strong> Start it from a computer in a browser. The Meet mobile app can&rsquo;t start a transcript.</li>
          <li><strong>Who can start it.</strong> If &ldquo;host management&rdquo; is off, anyone in the host&rsquo;s organization can. If it is on, only the host and co-hosts can. People from outside the organization can&rsquo;t.</li>
          <li><strong>Storage.</strong> Transcripts are saved in the organizer&rsquo;s Google Drive, which needs free space.</li>
        </ul>

        <h4>2. Use the right Google account in Prowosma</h4>
        <p>Google saves the transcript for the meeting&rsquo;s <strong>organizer</strong>, and Prowosma reads it using the Google account <em>you connected</em>. So connect the
          account that organized the meeting (or at least one that attended) under <em>Integrations &rarr; Meeting Platforms</em>. If you start an instant meeting
          yourself (for example from meet.google.com/new), you are the organizer.</p>

        <h4>3. During the meeting &mdash; every click</h4>
        <Steps>
          <li>Start or join the meeting in your browser on a computer.</li>
          <li>Along the bottom of the screen, at the bottom right, click <strong>Activities</strong> (the icon made of small shapes). If you don&rsquo;t see it, click the three dots <strong>&#8942; More options</strong> first.</li>
          <li>Click <strong>Transcripts</strong>.</li>
          <li>Click <strong>Start transcription</strong>.</li>
          <li>In the box that appears, click <strong>Start</strong>. Meet tells everyone in the call that it is being transcribed.</li>
          <li>Check it worked: a <strong>&ldquo;Transcribing&rdquo;</strong> badge appears at the top left of the meeting window. (Captions are optional and only for reading along; they are not what gets saved.)</li>
          <li>Hold your meeting. Each speaker is shown with their Google name.</li>
          <li>When you are done: <strong>Activities &rarr; Transcripts &rarr; Stop transcription &rarr; Stop</strong>. (Ending the meeting also stops it.)</li>
          <li>Finally <strong>end the meeting for everyone</strong>, and make sure every participant has left &mdash; including anyone still connected from another browser tab or a phone.
            Google only marks a meeting as finished when the last person leaves, and Prowosma waits for that.</li>
        </Steps>
        <p className="ma-hint">You can stop and start again during a meeting. Each start creates its own transcript, and Prowosma joins them in order.</p>

        <h4>4. After the meeting</h4>
        <ul>
          <li>Google emails a link to the organizer (and to whoever started the transcript). The transcript is a Google Doc in the organizer&rsquo;s Drive, in the <em>Meet Recordings</em> folder. It usually appears a few minutes after the meeting ends; long meetings can take longer.</li>
          <li>Prowosma looks for it automatically every few minutes. To look right now, open the meeting and press <strong>Check Google Meet now</strong>. The meeting page then tells you exactly what Google answered.</li>
        </ul>

        <h4>5. Start it automatically (optional)</h4>
        <p>Hosts can have transcription start by itself for scheduled meetings: open the event in Google Calendar, open the Google Meet settings next to the Meet link, and turn on the transcription
          option if it is offered. Whether it is offered depends on your Workspace edition and your admin&rsquo;s settings.</p>

        <h4>6. If it didn&rsquo;t work</h4>
        <table className="ma-guide-table">
          <thead><tr><th>What you see</th><th>Likely reason</th><th>What to do</th></tr></thead>
          <tbody>
            <tr><td>There is no <em>Transcripts</em> option under Activities</td><td>Your account or edition doesn&rsquo;t include it, your admin turned it off, you are on the phone app, or you are not the host/co-host</td><td>Use a computer; ask the host to start it; ask your admin; or upload a transcript (section 7)</td></tr>
            <tr><td>Captions were on but nothing arrived</td><td>Captions are never saved</td><td>Next time click <em>Start transcription</em></td></tr>
            <tr><td>Only Gemini &ldquo;Take notes for me&rdquo; was on</td><td>That makes a notes document, not a transcript</td><td>Also click <em>Start transcription</em></td></tr>
            <tr><td>&ldquo;Google has no record of this meeting&rdquo;</td><td>You connected a different Google account than the one in the meeting, the link is for another meeting, or the meeting hasn&rsquo;t ended yet</td><td>Connect the organizer&rsquo;s account; check the link; wait a few minutes</td></tr>
            <tr><td>&ldquo;Google still shows this meeting as running&rdquo;</td><td>Someone is still in the call (another tab, a phone)</td><td>Make sure everyone has left, then press <em>Check Google Meet now</em></td></tr>
            <tr><td>&ldquo;Google has no transcript&rdquo; after the meeting ended</td><td>A transcript wasn&rsquo;t started during the meeting</td><td>Upload the transcript or start one next time</td></tr>
            <tr><td>Transcript is marked &ldquo;may be incomplete&rdquo;</td><td>Transcription was started late or stopped early</td><td>Read the note on the transcript; you can upload a fuller one</td></tr>
            <tr><td>You use a personal @gmail.com account</td><td>Google doesn&rsquo;t offer saved Meet transcripts on personal accounts</td><td>Use a Workspace account, or upload a transcript</td></tr>
          </tbody>
        </table>

        <h4>7. No transcript? Upload one instead</h4>
        <p>Prowosma works with any transcript text, from any source. If you have the Google Doc: open it from Drive (<em>Meet Recordings</em> folder) &rarr; <strong>File &rarr; Download &rarr; Plain text (.txt)</strong>.
          Then open the meeting in Prowosma and use <strong>Add transcript</strong> to upload the file, or paste the text. Files up to 5&nbsp;MB are accepted (.txt, .vtt and .srt).</p>

        <p className="ma-hint">Based on Google&rsquo;s own help page,{" "}
          <a href={GOOGLE_HELP} target="_blank" rel="noopener noreferrer">Use transcripts with Google Meet</a>. Google can change which accounts and menus have this feature &mdash; check that page if something above doesn&rsquo;t match what you see.</p>
      </div>
    </details>
  );
}
