import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getBillingSummary, startCheckout, openBillingPortal, startTrial } from "../api/billing";

import "../styles/pages/licensing.css";
import { apiErrorMessage } from "../utils/apiError";
import { statusText } from "../utils/statusText";
/* ══════════════════════════════════════════════════════════════════
   PLAN DEFINITIONS — every feature in the application
   ══════════════════════════════════════════════════════════════════ */
const PLANS = [
  {
    id: "starter",
    name: "Starter",
    tagline: "For individuals and small teams getting started",
    badge: null,
    monthlyPrice: 0,
    yearlyPrice: 0,
    color:"#5B5FEE",
    colorLight: "rgba(99,102,241,0.07)",
    colorBorder: "rgba(99,102,241,0.25)",
    cta: "Start 14-day free trial",
    ctaStyle: "outline",
    limits: { users:"Up to 5,000", projects:"3", storage:"500 MB", automations:"10/mo", API:"–" },
    features: [
      // ── Core Work ──────────────────────────────────────────────
      { g:"Work", label:"Projects",              value:"3 active" },
      { g:"Work", label:"Tasks",                 value:"Unlimited" },
      { g:"Work", label:"Goals",                 value:"5" },
      { g:"Work", label:"Kanban boards",         value:"3" },
      { g:"Work", label:"Epics",                 value:false },
      { g:"Work", label:"Sprints",               value:false },
      { g:"Work", label:"Gantt chart",           value:false },
      { g:"Work", label:"Calendar view",         value:true },
      { g:"Work", label:"Subtasks & checklists", value:true },
      { g:"Work", label:"Task relationships",    value:false },
      { g:"Work", label:"Story points",          value:false },
      { g:"Work", label:"SLA tracking",          value:false },
      { g:"Work", label:"Deployment analytics",  value:false },
      { g:"Work", label:"Knowledge graph",       value:false },
      // ── Knowledge ─────────────────────────────────────────────
      { g:"Knowledge", label:"Docs",             value:"20" },
      { g:"Knowledge", label:"Doc versioning",   value:false },
      { g:"Knowledge", label:"Doc publishing",   value:false },
      { g:"Knowledge", label:"Decisions log",    value:"10" },
      { g:"Knowledge", label:"Meetings & notes", value:true },
      { g:"Knowledge", label:"SOPs",             value:"5" },
      { g:"Knowledge", label:"Knowledge freshness",value:false },
      { g:"Knowledge", label:"Auto-linking",     value:false },
      // ── Insights ──────────────────────────────────────────────
      { g:"Insights", label:"Analytics",         value:"Basic" },
      { g:"Insights", label:"Portfolio view",    value:false },
      { g:"Insights", label:"Portfolio+",        value:false },
      { g:"Insights", label:"KPI Tracker",       value:false },
      { g:"Insights", label:"ROI Engine",        value:false },
      { g:"Insights", label:"RAID log",          value:false },
      { g:"Insights", label:"Roadmap",           value:false },
      { g:"Insights", label:"Scenarios",         value:false },
      { g:"Insights", label:"Executive view",    value:false },
      { g:"Insights", label:"Reports",           value:"3 templates" },
      { g:"Insights", label:"Time & Billing",    value:false },
      { g:"Insights", label:"DORA metrics",      value:false },
      // ── Automate ──────────────────────────────────────────────
      { g:"Automate", label:"Automations",       value:"10/mo" },
      { g:"Automate", label:"BPM Studio",        value:false },
      { g:"Automate", label:"Integrations",      value:"2" },
      { g:"Automate", label:"Import (CSV)",      value:true },
      { g:"Automate", label:"Webhooks",          value:false },
      { g:"Automate", label:"Inbound webhooks",  value:false },
      // ── Collaborate ───────────────────────────────────────────
      { g:"Collaborate", label:"Channels",           value:"3" },
      { g:"Collaborate", label:"Standup tracking",   value:false },
      { g:"Collaborate", label:"Change requests",    value:false },
      { g:"Collaborate", label:"Approval workflows", value:false },
      // ── AI ────────────────────────────────────────────────────
      { g:"AI", label:"AI Assistant",            value:"50 queries/mo" },
      { g:"AI", label:"AI Intelligence",         value:false },
      { g:"AI", label:"AI Settings",             value:false },
      { g:"AI", label:"Auto-changelog",          value:false },
      // ── People & Configure ────────────────────────────────────
      { g:"Configure", label:"Team members",          value:"5" },
      { g:"Configure", label:"Custom fields",         value:false },
      { g:"Configure", label:"Categories",            value:"10" },
      { g:"Configure", label:"User groups",           value:false },
      { g:"Configure", label:"Role-based access",     value:"Basic" },
      { g:"Configure", label:"Admin Center",          value:false },
      { g:"Configure", label:"White-labelling",       value:false },
      { g:"Configure", label:"Developer / API",       value:false },
      { g:"Configure", label:"DLP / Data policies",   value:false },
      // ── Security & Compliance ─────────────────────────────────
      { g:"Security", label:"SSO / SAML",        value:false },
      { g:"Security", label:"SCIM provisioning", value:false },
      { g:"Security", label:"MFA",               value:true },
      { g:"Security", label:"Audit logs",        value:false },
      { g:"Security", label:"IP allow-list",     value:false },
      { g:"Security", label:"Data residency",    value:false },
      // ── Storage & API ─────────────────────────────────────────
      { g:"Platform", label:"Storage",           value:"500 MB" },
      { g:"Platform", label:"API access",        value:false },
      { g:"Platform", label:"API rate limit",    value:"–" },
      { g:"Platform", label:"Support",           value:"Community" },
      { g:"Platform", label:"Uptime SLA",        value:"99.5%" },
    ],
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "For growing teams ready to scale their execution",
    badge: "Best for teams",
    monthlyPrice: 18,
    yearlyPrice: 14,
    color:"#7C5CBF",
    colorLight: "rgba(124,58,237,0.07)",
    colorBorder: "rgba(124,58,237,0.35)",
    cta: "Upgrade to Pro",
    ctaStyle: "primary",
    limits: { users:"Up to 25", projects:"Unlimited", storage:"20 GB", automations:"500/mo", API:"50K/mo" },
    features: [
      { g:"Work", label:"Projects",              value:"Unlimited" },
      { g:"Work", label:"Tasks",                 value:"Unlimited" },
      { g:"Work", label:"Goals",                 value:"Unlimited" },
      { g:"Work", label:"Kanban boards",         value:"Unlimited" },
      { g:"Work", label:"Epics",                 value:true },
      { g:"Work", label:"Sprints",               value:true },
      { g:"Work", label:"Gantt chart",           value:true },
      { g:"Work", label:"Calendar view",         value:true },
      { g:"Work", label:"Subtasks & checklists", value:true },
      { g:"Work", label:"Task relationships",    value:true },
      { g:"Work", label:"Story points",          value:true },
      { g:"Work", label:"SLA tracking",
      value:false },
      { g:"Work", label:"Deployment analytics",
      value:false },
      { g:"Work", label:"Knowledge graph",
      value:false },
      { g:"Knowledge", label:"Docs",             value:"Unlimited" },
      { g:"Knowledge", label:"Doc versioning",   value:true },
      { g:"Knowledge", label:"Doc publishing",   value:true },
      { g:"Knowledge", label:"Decisions log",    value:"Unlimited" },
      { g:"Knowledge", label:"Meetings & notes", value:true },
      { g:"Knowledge", label:"SOPs",             value:"Unlimited" },
      { g:"Knowledge", label:"Knowledge freshness",value:true },
      { g:"Knowledge", label:"Auto-linking",     value:true },
      { g:"Insights", label:"Analytics",         value:"Advanced" },
      { g:"Insights", label:"Portfolio view",    value:true },
      { g:"Insights", label:"Portfolio+",        value:false },
      { g:"Insights", label:"KPI Tracker",       value:true },
      { g:"Insights", label:"ROI Engine",
      value:false },
      { g:"Insights", label:"RAID log",
      value:false },
      { g:"Insights", label:"Roadmap",           value:true },
      { g:"Insights", label:"Scenarios",         value:"3 per project" },
      { g:"Insights", label:"Executive view",    value:false },
      { g:"Insights", label:"Reports",           value:"Unlimited" },
      { g:"Insights", label:"Time & Billing",    value:true },
      { g:"Insights", label:"DORA metrics",      value:true },
      { g:"Automate", label:"Automations",       value:"500/mo" },
      { g:"Automate", label:"BPM Studio",        value:true },
      { g:"Automate", label:"Integrations",      value:"20" },
      { g:"Automate", label:"Import (CSV)",      value:true },
      { g:"Automate", label:"Webhooks",          value:"10" },
      { g:"Automate", label:"Inbound webhooks",  value:true },
      { g:"Collaborate", label:"Channels",           value:"Unlimited" },
      { g:"Collaborate", label:"Standup tracking",
      value:false },
      { g:"Collaborate", label:"Change requests",
      value:false },
      { g:"Collaborate", label:"Approval workflows", value:"Basic" },
      { g:"AI", label:"AI Assistant",            value:"1,000 queries/mo" },
      { g:"AI", label:"AI Intelligence",
      value:false },
      { g:"AI", label:"AI Settings",
      value:false },
      { g:"AI", label:"Auto-changelog",
      value:false },
      { g:"Configure", label:"Team members",          value:"25" },
      { g:"Configure", label:"Custom fields",         value:"50 fields" },
      { g:"Configure", label:"Categories",            value:"Unlimited" },
      { g:"Configure", label:"User groups",
      value:false },
      { g:"Configure", label:"Role-based access",     value:"Advanced" },
      { g:"Configure", label:"Admin Center",          value:true },
      { g:"Configure", label:"White-labelling",       value:false },
      { g:"Configure", label:"Developer / API",       value:true },
      { g:"Configure", label:"DLP / Data policies",   value:false },
      { g:"Security", label:"SSO / SAML",        value:false },
      { g:"Security", label:"SCIM provisioning", value:false },
      { g:"Security", label:"MFA",               value:true },
      { g:"Security", label:"Audit logs",        value:"7 days" },
      { g:"Security", label:"IP allow-list",     value:false },
      { g:"Security", label:"Data residency",    value:false },
      { g:"Platform", label:"Storage",           value:"20 GB" },
      { g:"Platform", label:"API access",        value:"50K calls/mo" },
      { g:"Platform", label:"API rate limit",    value:"100 req/sec" },
      { g:"Platform", label:"Support",           value:"Email · 24h SLA" },
      { g:"Platform", label:"Uptime SLA",        value:"99.9%" },
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    tagline: "For enterprises needing security, AI, compliance and full power",
    badge: "Maximum power",
    monthlyPrice: 45,
    yearlyPrice: 36,
    color: "#0891b2",
    colorLight: "rgba(8,145,178,0.07)",
    colorBorder: "rgba(8,145,178,0.35)",
    cta: "Contact sales",
    ctaStyle: "teal",
    limits: { users:"Unlimited", projects:"Unlimited", storage:"1 TB", automations:"Unlimited", API:"Unlimited" },
    features: [
      { g:"Work", label:"Projects",              value:"Unlimited" },
      { g:"Work", label:"Tasks",                 value:"Unlimited" },
      { g:"Work", label:"Goals",                 value:"Unlimited" },
      { g:"Work", label:"Kanban boards",         value:"Unlimited" },
      { g:"Work", label:"Epics",                 value:true },
      { g:"Work", label:"Sprints",               value:true },
      { g:"Work", label:"Gantt chart",           value:true },
      { g:"Work", label:"Calendar view",         value:true },
      { g:"Work", label:"Subtasks & checklists", value:true },
      { g:"Work", label:"Task relationships",    value:true },
      { g:"Work", label:"Story points",          value:true },
      { g:"Work", label:"SLA tracking",          value:true },
      { g:"Work", label:"Deployment analytics",  value:true },
      { g:"Work", label:"Knowledge graph",       value:true },
      { g:"Knowledge", label:"Docs",             value:"Unlimited" },
      { g:"Knowledge", label:"Doc versioning",   value:true },
      { g:"Knowledge", label:"Doc publishing",   value:true },
      { g:"Knowledge", label:"Decisions log",    value:"Unlimited" },
      { g:"Knowledge", label:"Meetings & notes", value:true },
      { g:"Knowledge", label:"SOPs",             value:"Unlimited" },
      { g:"Knowledge", label:"Knowledge freshness",value:true },
      { g:"Knowledge", label:"Auto-linking",     value:true },
      { g:"Insights", label:"Analytics",         value:"Enterprise + BI export" },
      { g:"Insights", label:"Portfolio view",    value:true },
      { g:"Insights", label:"Portfolio+",        value:true },
      { g:"Insights", label:"KPI Tracker",       value:true },
      { g:"Insights", label:"ROI Engine",        value:true },
      { g:"Insights", label:"RAID log",          value:true },
      { g:"Insights", label:"Roadmap",           value:true },
      { g:"Insights", label:"Scenarios",         value:"Unlimited" },
      { g:"Insights", label:"Executive view",    value:true },
      { g:"Insights", label:"Reports",           value:"Unlimited + custom" },
      { g:"Insights", label:"Time & Billing",    value:true },
      { g:"Insights", label:"DORA metrics",      value:true },
      { g:"Automate", label:"Automations",       value:"Unlimited" },
      { g:"Automate", label:"BPM Studio",        value:true },
      { g:"Automate", label:"Integrations",      value:"Unlimited" },
      { g:"Automate", label:"Import (CSV)",      value:true },
      { g:"Automate", label:"Webhooks",          value:"Unlimited" },
      { g:"Automate", label:"Inbound webhooks",  value:true },
      { g:"Collaborate", label:"Channels",           value:"Unlimited" },
      { g:"Collaborate", label:"Standup tracking",   value:true },
      { g:"Collaborate", label:"Change requests",    value:true },
      { g:"Collaborate", label:"Approval workflows", value:"Advanced" },
      { g:"AI", label:"AI Assistant",            value:"Unlimited" },
      { g:"AI", label:"AI Intelligence",         value:true },
      { g:"AI", label:"AI Settings",             value:true },
      { g:"AI", label:"Auto-changelog",          value:true },
      { g:"Configure", label:"Team members",          value:"Unlimited" },
      { g:"Configure", label:"Custom fields",         value:"Unlimited" },
      { g:"Configure", label:"Categories",            value:"Unlimited" },
      { g:"Configure", label:"User groups",           value:true },
      { g:"Configure", label:"Role-based access",     value:"Custom roles" },
      { g:"Configure", label:"Admin Center",          value:true },
      { g:"Configure", label:"White-labelling",       value:true },
      { g:"Configure", label:"Developer / API",       value:true },
      { g:"Configure", label:"DLP / Data policies",   value:true },
      { g:"Security", label:"SSO / SAML",        value:true },
      { g:"Security", label:"SCIM provisioning", value:true },
      { g:"Security", label:"MFA",               value:"Enforced" },
      { g:"Security", label:"Audit logs",        value:"12 months" },
      { g:"Security", label:"IP allow-list",     value:true },
      { g:"Security", label:"Data residency",    value:"Choose region" },
      { g:"Platform", label:"Storage",           value:"1 TB" },
      { g:"Platform", label:"API access",        value:"Unlimited" },
      { g:"Platform", label:"API rate limit",    value:"1,000 req/sec + burst" },
      { g:"Platform", label:"Support",           value:"Dedicated CSM + SLA" },
      { g:"Platform", label:"Uptime SLA",        value:"99.99%" },
    ],
  },
];

const GROUPS = ["Work","Knowledge","Insights","Automate","Collaborate","AI","Configure","Security","Platform"];

const GROUP_ICONS = {
  Work:"⚡", Knowledge:"📚", Insights:"📈", Automate:"🔀",
  Collaborate:"💬", AI:"🤖", Configure:"⚙️", Security:"🛡", Platform:"🏗",
};

const ADDONS = [
  { icon:"💾", name:"Extra Storage",     desc:"Add 100 GB of storage to any plan",          price:8,  unit:"/mo",
    features:["100 GB additional storage","Applies instantly to your workspace","Stackable — add multiple packs","No transfer fees","Includes doc, file, and media storage"] },
  { icon:"🤖", name:"AI Power Pack",     desc:"Unlimited AI queries + proactive intelligence",price:12, unit:"/mo",
    features:["Unlimited AI Assistant queries","AI Intelligence — proactive insights","AI Settings & fine-tuning controls","Auto-changelog generation","Risk prediction & burnout detection"] },
  { icon:"🔌", name:"Integrations Pack", desc:"Unlock all 50+ native integrations",          price:10, unit:"/mo",
    features:["All 50+ integrations unlocked","Slack, Jira, GitHub, Salesforce, HubSpot","Bidirectional sync support","Custom webhook support","Import from Asana, Trello, Monday.com"] },
  { icon:"👥", name:"Seat Expansion",    desc:"Add 10 extra seats to your current plan",     price:15, unit:"/mo",
    features:["10 additional user seats","Same role & permission controls","Stackable — buy as many packs as needed","Seats are active immediately","Remove seats at billing cycle end"] },
  { icon:"🛡", name:"Security Pack",     desc:"Enterprise-grade security on any plan",       price:20, unit:"/mo",
    features:["SSO / SAML 2.0 integration","SCIM automated provisioning","IP allow-list network control","Audit logs (12 months retention)","DLP & data policies management"] },
  { icon:"⭐", name:"Priority Support",  desc:"Dedicated support with guaranteed SLAs",      price:18, unit:"/mo",
    features:["< 2 hour first-response SLA","Dedicated Slack support channel","Named Customer Success Manager","Monthly check-in calls","Early access to new features"] },
  { icon:"🏷", name:"White-label",       desc:"Your brand, your colours on Prowosma",       price:25, unit:"/mo",
    features:["Custom logo & brand colours","Custom domain (e.g. pm.yourcompany.com)","Remove all Prowosma branding","Custom email sender domain","White-labelled PDF exports"] },
  { icon:"📊", name:"BI Export Pack",    desc:"Stream your data to BI tools in real time",  price:15, unit:"/mo",
    features:["Export to Looker, Tableau, Power BI","Raw data access via secure API","Scheduled data snapshots","Custom field data included","Historical data export (unlimited)"] },
];

const FAQS = [
  { q:"Can I switch plans at any time?",        a:"Yes. Upgrades take effect immediately and are prorated. Downgrades apply at the next billing cycle." },
  { q:"Is there a free trial on paid plans?",   a:"Pro includes a 14-day free trial — no credit card required. Enterprise includes a 30-day POC with full access." },
  { q:"How does per-seat pricing work?",        a:"Each plan price is per active user per month. Deactivated members are not counted. Add or remove seats any time from Admin Center." },
  { q:"What happens if I exceed limits?",       a:"You'll be notified at 80% and 95% usage. There's a 7-day grace period before features are restricted — upgrade or add-on to continue." },
  { q:"Can I get a custom enterprise plan?",    a:"Yes. Custom seat counts, storage, SLAs, data residency, and payment terms are all negotiable. Contact our sales team." },
  { q:"Is annual billing available?",           a:"Yes — annual billing saves ~22%. You're billed once for the full year and can pay by card, bank transfer, or invoice (Enterprise)." },
  { q:"What payment methods do you accept?",    a:"Visa, Mastercard, Amex, PayPal, bank transfer (Enterprise), and purchase orders (Enterprise)." },
  { q:"Is my data secure?",                     a:"All data is encrypted at rest (AES-256) and in transit (TLS 1.3). We are SOC 2 Type II compliant and GDPR ready. Enterprise customers choose their data residency region." },
  { q:"Does Prowosma support SSO?",            a:"Yes — SAML 2.0 and OIDC SSO is available on the Enterprise plan. Works with Okta, Azure AD, Google Workspace, and any SAML-compliant IdP." },
  { q:"Can I import data from other tools?",    a:"Yes. Prowosma supports CSV import on all plans. The Integrations Pack unlocks direct imports from Jira, Asana, Trello, and Monday.com." },
];

/* ── helpers ─────────────────────────────────────────────────── */
function FVal({ v }) {
  if (v === true)  return <span className="lic-check">✓</span>;
  if (v === false) return <span className="lic-cross">—</span>;
  return <span className="lic-val">{v}</span>;
}

/* ── Compare table ───────────────────────────────────────────── */
function CompareTable() {
  const [openGroup, setOpenGroup] = useState(null);

  return (
    <div className="lic-compare-wrap">
      {GROUPS.map(grp => {
        const groupFeatures = PLANS[0].features.filter(f => f.g === grp).map(f => f.label);
        const isOpen = openGroup === grp;
        return (
          <div key={grp} className="lic-ct-group">
            <button className="lic-ct-group-head" onClick={() => setOpenGroup(isOpen ? null : grp)}>
              <span>{GROUP_ICONS[grp]} {grp}</span>
              <span style={{fontSize:11,color:"var(--color-text-tertiary)"}}>{groupFeatures.length} features {isOpen?"▲":"▼"}</span>
            </button>
            {isOpen && (
              <div className="lic-ct-table">
                <div className="lic-ct-header-row">
                  <div className="lic-ct-feat-col" />
                  {PLANS.map(p=>(
                    <div key={p.id} className="lic-ct-plan-col" style={{color:p.color}}>{p.name}</div>
                  ))}
                </div>
                {groupFeatures.map((lbl,i)=>(
                  <div key={i} className={"lic-ct-row"+(i%2===0?" lic-ct-even":"")}>
                    <div className="lic-ct-feat-col">{lbl}</div>
                    {PLANS.map(p=>(
                      <div key={p.id} className="lic-ct-val-col">
                        <FVal v={p.features.find(f=>f.label===lbl)?.value}/>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN PAGE
   ══════════════════════════════════════════════════════════════ */
/* Maps this page's display plan ids to the real backend PlanCatalog ids.
   Only "pro" is self-serve today (has a real Stripe Price configured) —
   "starter" is free (no checkout needed) and "enterprise" stays
   contact-sales unless you configure stripe.price.enterprise on the
   backend, matching PlanCatalog's default. */
const BACKEND_PLAN_ID = { starter: "FREE", pro: "PRO", enterprise: "ENTERPRISE" };

export default function Licensing() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [billing, setBilling]     = useState("monthly");
  const [activePlan, setActivePlan] = useState("pro");
  const [showCompare, setShowCompare] = useState(false);
  const [openFaq, setOpenFaq]     = useState(null);
  const [selectedAddon, setSelectedAddon] = useState(null); // addon modal
  const [addonAdded,   setAddonAdded]   = useState({});     // which addons "added"

  // ── Real billing state (Stripe-backed) ─────────────────────────
  const [summary, setSummary]         = useState(null);
  const [seats, setSeats]             = useState(5);
  const [checkoutLoading, setCheckoutLoading] = useState(null); // planId currently loading, or null
  const [portalLoading, setPortalLoading]     = useState(false);
  const [billingError, setBillingError]       = useState("");
  const checkoutResult = searchParams.get("checkout"); // "success" | "cancelled" | null

  useEffect(() => {
    getBillingSummary()
      .then(res => setSummary(res.data))
      .catch(() => {}); // non-fatal — page still works as a marketing page if this fails
  }, [checkoutResult]);

  const dismissCheckoutBanner = () => {
    searchParams.delete("checkout");
    setSearchParams(searchParams, { replace: true });
  };

  const [infoBanner, setInfoBanner] = useState(""); // neutral confirmations (e.g. contact sales)

  const handleChoosePlan = async (plan) => {
    setBillingError("");
    setInfoBanner("");

    if (plan.id === "enterprise") {
      const mailto = "mailto:sales@prowosma.app?subject=Enterprise%20Inquiry";
      // window.open in a new tab is far more reliable than "_self" here —
      // some browsers silently swallow a same-tab mailto navigation with
      // no visible effect, which is exactly the "nothing happens" bug.
      const opened = window.open(mailto, "_blank");
      setInfoBanner(
        opened
          ? "Opening your email client to reach our sales team…"
          : "Couldn't open your email client automatically — reach us directly at sales@prowosma.app."
      );
      return;
    }

    if (plan.id === "starter") {
      // Already used the trial (or already on a paid/trialing plan) — just
      // get them into the app, nothing to activate.
      if (summary?.trialUsed || summary?.status === "trialing" || summary?.planId !== "FREE") {
        navigate("/");
        return;
      }
      // Real trial activation — no card, no Stripe, just a real state
      // change on this workspace's subscription.
      setCheckoutLoading(plan.id);
      try {
        const res = await startTrial();
        setSummary(res.data);
        setInfoBanner("🎉 Your 14-day Pro trial has started — every Pro feature is unlocked until it ends.");
        navigate("/");
      } catch (err) {
        setBillingError(
          apiErrorMessage(err, "Couldn't start your trial. Please try again in a moment.")
        );
      } finally {
        setCheckoutLoading(null);
      }
      return;
    }

    // Paid, self-serve plan — start a real Stripe Checkout session.
    setCheckoutLoading(plan.id);
    try {
      const res = await startCheckout(BACKEND_PLAN_ID[plan.id], seats);
      // eslint-disable-next-line react-hooks/immutability -- click-triggered checkout handler, not render
      window.location.href = res.data.url; // hand off to Stripe's real hosted checkout page
    } catch (err) {
      setBillingError(
        apiErrorMessage(err, "Couldn't start checkout. Please try again in a moment.")
      );
      setCheckoutLoading(null);
    }
  };

  const planButtonLabel = (plan) => {
    if (plan.id === "starter") {
      if (summary?.trialUsed) return "Get started free";
      if (summary?.status === "trialing") return "Trial active";
      return plan.cta; // "Start 14-day free trial"
    }
    if (plan.id === "pro" && summary?.planId === "PRO") return "Current plan";
    return plan.cta;
  };

  const handleManageBilling = async () => {
    setBillingError("");
    setPortalLoading(true);
    try {
      const res = await openBillingPortal();
      window.location.href = res.data.url;
    } catch (err) {
      setBillingError(
        apiErrorMessage(err, "Couldn't open the billing portal. Please try again.")
      );
      setPortalLoading(false);
    }
  };

  const price = p => billing==="yearly" ? p.yearlyPrice : p.monthlyPrice;

  return (
    <div className="lic-root">

      {checkoutResult === "success" && (
        <div style={{background:"#e7f6ec",color:"#15803d",padding:"12px 20px",borderRadius:8,margin:"0 0 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span>✓ Payment successful — your plan has been updated.</span>
          <button onClick={dismissCheckoutBanner} style={{background:"none",border:"none",color:"#15803d",cursor:"pointer",fontWeight:600}}>Dismiss</button>
        </div>
      )}
      {checkoutResult === "cancelled" && (
        <div style={{background:"#fdf1e0",color:"#b45309",padding:"12px 20px",borderRadius:8,margin:"0 0 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span>Checkout was cancelled — no changes were made.</span>
          <button onClick={dismissCheckoutBanner} style={{background:"none",border:"none",color:"#b45309",cursor:"pointer",fontWeight:600}}>Dismiss</button>
        </div>
      )}
      {infoBanner && (
        <div style={{background:"#e8f0fe",color:"#1a56db",padding:"12px 20px",borderRadius:8,margin:"0 0 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span>{infoBanner}</span>
          <button onClick={() => setInfoBanner("")} style={{background:"none",border:"none",color:"#1a56db",cursor:"pointer",fontWeight:600}}>Dismiss</button>
        </div>
      )}
      {billingError && (
        <div style={{background:"#fde8e8",color:"#b91c1c",padding:"12px 20px",borderRadius:8,margin:"0 0 16px"}}>
          {billingError}
        </div>
      )}

      {summary && (
        <div style={{background:"#f4f4fb",borderRadius:10,padding:"14px 20px",margin:"0 0 20px",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12}}>
          <div>
            <strong>Current plan: {summary.planName}</strong>
            {" — "}{summary.seatsUsed} / {summary.seatLimit < 0 ? "∞" : summary.seatLimit} seats used
            {summary.status && summary.status !== "none" && ` · ${statusText(summary.status)}`}
            {summary.cancelAtPeriodEnd && " · cancels at period end"}
            {!summary.stripeConfigured && (
              <span style={{color:"#b45309"}}> · Payments aren't configured on this server yet</span>
            )}
          </div>
          {summary.hasPaymentMethod && (
            <button
              className="lic-cta-btn lic-cta-outline"
              disabled={portalLoading}
              onClick={handleManageBilling}>
              {portalLoading ? "Opening…" : "Manage billing"}
            </button>
          )}
        </div>
      )}

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="lic-page-header">
        <div className="lic-header-badge">💎 Pricing & Plans</div>
        <h1 className="lic-page-title">Simple, transparent pricing</h1>
        <p className="lic-page-sub">Every feature built. Every feature available. Pay only for what fits your team.</p>
        <div className="lic-billing-toggle">
          <button className={"lic-bill-btn"+(billing==="monthly"?" active":"")} onClick={()=>setBilling("monthly")}>Monthly</button>
          <button className={"lic-bill-btn"+(billing==="yearly"?" active":"")} onClick={()=>setBilling("yearly")}>
            Yearly <span className="lic-save-badge">Save 22%</span>
          </button>
        </div>
      </div>


      {/* ── Plan cards ─────────────────────────────────────── */}
      <div className="lic-plans-grid">
        {PLANS.map(plan => {
          const active = activePlan === plan.id;
          return (
            <div key={plan.id}
              className={"lic-plan-card"+(active?" lic-plan-card--active":"")}
              style={active?{borderColor:plan.color,boxShadow:`0 0 0 2px ${plan.colorLight},0 8px 32px ${plan.colorLight}`}:{}}
              onClick={()=>setActivePlan(plan.id)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (()=>setActivePlan(plan.id))?.(e); } }}>

              {plan.badge && <div className="lic-plan-badge" style={{background:plan.color}}>{plan.badge}</div>}

              <div className="lic-plan-header">
                <div className="lic-plan-name" style={{color:plan.color}}>{plan.name}</div>
                <div className="lic-plan-tagline">{plan.tagline}</div>
              </div>

              <div className="lic-plan-price">
                {plan.monthlyPrice===0
                  ? <span className="lic-price-free">Free</span>
                  : <><span className="lic-price-currency">$</span>
                    <span className="lic-price-amount">{price(plan)}</span>
                    <span className="lic-price-period">/user/mo</span></>
                }
                {billing==="yearly"&&plan.monthlyPrice>0&&(
                  <div className="lic-price-annual">Billed ${price(plan)*12}/user/year</div>
                )}
              </div>

              {/* Limits */}
              <div className="lic-limits">
                {Object.entries(plan.limits).map(([k,v])=>(
                  <div key={k} className="lic-limit-item">
                    <span className="lic-limit-val">{v}</span>
                    <span className="lic-limit-key">{k}</span>
                  </div>
                ))}
              </div>

              {/* Feature highlights by group */}
              <div className="lic-feat-groups">
                {GROUPS.map(grp => {
                  const included = plan.features.filter(f=>f.g===grp&&f.value!==false);
                  if (!included.length) return null;
                  return (
                    <div key={grp} className="lic-feat-group">
                      <div className="lic-feat-group-head">{GROUP_ICONS[grp]} {grp}</div>
                      {included.slice(0,3).map((f,i)=>(
                        <div key={i} className="lic-feat-item">
                          <span className="lic-feat-check" style={{color:plan.color}}>✓</span>
                          <span className="lic-feat-label">
                            {f.label}{typeof f.value==="string"&&f.value!=="true"?`: ${f.value}`:""}
                          </span>
                        </div>
                      ))}
                      {included.length>3&&(
                        <div className="lic-feat-more">+{included.length-3} more</div>
                      )}
                    </div>
                  );
                })}
              </div>

              <button
                className={"lic-cta-btn lic-cta-"+plan.ctaStyle}
                style={plan.ctaStyle==="primary"?{background:plan.color}:
                       plan.ctaStyle==="teal"?{background:plan.color}:{}}
                disabled={checkoutLoading === plan.id ||
                  (plan.id === "starter" && summary?.status === "trialing") ||
                  (plan.id === "pro" && summary?.planId === "PRO")}
                onClick={e=>{
                  e.stopPropagation();
                  handleChoosePlan(plan);
                }}>
                {checkoutLoading === plan.id
                  ? (plan.id === "starter" ? "Starting trial…" : "Redirecting to checkout…")
                  : planButtonLabel(plan)}
              </button>
              {plan.id === "pro" && (
                <div className="lic-seats-picker" onClick={e => e.stopPropagation()} style={{marginTop:8,fontSize:13,color:"#666"}} role="presentation">
                  <label htmlFor="lic-seats">Seats:</label>
                  <input
                    id="lic-seats"
                    type="number"
                    min={1}
                    max={25}
                    value={seats}
                    onChange={e => setSeats(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    style={{ width: 56, marginLeft: 8 }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Feature count summary ──────────────────────────── */}
      <div className="lic-feat-summary">
        {PLANS.map(p=>{
          const total = p.features.length;
          const included = p.features.filter(f=>f.value!==false).length;
          return (
            <div key={p.id} className="lic-feat-summary-item">
              <span className="lic-feat-summary-name" style={{color:p.color}}>{p.name}</span>
              <div className="lic-feat-summary-bar">
                <div className="lic-feat-summary-fill"
                  style={{width:`${(included/total)*100}%`,background:p.color}}/>
              </div>
              <span className="lic-feat-summary-count">
                <strong style={{color:p.color}}>{included}</strong> / {total} features
              </span>
            </div>
          );
        })}
      </div>

      {/* ── Compare all features ───────────────────────────── */}
      <div className="lic-compare-toggle">
        <button className="lic-compare-btn" onClick={()=>setShowCompare(v=>!v)}>
          {showCompare?"▲ Hide full comparison":"▼ Compare all "+PLANS[0].features.length+" features"}
        </button>
      </div>
      {showCompare && <CompareTable />}

      {/* ── Add-ons ─────────────────────────────────────────── */}
      <div className="lic-section">
        <div className="lic-section-head">
          <h2 className="lic-section-title">Power-ups & Add-ons</h2>
          <p className="lic-section-sub">Bolt on to any plan, billed monthly, cancel any time.</p>
        </div>
        <div className="lic-addons-grid">
          {ADDONS.map((a,i)=>(
            <div key={i} className={"lic-addon-card"+(addonAdded[i]?" lic-addon-card--added":"")}
              onClick={()=>setSelectedAddon({...a, idx:i})}
              role="button" tabIndex={0}
              onKeyDown={e=>e.key==="Enter"&&setSelectedAddon({...a, idx:i})}>
              <div className="lic-addon-icon">{a.icon}</div>
              <div className="lic-addon-info">
                <div className="lic-addon-name">{a.name}</div>
                <div className="lic-addon-desc">{a.desc}</div>
              </div>
              <div className="lic-addon-right">
                <div className="lic-addon-price">
                  <span className="lic-addon-amount">${a.price}</span>
                  <span className="lic-addon-unit">{a.unit}</span>
                </div>
                {addonAdded[i]
                  ? <span className="lic-addon-added-badge">✓ Added</span>
                  : <span className="lic-addon-cta">Add →</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Trust bar ──────────────────────────────────────── */}
      <div className="lic-trust-bar">
        {[
          {icon:"🔒",label:"SOC 2 Type II"},{icon:"🇪🇺",label:"GDPR Ready"},
          {icon:"⚡",label:"99.99% Enterprise SLA"},{icon:"💳",label:"No card for free tier"},
          {icon:"🔄",label:"Cancel anytime"},{icon:"🔐",label:"AES-256 encryption"},
          {icon:"🌍",label:"Data residency choice"},{icon:"🤝",label:"Dedicated CSM (Enterprise)"},
        ].map((t,i)=>(
          <div key={i} className="lic-trust-item">
            <span className="lic-trust-icon">{t.icon}</span>
            <span className="lic-trust-label">{t.label}</span>
          </div>
        ))}
      </div>

      {/* ── FAQ ───────────────────────────────────────────── */}
      <div className="lic-section">
        <div className="lic-section-head">
          <h2 className="lic-section-title">Frequently asked questions</h2>
        </div>
        <div className="lic-faq-list">
          {FAQS.map((faq,i)=>(
            <div key={i} className={"lic-faq-item"+(openFaq===i?" open":"")}>
              <button className="lic-faq-q" onClick={()=>setOpenFaq(openFaq===i?null:i)}>
                <span>{faq.q}</span>
                <span className="lic-faq-arrow">{openFaq===i?"▲":"▼"}</span>
              </button>
              {openFaq===i&&<div className="lic-faq-a">{faq.a}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* ── Add-on detail modal ───────────────────────────── */}
      {selectedAddon && (
        <div className="lic-modal-overlay" onClick={()=>setSelectedAddon(null)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (()=>setSelectedAddon(null))?.(e); } }}>
          <div className="lic-modal" onClick={e=>e.stopPropagation()} role="presentation">

            <div className="lic-modal-header">
              <div className="lic-modal-icon">{selectedAddon.icon}</div>
              <div className="lic-modal-head-text">
                <div className="lic-modal-title">{selectedAddon.name}</div>
                <div className="lic-modal-subtitle">Monthly add-on · Cancel anytime</div>
              </div>
              <button className="lic-modal-close" onClick={()=>setSelectedAddon(null)}>✕</button>
            </div>

            <div className="lic-modal-body">
              <div className="lic-modal-desc">{selectedAddon.desc}</div>

              <div className="lic-modal-price-row">
                <span className="lic-modal-price">${selectedAddon.price}</span>
                <span className="lic-modal-price-unit">/month · billed monthly</span>
              </div>

              <div className="lic-modal-features">
                <div className="lic-modal-feat-title">What's included</div>
                {selectedAddon.features?.map((f,i)=>(
                  <div key={i} className="lic-modal-feat-item">
                    <span className="lic-modal-feat-check">✓</span>
                    <span>{f}</span>
                  </div>
                ))}
              </div>

              <div className="lic-modal-note">
                This add-on will be added to your current plan and billed at the start
                of your next billing cycle. You can remove it at any time from Admin Center.
              </div>
            </div>

            <div className="lic-modal-footer">
              {addonAdded[selectedAddon.idx] ? (
                <>
                  <div className="lic-modal-success">✓ Add-on activated</div>
                  <button className="lic-modal-btn-secondary"
                    onClick={()=>{
                      setAddonAdded(prev=>({...prev,[selectedAddon.idx]:false}));
                      setSelectedAddon(null);
                    }}>Remove add-on</button>
                </>
              ) : (
                <>
                  <button className="lic-modal-btn-primary"
                    onClick={()=>{
                      setAddonAdded(prev=>({...prev,[selectedAddon.idx]:true}));
                      setSelectedAddon(null);
                    }}>
                    Add to my plan · ${selectedAddon.price}/mo
                  </button>
                  <button className="lic-modal-btn-secondary" onClick={()=>setSelectedAddon(null)}>
                    Maybe later
                  </button>
                </>
              )}
            </div>

          </div>
        </div>
      )}

      {/* ── CTA banner ─────────────────────────────────────── */}
      <div className="lic-cta-banner">
        <div className="lic-cta-banner-left">
          <div className="lic-cta-banner-title">Ready to get started?</div>
          <div className="lic-cta-banner-sub">
            Join thousands of teams building great products with Prowosma.
            Every feature is production-ready today.
          </div>
        </div>
        <div className="lic-cta-banner-actions">
          <button className="lic-cta-btn lic-cta-primary lic-cta-lg" style={{background:"var(--brand-500)"}}
            onClick={()=>navigate("/workspace-setup")}>Start free today</button>
          <button className="lic-cta-btn lic-cta-outline lic-cta-lg"
            onClick={()=>window.open("mailto:sales@prowosma.app?subject=Enterprise%20Inquiry","_self")}>
            Talk to sales
          </button>
        </div>
      </div>

    </div>
  );
}
