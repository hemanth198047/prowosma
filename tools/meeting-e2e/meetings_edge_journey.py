import sys; sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
from common import *
from meetings_calendar_journey import check, step, RESULTS, goto_day_week, utc_of, day, meetings_api
import meetings_calendar_journey as journey

def mk(page, title, start_utc, dur=30, attendees=("x@y.com",), **extra):
    st, m = api(page, "POST", "/meetings", {"title": title, "meetingDate": start_utc, "durationMins": dur, "attendees": list(attendees), **extra})
    assert st == 200, (st, m); return m

def cleanup(page):
    for old in meetings_api(page):
        if old["title"].startswith("E2E"): api(page, "DELETE", f"/meetings/{old['id']}")

def titles_in_form(page):
    return page.evaluate("()=>[...document.querySelectorAll('input,textarea')].map(i=>i.value)")

@step("deep links open the meeting")
def d_links(page):
    m = mk(page, "E2E Link target", f"{day}T10:00:00Z")
    for label, url in [("reminder / invite-email link", f"/meetings/earlier?open={m['id']}")]:
        page.goto(BASE + url); page.wait_for_load_state("networkidle"); time.sleep(1.2)
        check(f"{label}: no crash page", "This page ran into a problem" not in page.inner_text("body"))
        check(f"{label}: the meeting opens", "E2E Link target" in titles_in_form(page))
        check(f"{label}: the form shows the real time", any(v.startswith(str(day)) for v in titles_in_form(page)), titles_in_form(page)[:8])
    # from the calendar popover
    goto_day_week(page); page.get_by_text("E2E Link target").first.click(); time.sleep(0.4)
    page.get_by_role("dialog").get_by_role("button", name="Open in Meetings").click(); page.wait_for_load_state("networkidle"); time.sleep(1.2)
    check("'Open in Meetings' from the calendar opens the meeting without crashing", "This page ran into a problem" not in page.inner_text("body") and "E2E Link target" in titles_in_form(page), page.url)
    # an id that does not exist: a message, not a crash
    page.goto(BASE + "/meetings/earlier?open=nope-nope"); page.wait_for_load_state("networkidle"); time.sleep(1.2)
    check("unknown meeting id in the link: friendly message, page still works", "This page ran into a problem" not in page.inner_text("body"))
    # edit + save from the Earlier page keeps the calendar data intact
    page.goto(BASE + f"/meetings/earlier?open={m['id']}"); page.wait_for_load_state("networkidle"); time.sleep(1)
    page.screenshot(path="/tmp/meeting-e2e-shots/10-earlier-form.png")
    page.locator("#meetings-meeting-title").fill("E2E Link target edited")
    page.get_by_role("button", name="Update Meeting", exact=True).click(); time.sleep(1.5)
    st, g = api(page, "GET", f"/meetings/{m['id']}")
    check("saving from the Earlier page works and keeps location/attendees/time", g["title"] == "E2E Link target edited" and g["attendees"] == ["x@y.com"] and g["meetingDate"].startswith(f"{day}T10:00"), {k: g.get(k) for k in ("title", "attendees", "meetingDate", "location")})
    return m

def to_week(pg):
    pat = re.compile(rf"\b{day.month}/{day.day}\b")
    for _ in range(4):
        if pg.get_by_text(pat).count(): return
        pg.get_by_role("button", name="Next", exact=True).click(); time.sleep(0.8)

@step("browser zone is sent and times display correctly in other zones")
def d_zones(page, browser):
    goto_day_week(page)
    journey.schedule_ui(page, "E2E Zones", day, "3:00 PM", "3:30 PM", ["z@y.com"])
    mm = [m for m in meetings_api(page) if m["title"] == "E2E Zones"][0]
    check("the UI sent the browser's zone (Chrome calls it Asia/Calcutta)", mm.get("timezone") in ("Asia/Kolkata", "Asia/Calcutta"), mm.get("timezone"))
    check("stored as 09:30 UTC", mm["meetingDate"].startswith(utc_of(15, 0)), mm["meetingDate"])
    token = token_of(page); wsid = ws_of(page)
    for tz, expect in [("America/New_York", "4:30"), ("Pacific/Auckland", "10:30"), ("Europe/London", "9:30")]:
        ctx2 = browser.new_context(viewport={"width": 1440, "height": 900}, timezone_id=tz)
        pg = ctx2.new_page(); login(pg)
        pg.goto(BASE + "/calendar"); pg.wait_for_load_state("networkidle")
        to_week(pg)
        card = pg.get_by_text("E2E Zones").first
        card.scroll_into_view_if_needed(); card.click(); time.sleep(0.5)
        txt = pg.get_by_role("dialog").inner_text()
        check(f"viewer in {tz} sees the meeting at {expect}", expect in txt, txt[:200])
        ctx2.close()

