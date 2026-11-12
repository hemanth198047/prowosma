import { useState, useEffect } from 'react';
import { usePWA } from '../hooks/usePWA';
import PushNotificationToggle from './PushNotificationToggle';

export default function PWAInstallBanner() {
  const { canInstall, isInstalled, promptInstall } = usePWA();
  const [visible, setVisible]       = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installed, setInstalled]   = useState(false);
  const [manualMode, setManualMode] = useState(false); // show manual instructions

  // Auto-show on page load unless dismissed or installed
  useEffect(() => {
    if (isInstalled) return;
    const dismissed = localStorage.getItem('pwa-banner-dismissed') === 'true';
    // On phones the prompt covers the whole screen, so don't greet someone
    // with it on their very first visit: count visits (one per browser
    // session) and offer it from the second visit on. Desktop is unchanged.
    const isPhone = window.matchMedia?.("(max-width: 768px)")?.matches;
    let visits = 1;
    try {
      visits = Number(localStorage.getItem('pwa-visit-count') || 0);
      if (!sessionStorage.getItem('pwa-visit-counted')) {
        visits += 1;
        localStorage.setItem('pwa-visit-count', String(visits));
        sessionStorage.setItem('pwa-visit-counted', '1');
      }
    } catch { /* storage unavailable: behave as before */ visits = 2; }
    if (!dismissed && (!isPhone || visits >= 2)) {
      const t = setTimeout(() => setVisible(true), 1500);
      return () => clearTimeout(t);
    }
  }, [isInstalled]);

  // Manual trigger from user menu
  useEffect(() => {
    const handler = () => {
      setManualMode(!canInstall); // if prompt unavailable, jump straight to instructions
      setVisible(true);
    };
    window.addEventListener('prowosma:show-install', handler);
    return () => window.removeEventListener('prowosma:show-install', handler);
  }, [canInstall]);

  const handleInstall = async () => {
    if (!canInstall) {
      // Browser prompt used up — show manual instructions instead
      setManualMode(true);
      return;
    }
    setInstalling(true);
    const accepted = await promptInstall();
    if (accepted) {
      setInstalled(true);
      localStorage.setItem('pwa-banner-dismissed', 'true');
      setTimeout(() => setVisible(false), 2500);
    } else {
      // User dismissed Chrome's popup — show manual instructions as fallback
      setInstalling(false);
      setManualMode(true);
    }
  };

  const handleNotNow = () => {
    setVisible(false);
    setManualMode(false);
    localStorage.setItem('pwa-banner-dismissed', 'true');
  };

  const handleClose = () => {
    setVisible(false);
    setManualMode(false);
  };

  if (!visible || isInstalled) return null;

  return (
    <>
      <div className="pwa-backdrop" onClick={handleNotNow} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (handleNotNow)?.(e); } }} />
      <div className="pwa-modal">

        {/* ── Installed success ── */}
        {installed && (
          <div className="pwa-modal-success">
            <div style={{ fontSize: '56px', marginBottom: '16px' }}>🎉</div>
            <h2 className="pwa-modal-title">Prowosma Installed!</h2>
            <p className="pwa-modal-desc">
              You can now launch Prowosma directly from your desktop or home screen.
            </p>
            {/* The banner's own feature list below promises "Push
                Notifications" — this is the real, working way to actually
                turn that on, not just a claim. See
                src/utils/push.js / docs/MOBILE_OFFLINE.md. */}
            <div style={{ marginTop: '16px' }}>
              <PushNotificationToggle />
            </div>
          </div>
        )}

        {/* ── Manual install instructions ── */}
        {!installed && manualMode && (
          <>
            <h2 className="pwa-modal-title">How to Install</h2>
            <p className="pwa-modal-desc">
              Your browser is ready to install Prowosma. Follow these steps:
            </p>
            <div className="pwa-install-steps">
              <div className="pwa-install-step">
                <span className="pwa-step-num">1</span>
                <div>
                  <div className="pwa-step-title">Click the install icon in your address bar</div>
                  <div className="pwa-step-desc">
                    Look for <strong>⊕</strong> or a computer icon on the right side of your Chrome address bar
                  </div>
                  <div className="pwa-step-visual">
                    <div className="pwa-address-bar-demo">
                      <span style={{ color:'#888', fontSize:'12px' }}>localhost:5173</span>
                      <div style={{ display:'flex', gap:'6px', alignItems:'center' }}>
                        <span style={{ fontSize:'13px' }}>⭐</span>
                        <div className="pwa-install-icon-demo" title="Install Prowosma">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="3" width="18" height="18" rx="3"/>
                            <path d="M12 8v8M8 12l4 4 4-4"/>
                          </svg>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="pwa-install-step">
                <span className="pwa-step-num">2</span>
                <div>
                  <div className="pwa-step-title">Or use the browser menu</div>
                  <div className="pwa-step-desc">
                    Click <strong>⋮</strong> (three dots) in the top-right corner of Chrome →
                    select <strong>"Install Prowosma…"</strong> or <strong>"Cast, save, and share"</strong> → <strong>"Install page as app"</strong>
                  </div>
                </div>
              </div>
              <div className="pwa-install-step">
                <span className="pwa-step-num">3</span>
                <div>
                  <div className="pwa-step-title">Click Install in the popup</div>
                  <div className="pwa-step-desc">
                    Chrome will show a small confirmation popup — click <strong>Install</strong> to add Prowosma to your desktop.
                  </div>
                </div>
              </div>
            </div>
            <div className="pwa-modal-actions" style={{ marginTop:'24px' }}>
              <button className="btn-primary pwa-modal-install" onClick={handleClose}>
                Got it ✓
              </button>
            </div>
          </>
        )}

        {/* ── Default install prompt ── */}
        {!installed && !manualMode && (
          <>
            <div className="pwa-modal-icon">
              <img src="/icons/icon-192.png" alt="Prowosma" width="72" height="72"
                style={{ borderRadius: '16px' }} />
            </div>
            <h2 className="pwa-modal-title">Install Prowosma</h2>
            <p className="pwa-modal-desc">
              Add Prowosma to your home screen for a faster, app-like experience
              with offline access and instant launch.
            </p>

            <div className="pwa-modal-features">
              <div className="pwa-modal-feature">
                <span className="pwa-modal-feature-icon">⚡</span>
                <div>
                  <div className="pwa-modal-feature-title">Instant Launch</div>
                  <div className="pwa-modal-feature-desc">Opens like a native app, no browser chrome</div>
                </div>
              </div>
              <div className="pwa-modal-feature">
                <span className="pwa-modal-feature-icon">📶</span>
                <div>
                  <div className="pwa-modal-feature-title">Works Offline</div>
                  <div className="pwa-modal-feature-desc">Access your tasks even without internet</div>
                </div>
              </div>
              <div className="pwa-modal-feature">
                <span className="pwa-modal-feature-icon">🔔</span>
                <div>
                  <div className="pwa-modal-feature-title">Push Notifications</div>
                  <div className="pwa-modal-feature-desc">Get notified about overdue tasks and mentions</div>
                </div>
              </div>
            </div>

            <div className="pwa-modal-actions">
              <button className="btn-secondary pwa-modal-cancel" onClick={handleNotNow}>
                Not now
              </button>
              <button className="btn-primary pwa-modal-install"
                onClick={handleInstall} disabled={installing}>
                {installing ? 'Installing…' : '⬇️ Install App'}
              </button>
            </div>
          </>
        )}

      </div>
    </>
  );
}
