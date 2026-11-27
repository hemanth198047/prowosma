import json, re, time
from playwright.sync_api import sync_playwright, expect

BASE = "http://127.0.0.1:4173"
API = "http://localhost:9090/api"

class Probe:
    """Collects everything that would make a user say 'something went wrong'."""
    def __init__(self, page):
        self.errors, self.bad, self.reqs = [], [], []
        page.on("console", lambda m: self.errors.append(f"console.{m.type}: {m.text[:300]}") if m.type == "error" else None)
        page.on("pageerror", lambda e: self.errors.append(f"pageerror: {str(e)[:300]}"))
        def resp(r):
            if "/api/" in r.url:
                self.reqs.append((r.request.method, r.url, r.status))
                if r.status >= 500 or (r.status >= 400 and r.status not in (401, 403, 404, 409, 429)):
                    self.bad.append((r.request.method, r.url, r.status))
        page.on("response", resp)

def launch(p, mobile=False):
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = b.new_context(**({"viewport": {"width": 390, "height": 844}, "is_mobile": True, "has_touch": True} if mobile else {"viewport": {"width": 1440, "height": 900}}),
                        timezone_id="Asia/Kolkata")
    return b, ctx

def login(page, email="owner@test.com", pw="pass"):
    page.goto(BASE + "/login")
    page.get_by_placeholder(re.compile("you@company", re.I)).fill(email)
    page.locator("input[type=password]").first.fill(pw)
    page.get_by_role("button", name=re.compile("sign in|log in", re.I)).click()
    page.wait_for_url(re.compile(r"^(?!.*/login)"), timeout=20000)
    page.wait_for_load_state("networkidle")

import datetime
def next_weekday(n=1):
    d = datetime.date.today() + datetime.timedelta(days=n)
    while d.weekday() >= 5: d += datetime.timedelta(days=1)
    return d

def token_of(page):
    return page.evaluate("()=>localStorage.getItem('token')")

def ws_of(page):
    return page.evaluate("""()=>{for(const k of Object.keys(sessionStorage)){if(k.endsWith('__activeWorkspace')){try{return JSON.parse(sessionStorage.getItem(k)).id}catch(e){}}}return null}""")

def api(page, method, path, body=None, ws=None):
    ws = ws or ws_of(page)
    t = token_of(page)
    h = {"Authorization": "Bearer " + t, "Content-Type": "application/json"}
    if ws: h["X-Workspace-Id"] = ws
    r = page.request.fetch(API + path, method=method, headers=h, data=json.dumps(body) if body is not None else None)
    try: return r.status, r.json()
    except Exception: return r.status, r.text()

def schedule_ui(page, title, day, start="3:00 PM", end="3:45 PM", attendees=(), link="", agenda=""):
    page.get_by_role("button", name=re.compile("New meeting")).click()
    dlg = page.get_by_role("dialog")
    dlg.get_by_label("Title").fill(title)
    att = dlg.get_by_label("Invite attendees")
    for e in attendees: att.fill(e); att.press("Enter")
    dlg.get_by_label("Start date").fill(day.isoformat()); dlg.get_by_label("Start time").select_option(label=start)
    dlg.get_by_label("End date").fill(day.isoformat());   dlg.get_by_label("End time").select_option(label=end)
    if link: dlg.get_by_label("Location or meeting link").fill(link)
    if agenda: dlg.get_by_label("Agenda").fill(agenda)
    dlg.get_by_role("button", name="Save").click()
    page.wait_for_selector("text=Meeting scheduled", timeout=8000)
    page.wait_for_load_state("networkidle")
