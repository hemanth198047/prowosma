# Connect Microsoft Teams — the simple version

**What this does:** after a Teams meeting ends, Prowosma can fetch its transcript by itself.
**Who does it:** someone with **Microsoft 365 admin rights** (Global Administrator, or Teams Administrator + Application Administrator). Ordinary users can't.
**You can skip all of this.** Without it, people simply upload or paste Teams transcripts by hand.

Think of it like a **staff badge for a robot**: you register the robot with Microsoft (Part A), give it permission to read transcripts (Part B), tell Microsoft which people's meetings it may look at (Part C), then hand the badge to the Prowosma server (Part D) and tell Prowosma which company it belongs to (Part E).

> Status: this was built from Microsoft's published documentation and tested against a *scripted* Microsoft. It has **not** yet been run against a real Microsoft 365 tenant — see "Part G — first real test" and `MEETING_ASSISTANT_OPERATIONS.md`. Portal labels change often; look for the same idea if a name differs.

---
## Part A — Register the robot (Microsoft Entra)
1. Open **https://entra.microsoft.com** and sign in as an admin.
2. **Identity → Applications → App registrations → New registration.**
3. Name: `Prowosma Meeting Assistant`. Supported account types: **Accounts in this organizational directory only** (single tenant). Leave "Redirect URI" empty. Click **Register**.
4. On the page that opens, copy two things and keep them private:
   - **Application (client) ID**  → this becomes `TEAMS_GRAPH_CLIENT_ID`
   - **Directory (tenant) ID**    → you will type this into Prowosma in Part E

## Part B — Give it a password and permission
5. Left menu → **Certificates & secrets → New client secret.** Description `Prowosma`, pick an expiry (note the date — **you must renew before it expires**). Click **Add**.
6. **Copy the secret's *Value* immediately** (not the "Secret ID"). Microsoft shows it only once. → this becomes `TEAMS_GRAPH_CLIENT_SECRET`.
7. Left menu → **API permissions → Add a permission → Microsoft Graph → Application permissions.**
8. Search **`OnlineMeetingTranscript.Read.All`**, tick it, click **Add permissions**. (That is the only permission needed.)
9. Click **Grant admin consent for <your company>** and confirm. The status column should turn green ("Granted").

## Part C — Tell Microsoft whose meetings the robot may read (Application access policy)
Microsoft requires this extra step for application permissions: an admin creates a policy for the app and grants it to the meeting organizers. In **PowerShell** (install the Teams module once with `Install-Module MicrosoftTeams`), as a Teams admin:
```
Connect-MicrosoftTeams
New-CsApplicationAccessPolicy -Identity "ProwosmaTranscripts" -AppIds "<Application (client) ID from step 4>" -Description "Prowosma Meeting Assistant"
# Option 1 — only specific people (repeat per organizer; use their Entra Object ID or UPN):
Grant-CsApplicationAccessPolicy -PolicyName "ProwosmaTranscripts" -Identity "<user object id or user@company.com>"
# Option 2 — everyone in the company:
Grant-CsApplicationAccessPolicy -PolicyName "ProwosmaTranscripts" -Global
```
These commands follow Microsoft's page *"Allow applications to access online meetings on behalf of a user"* — check it for the latest syntax. **Changes can take a while to apply (Microsoft has said up to about 30 minutes).**
Also make sure a Teams admin has **allowed transcription** in the Teams meeting policy, and has **not disabled Graph API access to meeting transcripts** (Prowosma shows Microsoft's "disabled" error if so).

## Part D — Give the badge to the Prowosma server
Put two values in the backend settings file (`backend/.env`, next to `docker-compose.yml` — see `GOOGLE_MEET_SETUP.md` Part D for the other ways to set them: Render's Environment tab, Windows environment variables, Kubernetes Secret):
```
TEAMS_GRAPH_CLIENT_ID=<Application (client) ID>
TEAMS_GRAPH_CLIENT_SECRET=<the secret Value from step 6>
```
Restart the backend.

## Part E — Tell Prowosma which company this is
10. In Prowosma: **Integrations → Communication → Microsoft Teams Meetings.**
11. Paste the **Directory (tenant) ID** (step 4) into "Microsoft tenant id" → **Save tenant id.**
12. Click **Test connection.** Healthy = the robot can sign in and has the transcript permission. *(It cannot check Part C — only a real meeting can.)*
13. Turn on **Allow people to register Microsoft Teams meetings.**

## Part F — How people use it
- Register the meeting by pasting the **"Join the meeting" link from the invitation** (the long `…/l/meetup-join/…?context=…` link). That link tells Prowosma who organized the meeting. Short `…/meet/12345…` links don't — for those, upload the transcript.
- **Someone must start transcription inside the Teams meeting** (… → Record and transcribe → Start transcription). No transcript exists otherwise.
- After the meeting ends Prowosma checks every few minutes (or click **Check Microsoft Teams now**).

## Part G — First real test (please do this before relying on it)
Run the Teams checklist in `MEETING_ASSISTANT_OPERATIONS.md` ("Verification runbook"): a real meeting, organizer covered by the policy, transcription on. Record the result.

## If something goes wrong
| You see | Meaning | Fix |
|---|---|---|
| Test connection: "client secret … wrong or expired" | Wrong secret, or it expired | Part B steps 5–6, update `TEAMS_GRAPH_CLIENT_SECRET`, restart |
| "app isn't set up in this tenant, or admin consent…" | Consent missing / wrong tenant id | Part B step 9; check the tenant id in Part E |
| "signed in, but admin consent for OnlineMeetingTranscript.Read.All hasn't been granted" | Permission not approved | Part B steps 7–9 |
| Meeting fails: "didn't allow the app to read this organizer's transcripts" | No application access policy for that organizer (or not applied yet) | Part C, wait up to ~30 minutes, then **Retry** |
| Meeting fails: "disabled Graph API access to meeting transcripts" | Tenant setting | Ask your Microsoft 365 admin to allow it |
| Meeting fails: "no transcript appeared in time" | Transcription wasn't started in the meeting | Upload the transcript; next time start transcription |
| "different Microsoft organization" | The link belongs to another company's Teams | Upload or paste the transcript |
| "doesn't say who organized the meeting" | Short link / no organizer in the link | Use the invitation's "Join the meeting" link, or upload |
