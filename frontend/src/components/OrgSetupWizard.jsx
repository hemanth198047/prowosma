import { useState } from "react";
import { useConfirm } from "../hooks/useConfirm";
import { apiErrorMessage } from "../utils/apiError";
import { runOrgSetup, updateAccessSettings } from "../api/access";
import {
  CAPABILITIES, SCOPES, DEPARTMENT_SUGGESTIONS, ROLE_SUGGESTIONS, QUICK_STARTS, PROJECT_VISIBILITY_CHOICES, DOC_MODE_CHOICES,
  MAX_NAME, MAX_ROLES, norm, isEmail, buildPlan, initialState, describeLevel,
} from "../config/orgSetupPresets";

const STEPS = ["Departments", "Access levels", "Project roles", "People", "Rules", "Review"];

const box = { border: "1px solid var(--gray-200, #e5e7eb)", borderRadius: 10, padding: 12, background: "var(--bg-card, transparent)" };
const muted = { opacity: 0.75, fontSize: 13 };

/** A pick-me chip. */
function Chip({ on, onClick, children, label }) {
  return (
    <button type="button" aria-pressed={on} aria-label={label} onClick={onClick}
      className={on ? "btn-primary" : "btn-secondary"} style={{ borderRadius: 999, padding: "4px 12px", fontSize: 13 }}>
      {on ? "✓ " : ""}{children}
    </button>
  );
}

function Choice({ name, value, current, onChange, title, hint, recommended }) {
  return (
    <label style={{ ...box, display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer", borderColor: current === value ? "var(--primary, #6366f1)" : undefined }}>
      <input type="radio" name={name} checked={current === value} onChange={() => onChange(value)} style={{ marginTop: 4 }} />
      <span>
        <strong>{title}</strong>{recommended && <span style={{ marginLeft: 8, fontSize: 12, color: "var(--primary, #6366f1)" }}>Recommended</span>}
        <span style={{ display: "block", ...muted }}>{hint}</span>
      </span>
    </label>
  );
}

/* ── Step 1: departments ─────────────────────────────────────── */
function DepartmentsStep({ s, set }) {
  const [custom, setCustom] = useState("");
  const has = (n) => s.departments.some((d) => norm(d) === norm(n));
  const toggle = (n) => set({ departments: has(n) ? s.departments.filter((d) => norm(d) !== norm(n)) : [...s.departments, n] });
  const addCustom = () => {
    const n = custom.trim();
    if (n && n.length <= MAX_NAME && !has(n)) set({ departments: [...s.departments, n] });
    setCustom("");
  };
  const quick = (q) => set({
    departments: [...s.departments, ...q.departments.filter((d) => !has(d))],
    roles: [...s.roles, ...q.roles.filter((r) => !s.roles.some((x) => norm(x) === norm(r)))],
  });
  const extras = s.departments.filter((d) => !DEPARTMENT_SUGGESTIONS.some((x) => norm(x) === norm(d)));
  return (
    <>
      <h3>Which departments does your company have?</h3>
      <p style={muted}>A department is a group of people who work together. People will see their own department's projects.</p>
      <p style={{ marginBottom: 4 }}><strong>Quick start</strong> — fills in the usual departments for you. You can change everything afterwards.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {QUICK_STARTS.map((q) => <button key={q.key} type="button" className="btn-secondary" onClick={() => quick(q)}>{q.title}</button>)}
      </div>
      <p style={{ marginBottom: 4 }}><strong>Tap to choose</strong></p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} role="group" aria-label="Departments">
        {[...DEPARTMENT_SUGGESTIONS, ...extras].map((d) => <Chip key={d} on={has(d)} onClick={() => toggle(d)}>{d}</Chip>)}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
        <label htmlFor="ow-dept-custom" style={{ ...muted }}>Not listed? Add your own</label>
        <input id="ow-dept-custom" value={custom} maxLength={MAX_NAME} placeholder="e.g. Research"
          onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } }} />
        <button type="button" className="btn-secondary" onClick={addCustom} disabled={!custom.trim()}>Add</button>
      </div>
      <p style={{ marginTop: 12 }}><strong>{s.departments.length}</strong> chosen</p>
    </>
  );
}

