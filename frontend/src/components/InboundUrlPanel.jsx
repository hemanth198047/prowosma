import { useRef, useState } from "react";
import client from "../api/client";
import { createInboundToken } from "../api/integrations";
import { inboundUrl } from "../utils/inboundUrl";
import { apiErrorMessage } from "../utils/apiError";

/**
 * Per-tool setup help shown under the generated URL. The Datadog payload uses Datadog's own
 * webhook variables ($ALERT_ID etc.); the backend understands exactly these field names.
 */
export const INBOUND_SETUP = {
  DATADOG: {
    steps: [
      "In Datadog open Integrations -> Webhooks and add a new webhook.",
      "Paste the URL above as the webhook URL.",
      "Paste the payload below into the Payload field, keeping the $VARIABLES exactly as written.",
      "Mention @webhook-<your webhook name> in a monitor's message. Recoveries are sent automatically and close the task.",
    ],
    template: `{
  "title": "$EVENT_TITLE",
  "body": "$TEXT_ONLY_MSG",
  "alert_id": "$ALERT_ID",
  "alert_transition": "$ALERT_TRANSITION",
  "alert_type": "$ALERT_TYPE",
  "priority": "$ALERT_PRIORITY",
  "link": "$LINK",
  "tags": "$TAGS"
}`,
  },
  SENTRY: {
    steps: [
      "In Sentry open Settings -> Developer Settings -> New Internal Integration.",
      "Paste the URL above as the Webhook URL and enable the Issue resource (and Alert Rule Action for alert-rule events).",
      "Copy the integration's Client Secret into the Client Secret field, then Save & Connect again. Events are then signature-checked.",
    ],
  },
  JENKINS: {
    steps: [
      "Install the Notification plugin in Jenkins.",
      "In a job open Configure -> Job Notifications -> Add Endpoint.",
      "Format: JSON. Protocol: HTTP. Event: Job Finalized (or All Events). URL: paste the URL above.",
    ],
  },
};

export default function InboundUrlPanel({ integrationKey, savedId, color = "#6366f1" }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef(null);
  const setup = INBOUND_SETUP[integrationKey] || { steps: [] };

  const generate = async () => {
    setBusy(true); setError(null); setCopied(false);
    try {
      const res = await createInboundToken(savedId);
      const full = inboundUrl(client.defaults?.baseURL, res.data?.path, window.location.origin);
      if (!full) throw new Error("The server returned no webhook URL.");
      setUrl(full);
    } catch (err) {
      setError(apiErrorMessage(err, "Could not generate the webhook URL."));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      inputRef.current?.select();       // clipboard API unavailable: let the user press copy themselves
    }
  };

  const box = { background: "#f8fafc", border: "1px solid #e8ecf2", borderRadius: "12px", padding: "14px" };

  if (!savedId) {
    return (
      <div style={box} data-testid="inbound-panel">
        <div style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>Webhook URL</div>
        <div style={{ fontSize: "12px", color: "#64748b", lineHeight: 1.5 }}>
          Click <b>Save &amp; Connect</b> first, then reopen this dialog to generate your webhook URL.
        </div>
      </div>
    );
  }

  return (
    <div style={box} data-testid="inbound-panel">
      <div style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b", marginBottom: "8px" }}>Webhook URL</div>

      {!url && (
        <button type="button" onClick={generate} disabled={busy}
          style={{ padding: "9px 16px", borderRadius: "8px", border: "none", background: color, color: "#fff",
            fontSize: "12px", fontWeight: 800, cursor: "pointer", opacity: busy ? 0.7 : 1 }}>
          {busy ? "Generating..." : "Generate webhook URL"}
        </button>
      )}

      {url && (
        <>
          <div style={{ display: "flex", gap: "6px" }}>
            <input ref={inputRef} readOnly value={url} aria-label="Webhook URL"
              onFocus={e => e.target.select()}
              style={{ flex: 1, padding: "9px 10px", borderRadius: "8px", border: "1.5px solid #e2e8f0",
                fontSize: "12px", fontFamily: "monospace", boxSizing: "border-box" }} />
            <button type="button" onClick={copy}
              style={{ padding: "9px 14px", borderRadius: "8px", border: "1px solid #e2e8f0", background: "#fff",
                fontSize: "12px", fontWeight: 700, cursor: "pointer" }}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div role="note" style={{ fontSize: "11px", color: "#92400e", background: "#fffbeb", border: "1px solid #fef3c7",
            borderRadius: "6px", padding: "6px 8px", marginTop: "8px", lineHeight: 1.5 }}>
            Copy it now: it is shown once and cannot be retrieved later. Treat it like a password, because anyone with it can
            create tasks in this workspace.
          </div>
          <ol style={{ margin: "10px 0 0", paddingLeft: "18px", fontSize: "11px", color: "#475569", lineHeight: 1.6 }}>
            {setup.steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
          {setup.template && (
            <pre aria-label="Datadog payload" style={{ margin: "8px 0 0", padding: "10px", background: "#0f172a", color: "#e2e8f0",
              borderRadius: "8px", fontSize: "11px", overflowX: "auto" }}>{setup.template}</pre>
          )}
        </>
      )}

      {error && (
        <div role="alert" style={{ marginTop: "8px", fontSize: "12px", color: "#b91c1c", fontWeight: 600 }}>{error}</div>
      )}

      <div style={{ fontSize: "11px", color: "#64748b", marginTop: "10px", lineHeight: 1.5 }}>
        {url
          ? "Generating a new URL replaces this one: the old URL stops working immediately."
          : "Already have a URL configured in the tool? Generating a new one replaces it: the old URL stops working."}
      </div>
    </div>
  );
}
