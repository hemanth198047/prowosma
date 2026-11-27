# Meeting feature: real-browser test run

Drives the real UI (Chrome) against the real backend and a real (in-memory, MongoDB-compatible) database. Nothing is mocked except the outgoing mail
server being absent, so "invites could not be delivered" is what you see, as on a server without mail settings.

```bash
# 1. backend on :9090 with seeded users owner@/admin@/member@test.com (password "pass"); rate limit raised; stops when /tmp/e2e.stop appears
cd backend && E2E_SERVER=true TEST_MONGO_JAVA=true gradle test --tests '*BrowserE2EServer'     # leave running (add -I <init script> if needed)

# 2. frontend, built with the default API address (http://localhost:9090) and served on :4173
cd frontend && npm run build && npx vite preview --port 4173 --host 127.0.0.1

# 3. the journeys (pip install playwright; uses /usr/bin/google-chrome)
python3 tools/meeting-e2e/meetings_calendar_journey.py   # schedule, join, resend, edit, drag/resize, views, validation, Earlier page, delete
python3 tools/meeting-e2e/meetings_edge_journey.py       # deep links, time zones, failed load, teammate, phone, overlaps, hostile titles, assistant

touch /tmp/e2e.stop                                      # stops the backend
```
Each check prints PASS/FAIL; screenshots go to /tmp/meeting-e2e-shots.