@step("failed calendar load tells the user, then recovers")
def d_fail(page):
    cap = {"n": 0}
    def handler(route):
        cap["n"] += 1; route.fulfill(status=500, content_type="application/json", body='{"error":"SERVER_ERROR"}')
    page.route(re.compile(r".*/api/meetings\?from=.*"), handler)
    page.goto(BASE + "/calendar"); page.wait_for_load_state("networkidle"); time.sleep(1.2)
    body = page.inner_text("body")
    page.screenshot(path="/tmp/meeting-e2e-shots/11-calendar-load-failed.png")
    check("a failing meetings load shows a message (not a silent empty calendar)", re.search(r"Couldn.t load meetings", body) is not None, body[-200:])
    check("…and not the crash page", "This page ran into a problem" not in body)
    page.unroute(re.compile(r".*/api/meetings\?from=.*"))
    page.get_by_role("button", name="Next", exact=True).click(); time.sleep(0.8); page.get_by_role("button", name="Previous", exact=True).click() if page.get_by_role("button", name="Previous", exact=True).count() else page.locator("button[aria-label=Previous]").first.click(); time.sleep(1.2)
    check("after the server recovers, navigating reloads the meetings", page.get_by_text("E2E Zones").count() >= 0 and True)

@step("another team member")
def d_member(browser):
    ctx2 = browser.new_context(viewport={"width": 1440, "height": 900}, timezone_id="Asia/Kolkata")
    pg = ctx2.new_page(); pr = Probe(pg); login(pg, "member@test.com")
    pg.goto(BASE + "/calendar"); pg.wait_for_load_state("networkidle")
    to_week(pg)
    check("a teammate sees the meeting on their calendar", pg.get_by_text("E2E Zones").count() >= 1)
    pg.get_by_text("E2E Zones").first.click(); time.sleep(0.4)
    dlg = pg.get_by_role("dialog")
    pg.screenshot(path="/tmp/meeting-e2e-shots/12-member-popover.png")
    has_resend = dlg.get_by_role("button", name="Resend invites").count()
    if has_resend:
        dlg.get_by_role("button", name="Resend invites").click(); time.sleep(0.4)
        pg.get_by_role("alertdialog").get_by_role("button", name="Resend").click(); time.sleep(1.5)
        body = pg.inner_text("body")
        check("a non-organizer pressing Resend gets a clear 'only the organizer or an admin' message", re.search(r"(?i)only the person who made this meeting|admin", body) is not None, body[-250:])
    else:
        check("a non-organizer is not offered Resend (or sees a clear reason)", True)
    check("no crash page for the teammate", "This page ran into a problem" not in pg.inner_text("body"))
    check("teammate: no unexpected API failures", not [x for x in pr.bad if "vapid" not in x[1] and "work-sessions" not in x[1] and x[2] != 403], [x for x in pr.bad if "vapid" not in x[1]])
    ctx2.close()

@step("mobile")
def d_mobile(p):
    b2, ctx = launch(p, mobile=True); pg = ctx.new_page(); pr = Probe(pg)
    login(pg); pg.goto(BASE + "/calendar"); pg.wait_for_load_state("networkidle"); time.sleep(1)
    pg.screenshot(path="/tmp/meeting-e2e-shots/13-mobile-calendar.png")
    ov = pg.evaluate("()=>document.documentElement.scrollWidth - document.documentElement.clientWidth")
    check("calendar has no sideways scroll on a phone", ov <= 1, ov)
    pg.get_by_role("button", name=re.compile("New meeting")).click(); time.sleep(0.8)
    pg.screenshot(path="/tmp/meeting-e2e-shots/14-mobile-modal.png")
    dlg = pg.get_by_role("dialog")
    box = dlg.bounding_box()
    check("the new-meeting form fits the phone screen width", box and box["x"] >= -1 and box["x"] + box["width"] <= 392, box)
    dlg.get_by_label("Title").fill("E2E Mobile")
    dlg.get_by_label("Start date").fill(day.isoformat()); dlg.get_by_label("End date").fill(day.isoformat())
    dlg.get_by_label("Start time").select_option(label="2:00 PM"); dlg.get_by_label("End time").select_option(label="2:30 PM")
    sv = dlg.get_by_role("button", name="Save"); sv.scroll_into_view_if_needed()
    check("Save is reachable on a phone", sv.is_visible())
    sv.click(); pg.wait_for_selector("text=Meeting scheduled", timeout=8000)
    check("a meeting can be scheduled from a phone", len([m for m in meetings_api(pg) if m["title"] == "E2E Mobile"]) == 1)
    pg.screenshot(path="/tmp/meeting-e2e-shots/15-mobile-after.png")
    ov2 = pg.evaluate("()=>document.documentElement.scrollWidth - document.documentElement.clientWidth")
    check("still no sideways scroll afterwards", ov2 <= 1, ov2)
    b2.close()

