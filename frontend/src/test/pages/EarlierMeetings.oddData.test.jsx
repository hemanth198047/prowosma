import { describe, it, expect, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";

const SETS = {
  sparse: [{ id: "1" }, { id: "2", title: null, attendees: null, meetingDate: null, actionItems: null, tags: null, decisions: null }],
  full: [{ id: "1", title: "Sprint", meetingDate: "2026-11-20T10:00:00", durationMins: 30, attendees: ["a@x.com"], createdBy: "a@x.com", location: "Room", notes: "n", actionItems: [{ id: "a", text: "t", done: false }], decisions: [], status: "SCHEDULED", projectId: "p1" }],
  unreadableDate: [{ id: "1", title: "Old meeting", meetingDate: "20/11/2026 10am", attendees: ["a@x.com"] }, { id: "2", title: "No date", meetingDate: "" }],
  weird: [{ id: "1", title: 5, meetingDate: "not-a-date", attendees: "a@x.com", actionItems: {}, durationMins: "x" }],
};
const cur = vi.hoisted(() => ({ k: "sparse" }));
vi.mock("../../api/client", () => {
  const answer = (url) => Promise.resolve({ data: String(url).startsWith("/meetings") && !String(url).includes("/meetings/") ? SETS_PROXY() : [], status: 200, headers: {} });
  return { default: { get: (u) => answer(u), post: () => answer(""), put: () => answer(""), patch: () => answer(""), delete: () => answer(""), interceptors: { request: { use() {} }, response: { use() {} } }, defaults: { headers: { common: {} } } },
    unwrapList: (r) => (Array.isArray(r?.data) ? r.data : []), unwrapPaged: () => ({ data: [] }), getToken: () => "t", invalidateCache() {}, clearAllCache() {}, subscribeToLoading: () => () => {}, getActiveRequestCount: () => 0, navigation: { toLogin() {} } };
});
globalThis.SETS_PROXY = () => SETS[cur.k];
vi.mock("axios", () => ({ default: { get: () => Promise.resolve({ data: [] }), post: () => Promise.resolve({ data: {} }) } }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1", name: "Sam", email: "a@x.com", role: "ADMIN" }, activeWorkspace: { id: "w1" }, workspaces: [] }) }));
vi.mock("recharts", () => { const B = ({ children }) => <div>{children}</div>; return { ResponsiveContainer: B, PieChart: B, Pie: B, Cell: B, Tooltip: B, Legend: B, BarChart: B, Bar: B, XAxis: B, YAxis: B, CartesianGrid: B, LineChart: B, Line: B }; });

class Boundary extends React.Component { constructor(p){super(p);this.state={e:null};} static getDerivedStateFromError(e){return {e};} componentDidCatch(){} render(){ return this.state.e ? <div data-testid="x">{String(this.state.e.message)}</div> : this.props.children; } }
import EarlierMeetings from "../../pages/EarlierMeetings";
/** "Earlier meetings" must open whatever the old meeting records contain: missing fields, wrong types, empty lists. */
describe("Earlier meetings with odd records", () => {
  for (const k of Object.keys(SETS)) for (const path of ["/meetings/earlier", "/meetings/earlier/assistant"]) it(`${path} survives the "${k}" records`, async () => {
    cur.k = k; globalThis.WebSocket = class { close(){} send(){} addEventListener(){} };
    window.matchMedia = window.matchMedia || ((q) => ({ matches: false, media: q, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){} }));
    const { queryByTestId } = render(<MemoryRouter initialEntries={[path]}><Boundary><EarlierMeetings /></Boundary></MemoryRouter>);
    await new Promise((r) => setTimeout(r, 300));
    expect(queryByTestId("x")?.textContent ?? null).toBeNull(); cleanup();
  });
});
