# Connect Google Meet — the simple version

**What this does:** after a Google Meet call ends, Prowosma can fetch the call's transcript by itself.
**What you need first:** a Google account (a work/school Google Workspace account is best) and about 20 minutes.
**You can skip all of this.** Without it, Prowosma still works — people just upload or paste the transcript by hand.

Think of it like giving Prowosma a **key card** for Google. You make the key card once (Part A–C), give it to the server (Part D),
then each person "swipes in" with their own Google account (Part E).

---
## Part A — Make a Google "workspace" for the key card (Google Cloud project)
1. Open **https://console.cloud.google.com** and sign in.
2. At the top, click the project picker → **New project**. Name it `Prowosma Meet`. Click **Create**. Make sure it's the selected project.

## Part B — Turn on the Meet door
3. Left menu → **APIs & Services → Library**.
4. Search **Google Meet REST API** → click it → **Enable**.

## Part C — Make the key card (OAuth)
5. Left menu → **Google Auth Platform** (or search "Google Auth Platform"). If you see **Get started**, click it.
6. **Branding:** app name `Prowosma`, your email as the support email. Save.
7. **Audience:**
   - Everyone is in your own Google Workspace company → choose **Internal** (easiest, no extra checks).
   - Otherwise → choose **External**. It starts in **Testing** mode. Then under **Test users → Add users**, add the Google email of
     every person who will connect. *(Only listed people can connect while it's in Testing.)*
8. **Data Access → Add or remove scopes.** Add these three, then **Save**:
   - `openid`
   - `.../auth/userinfo.email` (shown as "email")
   - `https://www.googleapis.com/auth/meetings.space.readonly`
   (If the third isn't in the list, paste it in "Manually add scopes".)
9. **Clients → Create client:**
   - Application type: **Web application**. Name: `Prowosma web`.
   - **Authorized redirect URIs → Add URI** and paste **exactly** (no spaces, no trailing slash):
     `YOUR-APP-ADDRESS/integrations/meeting-platforms/google-callback`
     - Real site example: `https://app.mycompany.com/integrations/meeting-platforms/google-callback`
     - Trying it on your own computer: `http://localhost:5173/integrations/meeting-platforms/google-callback`
     - "YOUR-APP-ADDRESS" is the same web address you put in the server setting `FRONTEND_URL`.
   - Leave "Authorized JavaScript origins" empty. Click **Create**.
10. Google shows a **Client ID** and a **Client secret**. Copy both somewhere private. (Treat the secret like a password.)

## Part D — Give the key card to the Prowosma server
Set these settings on the server, in the same place you already keep secrets like `MONGODB_URI` and `JWT_SECRET`
(Render → your service → **Environment**; on a VPS → your `.env` file; locally → your environment variables):

| Name | Value |
|---|---|
| `GOOGLE_MEET_OAUTH_CLIENT_ID` | the Client ID from step 10 |
| `GOOGLE_MEET_OAUTH_CLIENT_SECRET` | the Client secret from step 10 |
| `FRONTEND_URL` | your app address (already set if the app works; must match step 9) |
| `ENCRYPTION_KEY` | a secret scramble-key (see below) — **required** |

**About `ENCRYPTION_KEY`:** Prowosma scrambles the saved Google sign-ins with it, and refuses to save them without it.
- **If `ENCRYPTION_KEY` is already set on your server, do NOT change it** — other protected data depends on it. Leave it as it is.
- If it is not set, make one:
  - Windows PowerShell: `$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)`
  - Mac/Linux: `openssl rand -base64 32`
  Copy the output into `ENCRYPTION_KEY`, and **back it up** — if it's lost, saved sign-ins can't be read and people must reconnect.

Then **restart the backend** so it picks up the new settings.

## Part E — Each person connects (once)
11. In Prowosma: **Integrations → Communication → Google Meet**. An admin turns **Allow people to register Google Meet meetings** on.
12. Each person who registers Meet meetings clicks **Connect my Google account**, picks their Google account and clicks **Allow**.
    You land back in Prowosma with "Your Google account is connected."
13. Click **Test connection**. Green/healthy = done.

## Part F — Try it for real
14. Start a Google Meet. **Turn on transcription inside the call** (More options ⋮ → Record or Captions/Transcripts → Start transcript) —
    **no transcript is made unless somebody turns this on.** Say a few sentences. End the call.
15. In Prowosma → **Meeting Assistant** → paste the meeting link → **Register meeting**.
16. Wait a few minutes (Google needs time), or open the meeting and click **Check Google Meet now**. The transcript appears in the **Transcript** tab.

---
## If something goes wrong
| You see | What it means | Fix |
|---|---|---|
| "Connect my Google account" is greyed out | The server doesn't have the Client ID/secret or `ENCRYPTION_KEY` yet | Part D, then restart |
| Google page says **redirect_uri_mismatch** | The address in step 9 isn't *exactly* the app's address | Fix step 9 (same `http/https`, same port, no trailing slash) |
| Google says **Access blocked / app not verified** | You're in Testing mode and your email isn't a test user | Step 7: add your email under Test users |
| It worked, then asked to reconnect after ~a week | In **Testing** mode Google can expire sign-ins after about 7 days | Click Connect again — or publish the app in Google Auth Platform → Audience (Google may then ask you to verify the app) |
| "No transcript for this meeting" | Transcription wasn't turned on in the call | Upload the transcript instead; next time turn it on |
| "Google denied access" | The connected person didn't organize/attend that meeting | Connect the organizer's account, or upload |

*Console wording was checked against Google's current documentation, but Google changes screens often — if a label differs slightly, look for the same idea.*