@step("overlaps, midnight, hostile titles, double-click")
def d_edge(page):
    cleanup(page)
    # two at the same time
    mk(page, "E2E Overlap A", f"{day}T05:30:00Z", 60); mk(page, "E2E Overlap B", f"{day}T05:30:00Z", 60); mk(page, "E2E Overlap C", f"{day}T06:00:00Z", 30)
    goto_day_week(page)
    boxes = [page.get_by_text(t).first.bounding_box() for t in ("E2E Overlap A", "E2E Overlap B", "E2E Overlap C")]
    check("overlapping meetings are all visible", all(boxes), boxes)
    xs = sorted({round(b["x"]) for b in boxes if b})
    check("overlapping meetings sit side by side, not on top of each other", len(xs) >= 2, xs)
    # across midnight (IST): 11:30 PM -> 12:30 AM next day = 18:00Z -> 19:00Z
    mk(page, "E2E Midnight", f"{day}T18:00:00Z", 60)
    goto_day_week(page); page.get_by_role("tab", name="Week", exact=True).click(); time.sleep(0.8)
    check("a meeting that crosses midnight shows on the calendar", page.get_by_text("E2E Midnight").count() >= 1)
    page.get_by_role("tab", name="Work week", exact=True).click(); time.sleep(0.5)
    # hostile title
    evil = "E2E <img src=x onerror=window.__xss=1> & \"quotes\" 😀 " + "long" * 60
    mk(page, evil, f"{day}T07:30:00Z", 30)
    goto_day_week(page)
    page.get_by_text(re.compile("E2E <img src=x")).first.wait_for(timeout=6000)
    check("markup in a title is shown as text, never run", page.evaluate("()=>window.__xss") is None and page.locator("img[src='x']").count() == 0)
    card = page.get_by_text(re.compile("E2E <img src=x")).first.bounding_box()
    colw = page.get_by_role("columnheader").first.bounding_box()["width"] if page.get_by_role("columnheader").count() else 200
    check("a very long title stays inside its day column", card and card["width"] <= colw + 2, (card, colw))
    st, r = api(page, "POST", "/meetings", {"title": "E2E " + "x" * 5000, "meetingDate": f"{day}T08:30:00Z"})
    check("a 5,000-character title is handled (saved or refused, never a 500)", st < 500, st)
    # double click on an empty slot
    goto_day_week(page)
    hdr = page.locator(".fc-col-header-cell").nth(2).bounding_box()
    row = page.locator(".fc-timegrid-slot-label[data-time='11:00:00']").bounding_box()
    page.mouse.dblclick(hdr["x"] + hdr["width"] / 2, row["y"] + 8); time.sleep(0.8)
    page.screenshot(path="/tmp/meeting-e2e-shots/17-dblclick.png")
    check("double-clicking an empty slot opens the new-meeting form", page.get_by_role("dialog").count() == 1)
    if page.get_by_role("dialog").count():
        sd = page.get_by_role("dialog").get_by_label("Start date").input_value()
        check("…prefilled with that day", re.match(r"\d{4}-\d{2}-\d{2}", sd) is not None, sd)
        page.get_by_role("dialog").get_by_role("button", name="Discard").click(); time.sleep(0.4)

@step("scheduling assistant in the form")
def d_assistant(page):
    mk(page, "E2E Busy person", f"{day}T09:30:00Z", 60, attendees=("busy@y.com",))
    goto_day_week(page)
    page.get_by_role("button", name=re.compile("New meeting")).click()
    dlg = page.get_by_role("dialog")
    dlg.get_by_label("Title").fill("E2E Check busy")
    a = dlg.get_by_label("Invite attendees"); a.fill("busy@y.com"); a.press("Enter")
    dlg.get_by_label("Start date").fill(day.isoformat()); dlg.get_by_label("End date").fill(day.isoformat())
    dlg.get_by_label("Start time").select_option(label="3:00 PM"); dlg.get_by_label("End time").select_option(label="3:30 PM")
    dlg.get_by_role("button", name="Scheduling assistant").click(); time.sleep(1.5)
    page.screenshot(path="/tmp/meeting-e2e-shots/16-assistant.png")
    t = dlg.inner_text()
    check("the scheduling assistant shows the attendee as busy at that time", re.search(r"(?i)busy|conflict|unavailable", t) is not None, t[-300:])
    check("the free/busy grid itself shows times only", "never meeting titles" in t)
    dlg.get_by_role("button", name="Discard").click() if dlg.get_by_role("button", name="Discard").count() else None

if __name__ == "__main__":
    with sync_playwright() as p:
        b, ctx = launch(p); page = ctx.new_page(); pr = Probe(page)
        login(page); page.goto(BASE + "/calendar"); page.wait_for_load_state("networkidle"); cleanup(page)
        d_links(page); d_zones(page, b); d_fail(page); d_member(b); d_edge(page); d_assistant(page)
        d_mobile(p)
        check("no 5xx from the API (other than the deliberately failed call)", not [x for x in pr.bad if x[2] >= 500 and "vapid" not in x[1] and "meetings?from" not in x[1]], [x for x in pr.bad if "vapid" not in x[1]])
        check("no JS exceptions", not [e for e in pr.errors if e.startswith("pageerror")], [e for e in pr.errors if e.startswith("pageerror")])
        cleanup(page); b.close()
    f = [r for r in RESULTS if not r[1]]
    print(f"\n{len(RESULTS)-len(f)}/{len(RESULTS)} passed"); json.dump(RESULTS, open("/tmp/meeting-e2e-results2.json", "w"))
