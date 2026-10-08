# Taking the Google Meet connection to production (Google OAuth verification)

While your Google Cloud project is in **Testing**, only listed test users can connect (and their sign-in expires after ~7 days). To let anyone connect, you **publish** the app, and because Meeting Assistant uses the *sensitive* scope `meetings.space.readonly`, Google then asks you to **verify** it. Until verification is complete, an unverified production app shows a "Google hasn't verified this app" warning and is limited to about 100 users.

## 1. The two links Google asks for
After you deploy the frontend these pages are public (no login):

| Google asks for | Where it lives | URL |
|---|---|---|
| Application privacy policy link | `frontend/public/privacy.html` | `https://<your-site>/privacy` |
| Application terms of service link | `frontend/public/terms.html` | `https://<your-site>/terms` |

Your site today is `https://prowosma.vercel.app`, so: `https://prowosma.vercel.app/privacy` and `https://prowosma.vercel.app/terms`. Both are also linked from the sign-in page.

**Before you submit:** the pages contain four `{{PLACEHOLDERS}}` that only you can fill in. Find-and-replace them in both files, then run `npm run check:legal` (in `frontend/`) — it lists any that remain and fails until none are left. Google rejects pages that still contain them.
`{{COMPANY_NAME}}` your legal/trading name · `{{CONTACT_EMAIL}}` a monitored address · `{{EFFECTIVE_DATE}}` e.g. 8 October 2026 · `{{GOVERNING_LAW}}` e.g. India (Karnataka)

Read both pages once. They make real commitments (no staff access to Google data except for support/security/legal, deletion within 30 days of a request, the retention periods, the list of service providers). Make sure you can keep them — and have a lawyer review them if you can. They are good-faith templates written for this application, not legal advice.

## 2. Use a domain you own
Google verifies that you own the domain that hosts your home page and privacy policy (Google Search Console). A `*.vercel.app` address is a shared domain and Google may refuse to verify it. Your consent screen already uses `wilmarcs.services`, so the safest route is a custom domain you own:
1. Vercel → your frontend project → Settings → Domains → add e.g. `app.wilmarcs.services` (or the root domain) and create the DNS record Vercel shows.
2. Set `FRONTEND_URL` (and `CORS_ORIGINS`, `WS_ORIGINS`) on the backend to the new address, and rebuild the frontend if needed.
3. In Google Cloud → Google Auth Platform → Clients, add the new redirect URI `https://<new-domain>/integrations/meeting-platforms/google-callback` (keep the old one until the switch is done).
4. Verify the domain in **Google Search Console** with the same Google account that owns the Cloud project.

## 3. Consent screen (Google Auth Platform → Branding)
App name · logo (square, ≤1 MB) · **user support email** · **App home page** (public, describes what Prowosma does, links to the privacy policy) · **Privacy policy link** · **Terms of service link** · **Authorized domains** (the domain from step 2) · developer contact email. Under **Data Access** list exactly: `openid`, `email`, `https://www.googleapis.com/auth/meetings.space.readonly` — nothing else.

A home page that is only a login form is a common reason for rejection. If yours is, add a short public landing page (what the product does, a screenshot, links to /privacy and /terms).

## 4. Justification text for the sensitive scope (paste into the verification form)
> Prowosma is a work-management application. Its Meeting Assistant lets a user register a Google Meet meeting they organized or attended and, after the meeting ends, imports that meeting's transcript so Prowosma can display it and produce a summary, minutes of meeting and action items that the user reviews and approves.
> We request `https://www.googleapis.com/auth/meetings.space.readonly` because the Google Meet REST API methods for conference records, participants, transcripts and transcript entries require it; no narrower scope grants read access to meeting transcripts. The access is read-only, used only for meetings the user explicitly registers, and the data is stored for a configurable period (default 90 days). `openid` and `email` are used only to show which Google account is connected.
> Prowosma's use and transfer of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements. The data is not used for advertising, not sold, and not used to train AI models. Users can disconnect at any time (which revokes the token) and delete imported transcripts.

## 5. Demo video (unlisted YouTube link)
Record the screen, in English, one continuous take (~3–5 minutes):
1. Show the Google **consent screen** with the scopes listed and the browser address bar visible with your **OAuth client ID** in the URL.
2. Walk through the whole flow: Prowosma → Integrations → Meeting Platforms → *Connect my Google account* → approve.
3. Register a Google Meet link and show the imported transcript appearing, then the summary, minutes and action items with their transcript evidence links.
4. Show where the user can **Disconnect my Google account** and **Delete transcript**.
5. Show the privacy policy page.

## 6. Publish and submit
1. Google Auth Platform → **Audience** → *Publish app* (status becomes "In production").
2. **Verification Center** → submit, paste the text from step 4, add the video link, confirm the domain.
3. Watch the support email: Google replies there with questions; answer promptly. Reviews commonly take days to a few weeks (not guaranteed).
4. When approved the warning screen disappears, the user cap is removed, and sign-ins stop expiring weekly.

Not verified yet: the real Google Meet import has not been tested against a real meeting — do that (see `MEETING_ASSISTANT_OPERATIONS.md` §5) before recording the demo, so the video shows real data.
