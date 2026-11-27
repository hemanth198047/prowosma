import { Component } from "react";
import { Link } from "react-router-dom";
import { freshReload, isChunkLoadError, reloadOnce } from "../utils/staleApp";
import { reportClientError } from "../utils/reportError";

/**
 * Wraps the page area only. If one page crashes, the menu, the top bar and every other page keep working: the person sees what happened,
 * can try the page again or go back to the dashboard, and the crash is reported to the server. (Without this, one broken page showed
 * "Something went wrong" for the whole application.) Pass `resetKey` (the current path) so moving to another page clears the error.
 */
export default class PageErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) {
    if (isChunkLoadError(error)) reloadOnce();              // a file of an older version is gone: load the new version by itself
    else reportClientError(error, "page");
  }
  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const outdated = isChunkLoadError(error);
    return (
      <div className="empty-state" role="alert" style={{ padding: 32, textAlign: "center" }}>
        <h2>{outdated ? "Prowosma was updated." : "This page ran into a problem."}</h2>
        <p style={{ color: "#666", maxWidth: 460, margin: "8px auto 16px" }}>
          {outdated ? "Loading the new version…" : "The rest of the app still works. Try the page again, or go back to the dashboard. The problem has been reported."}
        </p>
        {!outdated && (
          <details style={{ color: "#888", fontSize: 12, margin: "0 auto 14px", maxWidth: 520 }}>
            <summary style={{ cursor: "pointer" }}>Technical details (for support)</summary>
            <code style={{ display: "block", marginTop: 6, wordBreak: "break-word" }}>{String(error?.message || error).slice(0, 300)}</code>
          </details>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <button type="button" className="btn-primary" onClick={() => this.setState({ error: null })}>Try again</button>
          <button type="button" className="btn-secondary" onClick={freshReload}>Reload Prowosma</button>
          <Link to="/" className="btn-secondary" style={{ textDecoration: "none" }}>Go to dashboard</Link>
        </div>
      </div>
    );
  }
}
