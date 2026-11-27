import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";

/**
 * Every page must survive what a real server sometimes sends: an empty answer, an object where a list was expected, a plain error
 * (rate-limited, server down) — none of that may blank the whole app with "Something went wrong".
 */
const mode = vi.hoisted(() => ({ current: "empty-list" }));
const answer = () => {
  switch (mode.current) {
    case "empty-list": return Promise.resolve({ data: [], status: 200, headers: {} });
    case "empty-object": return Promise.resolve({ data: {}, status: 200, headers: {} });
    case "null": return Promise.resolve({ data: null, status: 200, headers: {} });
    case "error-object": return Promise.resolve({ data: { error: "Too many requests", retryAfterSeconds: 60 }, status: 200, headers: {} });
    case "string": return Promise.resolve({ data: "oops", status: 200, headers: {} });
    default: return Promise.reject(Object.assign(new Error("Request failed with status code 429"), { response: { status: 429, data: { error: "Too many requests" } } }));
  }
};
vi.mock("../../api/client", () => {
  const c = { get: (...a) => answer(a), post: () => answer(), put: () => answer(), patch: () => answer(), delete: () => answer(),
    interceptors: { request: { use() {} }, response: { use() {} } }, defaults: { headers: { common: {} } } };
  const unwrapList = (r) => { const d = r?.data; return Array.isArray(d) ? d : Array.isArray(d?.data) ? d.data : Array.isArray(d?.content) ? d.content : []; };
  return { default: c, unwrapList, unwrapPaged: (r) => ({ data: unwrapList(r), page: 0, totalPages: 0, totalElements: 0, hasNext: false }),
    getToken: () => "t", invalidateCache() {}, clearAllCache() {}, subscribeToLoading: () => () => {}, getActiveRequestCount: () => 0, navigation: { toLogin() {} } };
});
vi.mock("axios", () => ({ default: { get: () => answer(), post: () => answer(), put: () => answer(), create: () => ({ get: () => answer(), post: () => answer() }), isAxiosError: () => false } }));
vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => ({ loginWithRedirect: vi.fn(), isAuthenticated: false, isLoading: false, getAccessTokenSilently: vi.fn() }), Auth0Provider: ({ children }) => children }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({
  user: { id: "u1", name: "Sam Lee", email: "sam@acme.com", role: "ADMIN" }, loading: false, loginUser: vi.fn(), logoutUser: vi.fn(),
  activeWorkspace: { id: "w1", name: "Acme", role: "OWNER" }, setActiveWorkspace: vi.fn(), workspaces: [] }) }));
vi.mock("recharts", () => {
  const Box = ({ children }) => <div>{children}</div>;
  const names = ["ResponsiveContainer", "PieChart", "Pie", "Cell", "Tooltip", "Legend", "BarChart", "Bar", "LineChart", "Line", "AreaChart", "Area", "XAxis", "YAxis",
    "CartesianGrid", "RadarChart", "Radar", "PolarGrid", "PolarAngleAxis", "PolarRadiusAxis", "ComposedChart", "ScatterChart", "Scatter", "ReferenceLine", "Funnel", "FunnelChart", "Treemap", "RadialBarChart", "RadialBar", "LabelList", "Brush", "ZAxis", "ReferenceArea", "Label"];
  return Object.fromEntries(names.map((n) => [n, Box]));
});

class Boundary extends React.Component {
  constructor(p) { super(p); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch() { /* swallowed: the test reads state */ }
  render() { return this.state.error ? <div data-testid="crashed">{String(this.state.error?.message || this.state.error)}</div> : this.props.children; }
}

const modules = import.meta.glob("../../pages/*.jsx");
// Pages that only make sense mid-redirect (they need a real browser URL / third party) are checked by their own tests.
const SKIP = new Set(["TaskComments", "Auth0Callback", "GoogleMeetCallback", "AiMeetingGoogleCallback", "MagicLogin", "AcceptInvite", "Login"]);
// ("string" = an HTML page instead of data is stopped earlier, in api/client.js, and tested there.)
const MODES = ["empty-list", "empty-object", "null", "error-object", "rejected"];

describe("no page blanks the app", () => {
  const original = { error: console.error, warn: console.warn, log: console.log };
  beforeEach(() => {
    console.error = () => {}; console.warn = () => {}; console.log = () => {};
    globalThis.WebSocket = class { close() {} send() {} addEventListener() {} removeEventListener() {} };
    globalThis.ResizeObserver = globalThis.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
    globalThis.IntersectionObserver = globalThis.IntersectionObserver || class { observe() {} unobserve() {} disconnect() {} };
    window.matchMedia = window.matchMedia || ((q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
    window.HTMLElement.prototype.scrollIntoView = window.HTMLElement.prototype.scrollIntoView || (() => {});
  });
  afterEach(() => { cleanup(); Object.assign(console, original); });

  for (const [path, load] of Object.entries(modules)) {
    const name = path.split("/").pop().replace(".jsx", "");
    if (SKIP.has(name)) continue;
    for (const m of MODES) {
      it(`${name} survives "${m}"`, async () => {
        mode.current = m;
        const Page = (await load()).default;
        const { findByTestId, queryByTestId } = render(<MemoryRouter><Boundary><Page /></Boundary></MemoryRouter>);
        await new Promise((r) => setTimeout(r, 60));
        const bad = queryByTestId("crashed");
        expect(bad?.textContent ?? null, `${name} crashed on "${m}"`).toBeNull();
        void findByTestId; void waitFor;
      }, 15000);
    }
  }
});