/* ── Step 2: access levels ───────────────────────────────────── */
function LevelCard({ level, onChange }) {
  const [open, setOpen] = useState(false);
  const toggleCap = (k) => onChange({ capabilities: level.capabilities.includes(k) ? level.capabilities.filter((c) => c !== k) : [...level.capabilities, k] });
  return (
    <div style={{ ...box, borderColor: level.selected ? "var(--primary, #6366f1)" : undefined }}>
      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
        <input type="checkbox" checked={level.selected} onChange={(e) => onChange({ selected: e.target.checked })} style={{ marginTop: 4 }} aria-label={`Use the ${level.name} level`} />
        <span>
          <strong>{level.name}</strong>
          <span style={{ display: "block", ...muted }}>{level.description}</span>
          <span style={{ display: "block", fontSize: 13, marginTop: 4 }}>{describeLevel(level)}</span>
        </span>
      </label>
      {level.selected && (
        <div style={{ marginTop: 8 }}>
          <button type="button" className="btn-secondary" aria-expanded={open} onClick={() => setOpen((v) => !v)} style={{ fontSize: 12 }}>
            {open ? "Hide changes" : "Change what this level can do"}
          </button>
          {open && (
            <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
              <label>Name <input value={level.name} maxLength={MAX_NAME} onChange={(e) => onChange({ name: e.target.value })} aria-label={`Name of the ${level.name} level`} /></label>
              <fieldset style={{ border: 0, padding: 0 }}>
                <legend><strong>What can they see?</strong></legend>
                {SCOPES.map((sc) => (
                  <label key={sc.key} style={{ display: "block" }}>
                    <input type="radio" name={`scope-${level.key}`} checked={level.scope === sc.key} onChange={() => onChange({ scope: sc.key, departmentAdmin: sc.key === "MY_DEPARTMENTS" ? level.departmentAdmin : false })} /> {sc.label}
                  </label>
                ))}
              </fieldset>
              {level.scope === "MY_DEPARTMENTS" && (
                <label><input type="checkbox" checked={!!level.departmentAdmin} onChange={(e) => onChange({ departmentAdmin: e.target.checked })} /> Can decide who else sees their departments' projects and documents</label>
              )}
              <fieldset style={{ border: 0, padding: 0 }}>
                <legend><strong>What can they do?</strong></legend>
                {CAPABILITIES.map((c) => (
                  <label key={c.key} style={{ display: "block" }}>
                    <input type="checkbox" checked={level.capabilities.includes(c.key)} onChange={() => toggleCap(c.key)} /> {c.label}
                  </label>
                ))}
              </fieldset>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LevelsStep({ s, set }) {
  const update = (i, patch) => set({ levels: s.levels.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const addOwn = () => set({ levels: [...s.levels, { key: `own-${Date.now()}`, name: "New access level", description: "", scope: "MY_DEPARTMENTS", departmentAdmin: false, capabilities: ["CREATE_TASK"], selected: true, existing: false }] });
  return (
    <>
      <h3>How much should different people be able to see and do?</h3>
      <p style={muted}>An access level is a ready-made set of permissions you give to people in the next step. Tick the ones you want. The ticked ones are what most companies use.</p>
      <p style={muted}>The workspace owner and admins are never limited — they always see everything.</p>
      <div style={{ display: "grid", gap: 8 }}>
        {s.levels.map((l, i) => <LevelCard key={l.key} level={l} onChange={(p) => update(i, p)} />)}
      </div>
      <button type="button" className="btn-secondary" style={{ marginTop: 8 }} onClick={addOwn}>+ Add another access level</button>
    </>
  );
}

/* ── Step 3: project roles ───────────────────────────────────── */
function RolesStep({ s, set }) {
  const [custom, setCustom] = useState("");
  const has = (n) => s.roles.some((r) => norm(r) === norm(n));
  const toggle = (n) => set({ roles: has(n) ? s.roles.filter((r) => norm(r) !== norm(n)) : [...s.roles, n] });
  const add = () => { const n = custom.trim(); if (n && n.length <= MAX_NAME && !has(n) && s.roles.length < MAX_ROLES) set({ roles: [...s.roles, n] }); setCustom(""); };
  const extras = s.roles.filter((r) => !ROLE_SUGGESTIONS.some((x) => norm(x) === norm(r)));
  return (
    <>
      <h3>Who is responsible for what on a project?</h3>
      <p style={muted}>
        Optional. These become named positions on every project (for example "Client owner"), so the right person can be attached to each project and always sees it, whatever their department.
        You can skip this and add them later.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} role="group" aria-label="Project roles">
        {[...ROLE_SUGGESTIONS, ...extras].map((r) => <Chip key={r} on={has(r)} onClick={() => toggle(r)}>{r}</Chip>)}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
        <label htmlFor="ow-role-custom" style={muted}>Add your own</label>
        <input id="ow-role-custom" value={custom} maxLength={MAX_NAME} placeholder="e.g. Quality checker"
          onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <button type="button" className="btn-secondary" onClick={add} disabled={!custom.trim()}>Add</button>
      </div>
    </>
  );
}

/* ── Step 4: people ──────────────────────────────────────────── */
function PeopleStep({ s, set }) {
  const levels = s.levels.filter((l) => l.selected);
  const update = (i, patch) => set({ people: s.people.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const toggleDept = (i, d) => { const p = s.people[i]; update(i, { departments: p.departments.includes(d) ? p.departments.filter((x) => x !== d) : [...p.departments, d] }); };
  const addPerson = () => set({ people: [...s.people, { name: "", email: "", designation: "", level: "", departments: [], role: "MEMBER", existing: false, locked: false }] });
  const remove = (i) => set({ people: s.people.filter((_, j) => j !== i) });
  const defaultText = s.defaultLevel ? `Use the default (${s.defaultLevel})` : "No access level yet";
  return (
    <>
      <h3>Who works with you, and what should each person get?</h3>
      <p style={muted}>For each person choose an access level and their department(s). Their job title is optional. People you leave on the default get the level chosen in the next step.</p>
      <div style={{ display: "grid", gap: 8 }}>
        {s.people.length === 0 && <p style={muted}>Nobody to show yet. Add people below.</p>}
        {s.people.map((p, i) => (
          <div key={p.id || `new-${i}`} style={box}>
            {p.locked ? (
              <p style={{ margin: 0 }}><strong>{p.name || p.email}</strong> <span style={muted}>— {p.role === "OWNER" ? "Owner" : "Admin"}: sees everything, nothing to set.</span></p>
            ) : (
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  {p.existing ? <strong>{p.name || p.email} <span style={muted}>{p.name ? p.email : ""}</span></strong> : (
                    <>
                      <input value={p.name} placeholder="Name" aria-label={`Name of person ${i + 1}`} onChange={(e) => update(i, { name: e.target.value })} />
                      <input value={p.email} type="email" placeholder="Work email" aria-label={`Work email of person ${i + 1}`} onChange={(e) => update(i, { email: e.target.value })} />
                      <button type="button" className="btn-secondary" onClick={() => remove(i)} aria-label={`Remove person ${i + 1}`}>✕</button>
                    </>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <input value={p.designation} placeholder="Job title (optional)" aria-label={`Job title of ${p.name || p.email || `person ${i + 1}`}`} onChange={(e) => update(i, { designation: e.target.value })} />
                  <select value={p.level} aria-label={`Access level of ${p.name || p.email || `person ${i + 1}`}`} onChange={(e) => update(i, { level: e.target.value })}>
                    <option value="">{defaultText}</option>
                    {levels.map((l) => <option key={l.key} value={l.name}>{l.name}</option>)}
                  </select>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} role="group" aria-label={`Departments of ${p.name || p.email || `person ${i + 1}`}`}>
                  {s.departments.map((d) => <Chip key={d} on={p.departments.includes(d)} onClick={() => toggleDept(i, d)}>{d}</Chip>)}
                </div>
                {!p.existing && p.email && !isEmail(p.email) && <span role="alert" style={{ color: "var(--danger)", fontSize: 13 }}>That email doesn't look right.</span>}
              </div>
            )}
          </div>
        ))}
      </div>
      <button type="button" className="btn-secondary" style={{ marginTop: 8 }} onClick={addPerson}>+ Add someone who isn't in the workspace yet</button>
    </>
  );
}

/* ── Step 5: rules ───────────────────────────────────────────── */
function RulesStep({ s, set }) {
  const levels = s.levels.filter((l) => l.selected);
  return (
    <>
      <h3>A few simple rules</h3>
      <p style={muted}>We've picked the usual answers. Change any you like.</p>
      <fieldset style={{ border: 0, padding: 0, display: "grid", gap: 8 }}>
        <legend><strong>Who should see a new project?</strong></legend>
        {PROJECT_VISIBILITY_CHOICES.map((c) => <Choice key={c.key} name="vis" value={c.key} current={s.projectVisibility} onChange={(v) => set({ projectVisibility: v })} {...c} />)}
      </fieldset>
      <fieldset style={{ border: 0, padding: 0, display: "grid", gap: 8, marginTop: 12 }}>
        <legend><strong>Who should see a document?</strong></legend>
        {DOC_MODE_CHOICES.map((c) => <Choice key={c.key} name="doc" value={c.key} current={s.docMode} onChange={(v) => set({ docMode: v })} {...c} />)}
      </fieldset>
      <div style={{ marginTop: 12 }}>
        <label htmlFor="ow-default-level"><strong>If you don't pick an access level for someone, what should they get?</strong></label>
        <div style={muted}>We suggest the most limited level — it is safer to give more later than to take back.</div>
        <select id="ow-default-level" value={s.defaultLevel} onChange={(e) => set({ defaultLevel: e.target.value })}>
          <option value="">Nothing special (they keep seeing everything)</option>
          {levels.map((l) => <option key={l.key} value={l.name}>{l.name}</option>)}
        </select>
      </div>
    </>
  );
}

/* ── Step 6: review ──────────────────────────────────────────── */
function ReviewStep({ s, plan, preview, previewing, error, invite, setInvite, newPeople }) {
  const people = plan.members.length;
  return (
    <>
      <h3>Check everything, then set it up</h3>
      <p style={muted}>Nothing has been changed yet. This is what will happen.</p>
      <div style={{ ...box, display: "flex", gap: 20, flexWrap: "wrap" }} aria-label="Summary">
        <span><strong>{plan.departments.length}</strong> departments</span>
        <span><strong>{plan.profiles.length}</strong> access levels</span>
        <span><strong>{plan.roleSlots.length}</strong> project roles</span>
        <span><strong>{people}</strong> people</span>
      </div>
      {newPeople > 0 && (
        <label style={{ display: "block", margin: "10px 0" }}>
          <input type="checkbox" checked={invite} onChange={(e) => setInvite(e.target.checked)} /> Email an invitation to the {newPeople} {newPeople === 1 ? "person" : "people"} who aren't in the workspace yet
        </label>
      )}
      {previewing && <p role="status">Checking…</p>}
      {error && <p role="alert" style={{ color: "var(--danger)" }}>{error}</p>}
      {preview && !previewing && (
        <div role="status" style={{ marginTop: 8 }}>
          {(preview.warnings || []).length > 0 && (
            <>
              <strong>Needs your attention</strong>
              <ul>{preview.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </>
          )}
          <strong>What will be done</strong>
          <ul>{(preview.actions || []).map((a) => <li key={a}>{a}</li>)}</ul>
        </div>
      )}
      <p style={muted}>Setting this up does not limit anyone yet. You'll be asked whether to switch it on once you've looked it over. Nothing already set up is deleted.</p>
    </>
  );
}

/* ── The wizard ──────────────────────────────────────────────── */
export default function OrgSetupWizard({ profiles, departments, members, settings, reload, notify, onOpenOverview }) {
  const confirm = useConfirm();
  const [s, setS] = useState(() => initialState({ profiles, departments, members, settings }));
  const [step, setStep] = useState(0);
  const [invite, setInvite] = useState(true);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  // Keep everything consistent when something upstream is removed (a department or level that is no longer chosen).
  const set = (patch) => setS((cur) => {
    const next = { ...cur, ...patch };
    const depts = new Set(next.departments);
    const levelNames = new Set(next.levels.filter((l) => l.selected).map((l) => l.name));
    next.people = next.people.map((p) => ({ ...p, departments: p.departments.filter((d) => depts.has(d)), level: p.level && !levelNames.has(p.level) ? "" : p.level }));
    if (next.defaultLevel && !levelNames.has(next.defaultLevel)) next.defaultLevel = "";
    return next;
  });

  const plan = buildPlan(s);
  const newPeople = s.people.filter((p) => !p.locked && !p.existing && isEmail(p.email)).length;

  // Why "Next" is unavailable, in plain words.
  const reason = (() => {
    if (step === 0 && s.departments.length === 0) return "Choose at least one department to continue.";
    if (step === 1) {
      const chosen = s.levels.filter((l) => l.selected);
      if (chosen.length === 0) return "Tick at least one access level to continue.";
      const names = chosen.map((l) => norm(l.name));
      if (chosen.some((l) => !l.name.trim())) return "Every access level needs a name.";
      if (new Set(names).size !== names.length) return "Two access levels have the same name. Give each its own name.";
    }
    if (step === 3) {
      const added = s.people.filter((p) => !p.existing);
      if (added.some((p) => (p.name || p.email) && !isEmail(p.email))) return "Fix or remove the people whose email isn't valid.";
      const emails = s.people.filter((p) => isEmail(p.email)).map((p) => norm(p.email));
      if (new Set(emails).size !== emails.length) return "The same email appears twice.";
    }
    return "";
  })();

  const runPreview = async (inviteNow) => {
    setError(""); setPreviewing(true); setPreview(null);
    try { setPreview((await runOrgSetup(buildPlan(s), { dryRun: true, sendInvitations: inviteNow })).data); }
    catch (e) { setError(apiErrorMessage(e, "We couldn't check this setup. Go back and review your choices.")); }
    finally { setPreviewing(false); }
  };
  const go = (n) => { setStep(n); if (n === STEPS.length - 1) runPreview(invite); };
  const changeInvite = (v) => { setInvite(v); runPreview(v); };

  const apply = async () => {
    setBusy(true); setError("");
    try {
      await runOrgSetup(plan, { dryRun: false, sendInvitations: invite });
      notify("Your organisation is set up", "success");
      setDone(true);
      reload();
    } catch (e) { setError(apiErrorMessage(e, "Setting up failed. Nothing was half-applied that you need to undo — try again.")); }
    finally { setBusy(false); }
  };

  const turnOn = async () => {
    const ok = await confirm({
      title: "Switch on department access?",
      message: "From now on, people with a department or assigned-work level see only what that level allows. Owners and admins still see everything. You can switch it off again at any time.",
      confirmText: "Switch it on",
    });
    if (!ok) return;
    try { await updateAccessSettings({ accessControlEnabled: true }); notify("Department access is on", "success"); reload(); }
    catch (e) { notify(apiErrorMessage(e, "Could not switch it on"), "error"); }
  };

  if (done) {
    return (
      <section aria-label="Organisation setup" role="status">
        <h3>✓ Your organisation is set up</h3>
        <p>Your departments, access levels and people are saved. <strong>Nobody is limited yet</strong> — everyone still sees everything until you switch department access on.</p>
        <p>Before you switch it on, make sure your existing projects and documents say who can see them. The Overview tab shows you what's left to do.</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn-primary" onClick={turnOn}>Switch department access on now</button>
          <button type="button" className="btn-secondary" onClick={onOpenOverview}>Go to the Overview</button>
          <button type="button" className="btn-secondary" onClick={() => { setDone(false); setStep(0); }}>Change something</button>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Organisation setup">
      <ol aria-label="Steps" style={{ display: "flex", gap: 8, flexWrap: "wrap", listStyle: "none", padding: 0, margin: "0 0 12px" }}>
        {STEPS.map((label, i) => (
          <li key={label} aria-current={i === step ? "step" : undefined}
            style={{ padding: "4px 10px", borderRadius: 999, fontSize: 13, background: i === step ? "var(--primary, #6366f1)" : "var(--gray-100, #f3f4f6)", color: i === step ? "#fff" : undefined, opacity: i > step ? 0.6 : 1 }}>
            {i + 1}. {label}
          </li>
        ))}
      </ol>

      {step === 0 && <DepartmentsStep s={s} set={set} />}
      {step === 1 && <LevelsStep s={s} set={set} />}
      {step === 2 && <RolesStep s={s} set={set} />}
      {step === 3 && <PeopleStep s={s} set={set} />}
      {step === 4 && <RulesStep s={s} set={set} />}
      {step === 5 && <ReviewStep s={s} plan={plan} preview={preview} previewing={previewing} error={error} invite={invite} setInvite={changeInvite} newPeople={newPeople} />}

      {reason && <p role="alert" style={{ color: "var(--danger)", marginTop: 12 }}>{reason}</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        {step > 0 && <button type="button" className="btn-secondary" onClick={() => go(step - 1)}>← Back</button>}
        {step < STEPS.length - 1 && <button type="button" className="btn-primary" disabled={!!reason} onClick={() => go(step + 1)}>Next →</button>}
        {step === STEPS.length - 1 && <button type="button" className="btn-primary" disabled={busy || previewing || !!error || !preview} onClick={apply}>{busy ? "Setting up…" : "Set up my organisation"}</button>}
      </div>
    </section>
  );
}

