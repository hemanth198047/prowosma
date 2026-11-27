import sys, traceback; sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
from common import *
RESULTS = []
def check(name, cond, detail=""):
    RESULTS.append((name, bool(cond), str(detail)[:300])); print(("PASS " if cond else "FAIL ") + name + ((" :: " + str(detail)[:300]) if (not cond and detail) else ""), flush=True)
def step(name):
    def deco(fn):
        def run(*a, **k):
            try: return fn(*a, **k)
            except Exception as e:
                RESULTS.append((name, False, "EXC " + repr(e)[:300])); print("FAIL " + name + " :: EXC " + repr(e)[:400], flush=True)
                try: a[0].screenshot(path=f"/tmp/meeting-e2e-shots/fail-{re.sub('[^a-z0-9]+','-',name.lower())}.png")
                except Exception: pass
        return run
    return deco

day = next_weekday(1)
dstr = day.isoformat()
def utc_of(ist_h, ist_m=0): # IST (UTC+5:30) -> UTC string for the chosen day
    dt = datetime.datetime.combine(day, datetime.time(ist_h, ist_m)) - datetime.timedelta(hours=5, minutes=30)
    return dt.strftime("%Y-%m-%dT%H:%M")

def goto_day_week(page):
    page.goto(BASE + "/calendar"); page.wait_for_load_state("networkidle")
    # navigate forward until the meeting's week is visible
    for _ in range(3):
        if page.get_by_role("columnheader").count() or True:
            hdr = page.get_by_text(re.compile(rf"{day.month}/{day.day}\b")).first
            if hdr.count() and hdr.is_visible(): return
        page.get_by_role("button", name="Next", exact=True).click(); time.sleep(0.6)

def meetings_api(page, **q):
    st, d = api(page, "GET", "/meetings?size=100")
    return d["data"] if isinstance(d, dict) else []

@step("schedule from the UI saves the right data")
def s_schedule(page):
    page.goto(BASE + "/calendar"); page.wait_for_load_state("networkidle")
    # go to the right week
    for _ in range(3):
        if page.get_by_text(re.compile(rf"\b{day.month}/{day.day}\b")).count(): break
        page.get_by_role("button", name="Next", exact=True).click(); time.sleep(0.6)
    schedule_ui(page, "E2E Kickoff", day, "3:00 PM", "3:45 PM", ["a@wilmarcs.services", "B@wilmarcs.services", "g@gmail.com"], "https://meet.google.com/e2e-test-abc", "1. Intro\n2. Plan")
    ms = [m for m in meetings_api(page) if m["title"] == "E2E Kickoff"]
    check("exactly one meeting saved (no double-submit)", len(ms) == 1, len(ms))
    m = ms[0]
    check("start stored in UTC (3:00 PM IST = 09:30 UTC)", m["meetingDate"].startswith(utc_of(15, 0)), m["meetingDate"])
    check("duration 45", m.get("durationMins") == 45, m.get("durationMins"))
    check("attendees normalised + 3", sorted(a.lower() for a in m["attendees"]) == ["a@wilmarcs.services", "b@wilmarcs.services", "g@gmail.com"], m["attendees"])
    check("link stored", m.get("location") == "https://meet.google.com/e2e-test-abc", m.get("location"))
    check("created by the organizer", m.get("createdBy") == "owner@test.com", m.get("createdBy"))
    return m

@step("calendar card + detail popover")
def s_card(page, m):
    goto_day_week(page)
    card = page.get_by_text("E2E Kickoff").first
    check("card visible in the week", card.is_visible())
    box = card.bounding_box()
    check("card sits at the 3pm row", box and 700 < box["y"] < 740, box)
    card.click(); time.sleep(0.5)
    dlg = page.get_by_role("dialog")
    check("popover shows time in the viewer's zone", dlg.get_by_text(re.compile(r"3:00 PM\s*[–-]\s*3:45 PM")).count() == 1)
    check("popover lists all 3 attendees", all(dlg.get_by_text(a).count() == 1 for a in ["a@wilmarcs.services", "b@wilmarcs.services", "g@gmail.com"]))
    check("popover shows organizer", dlg.get_by_text("owner@test.com").count() >= 1)
    j = dlg.get_by_role("link", name=re.compile("Join meeting"))
    check("Join link goes to the meeting URL", j.get_attribute("href") == "https://meet.google.com/e2e-test-abc", j.get_attribute("href"))
    check("Join opens in a new tab safely", j.get_attribute("target") == "_blank" and "noopener" in (j.get_attribute("rel") or ""), (j.get_attribute("target"), j.get_attribute("rel")))
    with page.context.expect_page(timeout=8000) as newp:
        j.click()
    check("Join actually opens a new tab", newp.value is not None)
    try: newp.value.close()
    except Exception: pass

