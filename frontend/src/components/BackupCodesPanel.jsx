import { useState } from "react";

/**
 * Shows a freshly generated set of 2FA backup codes. They are returned by the server exactly
 * once (only hashes are stored), so this is the user's only chance to keep them.
 */
export default function BackupCodesPanel({ codes, onDone }) {
  const [copied, setCopied] = useState(false);
  const text = codes.join("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch { /* clipboard unavailable: the codes are on screen and can be downloaded */ }
  };

  const download = () => {
    const blob = new Blob([`Prowosma backup codes\nEach code can be used once.\n\n${text}\n`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "prowosma-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div role="region" aria-label="Backup codes" data-testid="backup-codes"
      style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "12px", padding: "16px", margin: "12px 0" }}>
      <div style={{ fontWeight: 800, fontSize: "14px", marginBottom: "4px" }}>Save your backup codes</div>
      <p style={{ fontSize: "12px", color: "#78350f", margin: "0 0 10px", lineHeight: 1.5 }}>
        If you lose access to your authenticator app, each of these codes lets you sign in once. They are shown only now:
        store them somewhere safe, like a password manager.
      </p>
      <ul style={{ listStyle: "none", padding: 0, margin: "0 0 12px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
        {codes.map((c) => (
          <li key={c}><code style={{ fontSize: "14px", letterSpacing: "0.05em" }}>{c}</code></li>
        ))}
      </ul>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <button type="button" className="btn-secondary" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
        <button type="button" className="btn-secondary" onClick={download}>Download</button>
        <button type="button" className="btn-primary" onClick={onDone}>I've saved these codes</button>
      </div>
    </div>
  );
}
