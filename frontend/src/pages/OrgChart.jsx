import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronDown, ChevronUp, Search, Minimize2, Maximize2 } from "lucide-react";
import PageHeader from "../components/PageHeader";
import PersonAvatar from "../components/people/PersonAvatar";
import { usePeople } from "../context/PeopleContext";
import { useRole } from "../hooks/useRole";
import { buildTree, managerChain, searchVisible, teamSize } from "../utils/org";
import "../styles/pages/org-chart.css";

const DEFAULT_DEPTH = 2;

function Node({ person, tree, expanded, toggle, visible, matches, focusId, depth }) {
  const kids = (tree.children.get(person.id) || []).filter((c) => !visible || visible.has(c.id));
  const open = visible ? true : expanded.has(person.id);
  const size = teamSize(person.id, tree.children);
  const depts = [person.department, ...(person.departments || [])].filter(Boolean);
  return (
    <li>
      <div
        className={`oc-node${matches?.has(person.id) ? " oc-hit" : ""}${focusId === person.id ? " oc-focus" : ""}`}
        id={`oc-${person.id}`}
      >
        <PersonAvatar person={person} size={40} showName subtitle={person.title || "—"} className="oc-person" />
        {depts[0] && <div className="oc-dept">{depts[0]}</div>}
        {kids.length > 0 && (
          <button
            type="button"
            className="oc-toggle"
            onClick={() => toggle(person.id)}
            aria-expanded={open}
            aria-label={`${open ? "Hide" : "Show"} ${person.name || "this person"}'s reports`}
          >
            {kids.length} direct{size > kids.length ? ` · ${size} total` : ""}
            {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        )}
      </div>
      {open && kids.length > 0 && (
        <ul>
          {kids.map((k) => (
            <Node key={k.id} person={k} tree={tree} expanded={expanded} toggle={toggle}
              visible={visible} matches={matches} focusId={focusId} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function OrgChart() {
  const { people, loaded, ensureLoaded } = usePeople();
  const { isAdmin } = useRole();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [focusId, setFocusId] = useState(null);
  const scrolled = useRef(null);

  useEffect(() => { ensureLoaded(); }, [ensureLoaded]);

  const tree = useMemo(() => buildTree(people), [people]);
  const placed = useMemo(() => tree.roots.filter((r) => (tree.children.get(r.id) || []).length > 0), [tree]);
  const unplaced = useMemo(() => tree.roots.filter((r) => !(tree.children.get(r.id) || []).length), [tree]);
  // With no reporting lines at all, show everyone as a flat directory instead of a single row.
  const flat = placed.length === 0;

  // Default: open the first DEFAULT_DEPTH levels.
  const defaultExpanded = useMemo(() => {
    const s = new Set();
    const walk = (p, d) => {
      if (d >= DEFAULT_DEPTH) return;
      s.add(p.id);
      (tree.children.get(p.id) || []).forEach((c) => walk(c, d + 1));
    };
    placed.forEach((r) => walk(r, 0));
    return s;
  }, [tree, placed]);
  const open = expanded || defaultExpanded;

  // ?focus=<id>: open the path to that person, highlight and scroll to them.
  const focusParam = params.get("focus");
  if (focusParam && loaded && tree.byId.has(focusParam) && focusId !== focusParam) {
    const next = new Set(open);
    managerChain(focusParam, tree.byId).forEach((m) => next.add(m.id));
    setExpanded(next);
    setFocusId(focusParam);
  }
  useEffect(() => {
    if (!focusId || scrolled.current === focusId) return;
    const el = document.getElementById(`oc-${focusId}`);
    if (el) {
      scrolled.current = focusId;
      el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      setParams((p) => { const n = new URLSearchParams(p); n.delete("focus"); return n; }, { replace: true });
    }
  });

  const search = useMemo(() => searchVisible(query, people, tree.byId), [query, people, tree.byId]);

  const toggle = (id) => setExpanded(() => {
    const n = new Set(open);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const expandAll = () => setExpanded(new Set(people.map((p) => p.id)));
  const collapseAll = () => setExpanded(new Set());

  const roots = search ? tree.roots.filter((r) => search.show.has(r.id)) : (flat ? tree.roots : placed);
  const matchCount = search?.matches.size ?? 0;

  return (
    <div className="oc-page">
      <PageHeader icon="🏢" title="Org chart" description="Who reports to whom. Hover or click anyone for their profile card." />

      <div className="oc-toolbar">
        <div className="oc-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            placeholder="Find a person, title or department"
            aria-label="Search the org chart"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {search && <span className="oc-count" aria-live="polite">{matchCount} match{matchCount === 1 ? "" : "es"}</span>}
        <div className="oc-toolbar-right">
          <span className="oc-count">{people.length} people</span>
          {!flat && !search && (
            <>
              <button type="button" className="btn btn-secondary oc-btn" onClick={expandAll}><Maximize2 size={14} /> Expand all</button>
              <button type="button" className="btn btn-secondary oc-btn" onClick={collapseAll}><Minimize2 size={14} /> Collapse</button>
            </>
          )}
        </div>
      </div>

      {!loaded ? (
        <div className="oc-empty">Loading the organisation…</div>
      ) : people.length === 0 ? (
        <div className="oc-empty">No people in this workspace yet.</div>
      ) : (
        <>
          {flat && !search && (
            <div className="oc-note">
              No reporting lines are set yet, so everyone is listed below.
              {isAdmin
                ? " To build the chart, open a person's card, choose Edit, and pick who they report to."
                : " A workspace admin can set who reports to whom."}
            </div>
          )}

          {roots.length === 0 ? (
            <div className="oc-empty">No one matches “{query}”.</div>
          ) : flat && !search ? (
            <div className="oc-grid">
              {roots.map((p) => (
                <div key={p.id} className="oc-node oc-node-flat" id={`oc-${p.id}`}>
                  <PersonAvatar person={p} size={40} showName subtitle={p.title || "—"} className="oc-person" />
                  {(p.department || p.departments?.[0]) && <div className="oc-dept">{p.department || p.departments[0]}</div>}
                </div>
              ))}
            </div>
          ) : (
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- scrollable region must be keyboard-scrollable
            <div className="oc-canvas" tabIndex={0} role="region" aria-label="Organisation tree">
              <ul className="oc-tree">
                {roots.map((r) => (
                  <Node key={r.id} person={r} tree={tree} expanded={open} toggle={toggle}
                    visible={search?.show} matches={search?.matches} focusId={focusId} depth={0} />
                ))}
              </ul>
            </div>
          )}

          {!flat && !search && unplaced.length > 0 && (
            <section className="oc-unplaced" aria-label="People not in the chart yet">
              <h3>Not in the chart yet <span>({unplaced.length})</span></h3>
              <p>{isAdmin ? "They have no manager and no reports. Open a card → Edit → “Reports to” to place them." : "They have no manager and no reports yet."}</p>
              <div className="oc-grid">
                {unplaced.map((p) => (
                  <div key={p.id} className="oc-node oc-node-flat" id={`oc-${p.id}`}>
                    <PersonAvatar person={p} size={36} showName subtitle={p.title || "—"} className="oc-person" />
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