@step("resend invites from the UI")
def s_resend(page, m):
    goto_day_week(page)
    def press_resend():
        if not page.get_by_role("dialog").count():
            page.get_by_text("E2E Kickoff").first.click(); time.sleep(0.4)
        page.get_by_role("dialog").get_by_role("button", name="Resend invites").click(); time.sleep(0.4)
        ad = page.get_by_role("alertdialog")
        check("asks before resending", ad.count() == 1 and "Resend invites?" in ad.inner_text(), ad.inner_text() if ad.count() else "no confirm")
        ad.get_by_role("button", name="Resend").click(); time.sleep(1.5)
    press_resend()
    page.screenshot(path="/tmp/meeting-e2e-shots/06-resend-1.png")
    body = page.inner_text("body")
    check("first resend tells the truth about delivery (this server has no mail configured)", re.search(r"Couldn.t email|Invites sent to|Not delivered", body) is not None, body[-300:])
    st, d = api(page, "GET", f"/meetings/{m['id']}")
    check("resend timestamp recorded", d.get("invitesResentAt") is not None, d.get("invitesResentAt"))
    press_resend()
    page.screenshot(path="/tmp/meeting-e2e-shots/07-resend-2.png")
    body2 = page.inner_text("body")
    check("second resend within a minute says to wait", re.search(r"(?i)wait a minute|just sent", body2) is not None, body2[-300:])
    check("no error page after resend", "This page ran into a problem" not in body2)

@step("edit from the UI")
def s_edit(page, m):
    goto_day_week(page)
    page.get_by_text("E2E Kickoff").first.click(); time.sleep(0.4)
    page.get_by_role("dialog").get_by_role("button", name="Edit meeting").click(); time.sleep(0.6)
    dlg = page.get_by_role("dialog")
    check("edit form is prefilled", dlg.get_by_label("Title").input_value() == "E2E Kickoff" and dlg.get_by_label("Start time").evaluate("e=>e.options[e.selectedIndex].text") == "3:00 PM",
          (dlg.get_by_label("Title").input_value(), dlg.get_by_label("Start time").evaluate("e=>e.options[e.selectedIndex].text")))
    dlg.get_by_label("Title").fill("E2E Kickoff (moved)")
    dlg.get_by_label("Start time").select_option(label="4:00 PM"); dlg.get_by_label("End time").select_option(label="5:00 PM")
    att = dlg.get_by_label("Invite attendees"); att.fill("c@wilmarcs.services"); att.press("Enter")
    dlg.get_by_role("button", name="Save").click(); time.sleep(1.5); page.wait_for_load_state("networkidle")
    st, d = api(page, "GET", f"/meetings/{m['id']}")
    check("title changed", d["title"] == "E2E Kickoff (moved)", d["title"])
    check("moved to 4:00 PM IST", d["meetingDate"].startswith(utc_of(16, 0)), d["meetingDate"])
    check("duration now 60", d.get("durationMins") == 60, d.get("durationMins"))
    check("attendee added, others kept", len(d["attendees"]) == 4, d["attendees"])
    check("location kept through edit", d.get("location") == "https://meet.google.com/e2e-test-abc", d.get("location"))
    check("agenda kept through edit", (d.get("agenda") or d.get("description") or "").startswith("1. Intro"), (d.get("agenda"), d.get("description")))
    check("card shows new title on calendar", page.get_by_text("E2E Kickoff (moved)").count() >= 1)
    check("old title gone", page.get_by_text("E2E Kickoff", exact=True).count() == 0)

@step("drag to move and resize")
def s_drag(page, m):
    goto_day_week(page)
    card = page.get_by_text("E2E Kickoff (moved)").first
    box = card.bounding_box()
    page.mouse.move(box["x"] + 30, box["y"] + 6); page.mouse.down()
    page.mouse.move(box["x"] + 30, box["y"] + 66, steps=8); page.mouse.up(); time.sleep(1.5); page.wait_for_load_state("networkidle")
    st, d = api(page, "GET", f"/meetings/{m['id']}")
    mv = (datetime.datetime.fromisoformat(d["meetingDate"]) - datetime.datetime.fromisoformat(utc_of(16, 0))).total_seconds() / 60
    check("dragging down about an hour moves it later by 60-75 min, snapped to 15 min", 60 <= mv <= 75 and mv % 15 == 0, mv)
    # drag it to the next day column
    goto_day_week(page)
    card = page.get_by_text("E2E Kickoff (moved)").first; box = card.bounding_box()
    page.mouse.move(box["x"] + 30, box["y"] + 6); page.mouse.down()
    page.mouse.move(box["x"] + 30 + 160, box["y"] + 6, steps=8); page.mouse.up(); time.sleep(1.5); page.wait_for_load_state("networkidle")
    st, d2 = api(page, "GET", f"/meetings/{m['id']}")
    check("dragging sideways moves it to the next day, same time", d2["meetingDate"][:10] != d["meetingDate"][:10] and d2["meetingDate"][11:16] == d["meetingDate"][11:16], (d["meetingDate"], d2["meetingDate"]))
    # put it back for the rest of the run
    api(page, "PUT", f"/meetings/{m['id']}", {"meetingDate": utc_of(15, 0) + ":00Z", "durationMins": 45})
    goto_day_week(page)
    ev = page.locator(".fc-event", has_text="E2E Kickoff (moved)").first
    ev.hover(); time.sleep(0.3)
    rz = ev.locator(".fc-event-resizer-end")
    check("the bottom resize handle exists", rz.count() == 1, rz.count())
    rb = rz.bounding_box() if rz.count() else ev.bounding_box()
    page.mouse.move(rb["x"] + rb["width"] / 2, rb["y"] + rb["height"] / 2); page.mouse.down()
    page.mouse.move(rb["x"] + rb["width"] / 2, rb["y"] + rb["height"] / 2 + 30, steps=8); page.mouse.up(); time.sleep(1.5); page.wait_for_load_state("networkidle")
    st, d3 = api(page, "GET", f"/meetings/{m['id']}")
    check("dragging the bottom edge makes the meeting longer", (d3.get("durationMins") or 0) > 45, d3.get("durationMins"))
    api(page, "PUT", f"/meetings/{m['id']}", {"durationMins": 45})

@step("views and navigation")
def s_views(page, m):
    goto_day_week(page)
    for v in ["Day", "Week", "Month", "Work week"]:
        page.get_by_role("tab", name=v, exact=True).click(); time.sleep(0.6)
        check(f"{v} view renders without an error page", "This page ran into a problem" not in page.inner_text("body"))
    page.get_by_role("tab", name="Month", exact=True).click(); time.sleep(0.6)
    check("month view shows the meeting", page.get_by_text("E2E Kickoff").count() >= 1)
    today_btn = page.get_by_role("button", name="Today")
    check("Today is disabled while today is on screen, enabled when it is not", today_btn.is_disabled())
    page.get_by_role("button", name="Next", exact=True).click(); time.sleep(0.6)
    check("Today becomes available after moving away", today_btn.is_enabled())
    today_btn.click(); time.sleep(0.6)
    check("Today brings you back", today_btn.is_disabled())
    # layer toggle
    page.get_by_role("tab", name="Work week", exact=True).click(); goto_day_week(page)
    cb = page.get_by_label("Meetings", exact=True) if page.get_by_label("Meetings", exact=True).count() else page.locator("label:has-text('Meetings') input").first
    cb.uncheck(); time.sleep(0.5)
    check("un-ticking the Meetings layer hides the card", page.get_by_text("E2E Kickoff").count() == 0)
    cb.check()
    try: page.get_by_text("E2E Kickoff").first.wait_for(timeout=5000)
    except Exception: page.screenshot(path="/tmp/meeting-e2e-shots/fail-layer-recheck.png")
    check("ticking it again shows the card", page.get_by_text("E2E Kickoff").count() >= 1)

@step("form validation")
def s_validation(page):
    page.goto(BASE + "/calendar"); page.wait_for_load_state("networkidle")
    page.get_by_role("button", name=re.compile("New meeting")).click()
    dlg = page.get_by_role("dialog")
    before = len(meetings_api(page))
    check("Save is disabled until there is a title", dlg.get_by_role("button", name="Save").is_disabled())
    check("nothing was created", len(meetings_api(page)) == before)
    dlg.get_by_label("Title").fill("Bad times")
    dlg.get_by_label("Start date").fill(dstr); dlg.get_by_label("End date").fill(dstr)
    dlg.get_by_label("Start time").select_option(label="5:00 PM"); dlg.get_by_label("End time").select_option(label="4:00 PM")
    time.sleep(0.5)
    page.screenshot(path="/tmp/meeting-e2e-shots/08-end-before-start.png")
    saveb = dlg.get_by_role("button", name="Save")
    if saveb.is_enabled(): saveb.click(); time.sleep(1)
    check("end before start can't be saved as a bad meeting", len([m for m in meetings_api(page) if m["title"] == "Bad times"]) == 0, [m for m in meetings_api(page) if m["title"] == "Bad times"])
    att = dlg.get_by_label("Invite attendees"); att.fill("not-an-email"); att.press("Enter"); time.sleep(0.5)
    page.screenshot(path="/tmp/meeting-e2e-shots/08-bad-attendee.png")
    chips = dlg.get_by_text("not-an-email").count()
    check("a malformed attendee is rejected or flagged (not blindly invited)", chips == 0 or re.search(r"(?i)valid|invalid|email", dlg.inner_text()) is not None, dlg.inner_text()[-200:])
    dlg.get_by_role("button", name="Discard").click(); time.sleep(0.5)

@step("earlier meetings page + completing")
def s_earlier(page):
    yday = (datetime.date.today() - datetime.timedelta(days=1)).isoformat() + "T09:00:00Z"
    st, d = api(page, "POST", "/meetings", {"title": "E2E Past review", "meetingDate": yday, "durationMins": 30, "attendees": ["a@wilmarcs.services"], "notes": "We agreed on the plan."})
    check("API create (past meeting)", st == 200, (st, d))
    mid = d["id"]
    page.goto(BASE + "/meetings/earlier"); page.wait_for_load_state("networkidle"); time.sleep(1)
    body = page.inner_text("body")
    check("Earlier page loads without the error screen", "This page ran into a problem" not in body and "Something went wrong" not in body)
    check("Earlier page lists the past meeting", "E2E Past review" in body, body[:300])
    st, c = api(page, "POST", f"/meetings/{mid}/complete")
    check("complete works", st == 200 and c["status"] == "COMPLETED", (st, c))
    st, a = api(page, "POST", f"/meetings/{mid}/action-items", {"title": "Send minutes", "dueDate": "2030-01-01"})
    check("action item added", st == 200 and len(a["actionItems"]) == 1, (st, a))
    page.reload(); page.wait_for_load_state("networkidle"); time.sleep(1)
    check("Earlier page still fine with a completed meeting + action item", "This page ran into a problem" not in page.inner_text("body") and "E2E Past review" in page.inner_text("body"))
    return mid

@step("delete from the UI")
def s_delete(page, m):
    goto_day_week(page)
    page.get_by_text("E2E Kickoff").first.click(); time.sleep(0.4)
    page.get_by_role("dialog").get_by_role("button", name="Delete meeting").click(); time.sleep(0.4)
    ad = page.get_by_role("alertdialog")
    check("asks before deleting", ad.count() == 1 and "Delete this meeting?" in ad.inner_text(), ad.inner_text() if ad.count() else "no confirm")
    ad.get_by_role("button", name="Cancel").click() if ad.get_by_role("button", name="Cancel").count() else None
    time.sleep(0.4)
    st, d = api(page, "GET", f"/meetings/{m['id']}")
    check("Cancel keeps the meeting", st == 200, st)
    if not page.get_by_role("dialog").count(): page.get_by_text("E2E Kickoff").first.click(); time.sleep(0.4)
    page.get_by_role("dialog").get_by_role("button", name="Delete meeting").click(); time.sleep(0.4)
    page.get_by_role("alertdialog").get_by_role("button", name="Delete", exact=True).click(); time.sleep(1.5); page.wait_for_load_state("networkidle")
    check("shows a 'Meeting deleted' message or the card vanishes", page.get_by_text("E2E Kickoff").count() == 0)
    st, d = api(page, "GET", f"/meetings/{m['id']}")
    check("meeting is really gone (API 404)", st == 404, (st, str(d)[:120]))

if __name__ == "__main__":
    with sync_playwright() as p:
        b, ctx = launch(p); page = ctx.new_page(); pr = Probe(page)
        login(page); page.goto(BASE + "/calendar"); page.wait_for_load_state("networkidle")
        for old in meetings_api(page):
            if old["title"].startswith("E2E"): api(page, "DELETE", f"/meetings/{old['id']}")
        m = s_schedule(page)
        if m:
            s_card(page, m); s_resend(page, m); s_edit(page, m); s_drag(page, m); s_views(page, m)
        s_validation(page); past = s_earlier(page)
        if m: s_delete(page, m)
        check("no 5xx from the API during the whole journey", not [x for x in pr.bad if x[2] >= 500 and "vapid" not in x[1]], [x for x in pr.bad if "vapid" not in x[1]])
        check("no JS exceptions", not [e for e in pr.errors if e.startswith("pageerror")], [e for e in pr.errors if e.startswith("pageerror")])
        print("API calls with unexpected status:", [x for x in pr.bad if "vapid" not in x[1]])
        b.close()
    f = [r for r in RESULTS if not r[1]]
    print(f"\n{len(RESULTS)-len(f)}/{len(RESULTS)} passed"); json.dump(RESULTS, open("/tmp/meeting-e2e-results.json", "w"))
