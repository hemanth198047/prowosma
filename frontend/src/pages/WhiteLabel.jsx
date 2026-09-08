import { useState, useEffect, useRef } from "react";
import { useAuth } from "../hooks/useAuth";
import { applyDesign } from "../utils/designUtils";
import client from "../api/client";

import "../styles/pages/white-label.css";
/* ── API helpers ─────────────────────────────────────────────────── */
const getBranding  = ()     => client.get("/workspaces/branding");
const saveBranding = (data) => client.put("/workspaces/branding", data);

/* ── Colour utilities ────────────────────────────────────────────── */
function hexToHsl(hex) {
  let r = parseInt(hex.slice(1,3),16)/255;
  let g = parseInt(hex.slice(3,5),16)/255;
  let b = parseInt(hex.slice(5,7),16)/255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b);
  let h,s,l=(max+min)/2;
  if(max===min){h=s=0;}else{
    const d=max-min; s=l>0.5?d/(2-max-min):d/(max+min);
    switch(max){case r:h=(g-b)/d+(g<b?6:0);break;case g:h=(b-r)/d+2;break;default:h=(r-g)/d+4;}
    h/=6;
  }
  return [Math.round(h*360),Math.round(s*100),Math.round(l*100)];
}
function lighten(hex, pct) {
  const [h,s,l]=hexToHsl(hex);
  return `hsl(${h},${s}%,${Math.min(95,l+pct)}%)`;
}
function darken(hex, pct) {
  const [h,s,l]=hexToHsl(hex);
  return `hsl(${h},${s}%,${Math.max(5,l-pct)}%)`;
}

/* ── Logo uploader ───────────────────────────────────────────────── */
function LogoUploader({ label, value, onChange, size="120px" }) {
  const ref = useRef();
  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => onChange(ev.target.result);
    reader.readAsDataURL(file);
  };
  return (
    <div className="wl-logo-uploader">
      <div className="wl-logo-label">{label}</div>
      <div className="wl-logo-drop" style={{width:size,height:size}}
        onClick={() => ref.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => ref.current?.click())?.(e); } }}>
        {value
          ? <img src={value} alt="logo" style={{width:"100%",height:"100%",objectFit:"contain"}}/>
          : <div className="wl-logo-placeholder">
              <span style={{fontSize:28}}>🏷</span>
              <span style={{fontSize:11,color:"var(--gray-400)"}}>Click to upload</span>
            </div>
        }
      </div>
      <input ref={ref} type="file" accept="image/*" style={{display:"none"}} onChange={handleFile}/>
      <div style={{display:"flex",gap:6,marginTop:6}}>
        <button className="wl-btn-xs" onClick={()=>ref.current?.click()}>Upload</button>
        {value && <button className="wl-btn-xs wl-btn-danger" onClick={()=>onChange("")}>Remove</button>}
      </div>
    </div>
  );
}

/* ── Colour palette generator ────────────────────────────────────── */
function ColorPalette({ primary, onSelect }) {
  const presets = [
    {name:"Midnight",color:"#1e40af"},{name:"Indigo",color:"#4f46e5"},
    {name:"Violet",color:"#7c3aed"},{name:"Rose",color:"#be123c"},
    {name:"Teal",color:"#0f766e"},{name:"Emerald",color:"#065f46"},
    {name:"Amber",color:"#b45309"},{name:"Slate",color:"#334155"},
    {name:"Cyan",color:"#0e7490"},{name:"Orange",color:"#c2410c"},
    {name:"Fuchsia",color:"#a21caf"},{name:"Charcoal",color:"#1c1917"},
  ];
  return (
    <div className="wl-palette">
      {presets.map(p=>(
        <button key={p.color} className={"wl-palette-swatch"+(primary===p.color?" active":"")}
          style={{background:p.color}}
          onClick={()=>onSelect(p.color)}
          title={p.name}
        />
      ))}
    </div>
  );
}

/* ── Live preview card ───────────────────────────────────────────── */
function LivePreview({ brand }) {
  const bg    = brand.primaryColor || "#4f46e5";
  const light = lighten(bg, 38);
  const dark  = darken(bg, 10);
  const name  = brand.appName || "Prowosma";

  return (
    <div className="wl-preview-frame">
      {/* Mini topbar */}
      <div className="wl-preview-topbar" style={{background: brand.topbarColor||"#fff"}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {brand.logoUrl
            ? <img src={brand.logoUrl} style={{height:22,objectFit:"contain"}} alt="logo"/>
            : <div style={{fontWeight:800,fontSize:14,color:bg}}>{name}</div>
          }
        </div>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <div style={{width:60,height:6,borderRadius:3,background:"#e2e8f0"}}/>
          <div style={{width:24,height:24,borderRadius:"50%",background:light,
            border:`2px solid ${bg}`,display:"flex",alignItems:"center",
            justifyContent:"center",fontSize:9,fontWeight:700,color:bg}}>A</div>
        </div>
      </div>
      {/* Mini layout */}
      <div style={{display:"flex",flex:1,overflow:"hidden"}}>
        {/* Sidebar */}
        <div style={{width:100,background:brand.sidebarColor||dark,padding:"8px 0",flexShrink:0}}>
          {["Dashboard","Projects","Tasks","Goals","Analytics"].map((item,i)=>(
            <div key={item} style={{
              padding:"4px 10px",fontSize:9,color:i===0?"#fff":"rgba(255,255,255,0.55)",
              background:i===0?bg:"transparent",
              marginBottom:1,cursor:"default"
            }}>{item}</div>
          ))}
        </div>
        {/* Content */}
        <div style={{flex:1,padding:"8px",background:"#f8fafc",display:"flex",
          flexDirection:"column",gap:6}}>
          <div style={{height:18,borderRadius:4,background:light,width:"60%"}}/>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4}}>
            {[1,2,3,4].map(n=>(
              <div key={n} style={{height:28,borderRadius:4,background:"#fff",
                border:"1px solid #e2e8f0"}}/>
            ))}
          </div>
          <div style={{height:10,borderRadius:3,background:bg,width:"40%",marginTop:2}}/>
        </div>
      </div>
      {/* Footer label */}
      {brand.footerText && (
        <div style={{padding:"4px 8px",fontSize:8,color:"#94a3b8",
          borderTop:"1px solid #e2e8f0",textAlign:"center",background:"#fff"}}>
          {brand.footerText}
        </div>
      )}
    </div>
  );
}

/* ═══ MAIN PAGE ════════════════════════════════════════════════════ */
export default function WhiteLabel() {
  const { activeWorkspace } = useAuth();
  const [tab, setTab] = useState("brand");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  const [brand, setBrand] = useState({
    appName: "",
    logoUrl: "",
    faviconUrl: "",
    primaryColor: "#4f46e5",
    sidebarColor: "",
    topbarColor: "#ffffff",
    footerText: "",
    customDomain: "",
    removeProwosmaBranding: false,
    customEmailSender: "",
    customEmailDomain: "",
    loginBackgroundUrl: "",
    loginTitle: "",
    loginSubtitle: "",
    supportEmail: "",
    helpUrl: "",
    privacyUrl: "",
    termsUrl: "",
    customCss: "",
    customJs: "",
    pdfLogoUrl: "",
    pdfColor: "",
    pdfFooter: "",
  });

  useEffect(() => {
    getBranding()
      .then(r => {
        if (r?.data) setBrand(prev => ({ ...prev, ...r.data }));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeWorkspace?.id]);

  const set = (k, v) => setBrand(prev => ({ ...prev, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveBranding(brand);
      // Apply branding to current session immediately
      if (brand.primaryColor) {
        const lc = lighten(brand.primaryColor, 38);
        const dc = darken(brand.primaryColor, 10);
        applyDesign({
          id: "whitelabel-custom",
          sidebar: brand.sidebarColor || dc,
          sidebarText: "rgba(255,255,255,0.75)",
          sidebarActive: brand.primaryColor,
          sidebarActiveText: "#fff",
          sidebarLabel: "rgba(255,255,255,0.35)",
          topbar: brand.topbarColor || "#fff",
          topbarBorder: "#e2e8f0",
          topbarText: "#1e293b",
          brand: brand.primaryColor,
          brandLight: lc,
          brandDark: dc,
          bg: "#f8fafc",
          card: "#ffffff",
          cardBorder: "#e2e8f0",
          shadow: "0 1px 3px rgba(0,0,0,0.08)",
          text: "#1e293b",
          textMuted: "#64748b",
          accent: brand.primaryColor,
          accentText: "#fff",
          searchBg: "#f1f5f9",
          searchBorder: "#e2e8f0",
          btnPrimary: brand.primaryColor,
          btnPrimaryText: "#fff",
          radius: "8px", radiusLg: "16px", radiusFull: "9999px",
          font: "Inter, system-ui, sans-serif",
        });
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      alert("Save failed: " + (e?.response?.data?.message || e.message));
    } finally {
      setSaving(false);
    }
  };

  const TABS = [
    { id:"brand",  label:"🎨 Brand identity" },
    { id:"layout", label:"🖼 Layout & colours" },
    { id:"domain", label:"🌐 Domain & email" },
    { id:"login",  label:"🔐 Login page" },
    { id:"pdf",    label:"📄 PDF exports" },
    { id:"links",  label:"🔗 Links & legal" },
    { id:"code",   label:"</> Custom code" },
  ];

  if (loading) return <div className="wl-loading">Loading branding settings…</div>;

  return (
    <div className="wl-root">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="wl-header">
        <div>
          <h1 className="wl-title">White-label & Brand Customisation</h1>
          <p className="wl-subtitle">
            Make Prowosma look and feel like your own product. All changes apply workspace-wide.
          </p>
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          {saved && <span className="wl-saved-badge">✓ Saved</span>}
          <button className="wl-btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>

      <div className="wl-body">
        {/* ── Tabs + form ────────────────────────────────────────── */}
        <div className="wl-left">
          <div className="wl-tabs">
            {TABS.map(t => (
              <button key={t.id} className={"wl-tab"+(tab===t.id?" active":"")}
                onClick={() => setTab(t.id)}>{t.label}</button>
            ))}
          </div>

          {/* BRAND IDENTITY */}
          {tab==="brand" && (
            <div className="wl-section">
              <div className="wl-field-row">
                <LogoUploader label="Primary logo" value={brand.logoUrl}
                  onChange={v=>set("logoUrl",v)} size="100px"/>
                <LogoUploader label="Favicon (32×32)" value={brand.faviconUrl}
                  onChange={v=>set("faviconUrl",v)} size="56px"/>
                <LogoUploader label="PDF / report logo" value={brand.pdfLogoUrl}
                  onChange={v=>set("pdfLogoUrl",v)} size="80px"/>
              </div>

              <div className="wl-field">
                <label className="wl-label" htmlFor="whitelabel-app-name">Application name</label>
                <p className="wl-hint">Replaces "Prowosma" in headings, tab titles and emails.</p>
                <input className="wl-input" id="whitelabel-app-name" value={brand.appName}
                  onChange={e=>set("appName",e.target.value)}
                  placeholder="e.g. Acme PM"/>
              </div>

              <div className="wl-field">
                <label className="wl-label" htmlFor="whitelabel-primary-color">Primary brand colour</label>
                <p className="wl-hint">Used for buttons, active states, links, and highlights.</p>
                <div style={{display:"flex",gap:10,alignItems:"center"}}>
                  <input type="color" value={brand.primaryColor} id="whitelabel-primary-color"
                    onChange={e=>set("primaryColor",e.target.value)}
                    style={{width:44,height:36,border:"1px solid var(--border)",
                      borderRadius:6,cursor:"pointer",padding:2}}/>
                  <input className="wl-input" value={brand.primaryColor}
                    onChange={e=>set("primaryColor",e.target.value)}
                    placeholder="#4f46e5" style={{maxWidth:120}}/>
                </div>
                <ColorPalette primary={brand.primaryColor} onSelect={c=>set("primaryColor",c)}/>
              </div>

              <div className="wl-field">
                <label className="wl-label" htmlFor={"white-label-footer-tagline"}>Footer tagline</label>
                <input className="wl-input" value={brand.footerText}
                  onChange={e=>set("footerText",e.target.value)}
                  placeholder="© 2026 Acme Corp. All rights reserved." id={"white-label-footer-tagline"}/>
              </div>

              <div className="wl-field">
                <label className="wl-check-row">
                  <input type="checkbox" checked={brand.removeProwosmaBranding}
                    onChange={e=>set("removeProwosmaBranding",e.target.checked)}/>
                  <span>Remove all "Prowosma" branding</span>
                </label>
                <p className="wl-hint">Hides the Prowosma wordmark, logo, and footer links from all user-facing surfaces.</p>
              </div>
            </div>
          )}

          {/* LAYOUT & COLOURS */}
          {tab==="layout" && (
            <div className="wl-section">
              <div className="wl-field">
                <label className="wl-label" htmlFor="whitelabel-sidebar-color">Sidebar colour</label>
                <p className="wl-hint">Leave blank to derive automatically from primary colour.</p>
                <div style={{display:"flex",gap:10,alignItems:"center"}}>
                  <input type="color" value={brand.sidebarColor||brand.primaryColor} id="whitelabel-sidebar-color"
                    onChange={e=>set("sidebarColor",e.target.value)}
                    style={{width:44,height:36,border:"1px solid var(--border)",borderRadius:6,padding:2}}/>
                  <input className="wl-input" value={brand.sidebarColor}
                    onChange={e=>set("sidebarColor",e.target.value)}
                    placeholder="auto (derived from primary)" style={{maxWidth:220}}/>
                  {brand.sidebarColor&&<button className="wl-btn-xs" onClick={()=>set("sidebarColor","")}>Reset</button>}
                </div>
              </div>

              <div className="wl-field">
                <label className="wl-label" htmlFor={"white-label-topbar-colour"}>Topbar colour</label>
                <div style={{display:"flex",gap:10,alignItems:"center"}}>
                  <input type="color" value={brand.topbarColor||"#ffffff"}
                    onChange={e=>set("topbarColor",e.target.value)}
                    style={{width:44,height:36,border:"1px solid var(--border)",borderRadius:6,padding:2}} id={"white-label-topbar-colour"}/>
                  <input className="wl-input" value={brand.topbarColor}
                    onChange={e=>set("topbarColor",e.target.value)}
                    placeholder="#ffffff" style={{maxWidth:120}} aria-label={"Topbar colour"}/>
                </div>
              </div>

              <div className="wl-field">
                <label className="wl-label" htmlFor={"white-label-login-background-image-url"}>Login background image URL</label>
                <input className="wl-input" value={brand.loginBackgroundUrl}
                  onChange={e=>set("loginBackgroundUrl",e.target.value)}
                  placeholder="https://your-cdn.com/bg.jpg" id={"white-label-login-background-image-url"}/>
                {brand.loginBackgroundUrl && (
                  <img src={brand.loginBackgroundUrl} alt="preview"
                    style={{marginTop:8,height:80,borderRadius:8,objectFit:"cover",
                      width:"100%",border:"1px solid var(--border)"}}/>
                )}
              </div>
            </div>
          )}

          {/* DOMAIN & EMAIL */}
          {tab==="domain" && (
            <div className="wl-section">
              <div className="wl-field">
                <label className="wl-label" htmlFor="whitelabel-custom-domain">Custom domain</label>
                <p className="wl-hint">Point a CNAME from this subdomain to <code>app.prowosma.io</code>. SSL is auto-provisioned.</p>
                <div className="wl-input-prefix-row">
                  <span className="wl-input-prefix">https://</span>
                  <input className="wl-input" id="whitelabel-custom-domain" value={brand.customDomain}
                    onChange={e=>set("customDomain",e.target.value)}
                    placeholder="projects.yourcompany.com"/>
                </div>
                {brand.customDomain && (
                  <div className="wl-dns-box">
                    <div className="wl-dns-title">Required DNS record</div>
                    <div className="wl-dns-row">
                      <span className="wl-dns-key">Type</span><span>CNAME</span>
                    </div>
                    <div className="wl-dns-row">
                      <span className="wl-dns-key">Name</span>
                      <span>{brand.customDomain.split(".")[0]}</span>
                    </div>
                    <div className="wl-dns-row">
                      <span className="wl-dns-key">Value</span><span>app.prowosma.io</span>
                    </div>
                    <div className="wl-dns-row">
                      <span className="wl-dns-key">TTL</span><span>3600</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="wl-field">
                <label className="wl-label" htmlFor="whitelabel-sender-name">Email sender name</label>
                <p className="wl-hint">Appears as the "From" name in all system emails.</p>
                <input className="wl-input" id="whitelabel-sender-name" value={brand.customEmailSender}
                  onChange={e=>set("customEmailSender",e.target.value)}
                  placeholder="Acme Project Management"/>
              </div>

              <div className="wl-field">
                <label className="wl-label" htmlFor="whitelabel-sender-domain">Email sender domain</label>
                <p className="wl-hint">Requires SPF, DKIM and DMARC records on this domain.</p>
                <div className="wl-input-prefix-row">
                  <span className="wl-input-prefix">noreply@</span>
                  <input className="wl-input" id="whitelabel-sender-domain" value={brand.customEmailDomain}
                    onChange={e=>set("customEmailDomain",e.target.value)}
                    placeholder="yourcompany.com"/>
                </div>
                {brand.customEmailDomain && (
                  <div className="wl-dns-box">
                    <div className="wl-dns-title">Required DNS records for {brand.customEmailDomain}</div>
                    <div className="wl-dns-row"><span className="wl-dns-key">SPF</span>
                      <code>v=spf1 include:mail.prowosma.io ~all</code></div>
                    <div className="wl-dns-row"><span className="wl-dns-key">DKIM</span>
                      <code>prowosma._domainkey → contact support for value</code></div>
                    <div className="wl-dns-row"><span className="wl-dns-key">DMARC</span>
                      <code>v=DMARC1; p=none; rua=mailto:dmarc@prowosma.io</code></div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* LOGIN PAGE */}
          {tab==="login" && (
            <div className="wl-section">
              <div className="wl-field">
                <label className="wl-label" htmlFor={"white-label-login-page-headline"}>Login page headline</label>
                <input className="wl-input" value={brand.loginTitle}
                  onChange={e=>set("loginTitle",e.target.value)}
                  placeholder="Welcome to Acme Projects" id={"white-label-login-page-headline"}/>
              </div>
              <div className="wl-field">
                <label className="wl-label" htmlFor={"white-label-login-page-subheading"}>Login page subheading</label>
                <input className="wl-input" value={brand.loginSubtitle}
                  onChange={e=>set("loginSubtitle",e.target.value)}
                  placeholder="Sign in to manage your team's work" id={"white-label-login-page-subheading"}/>
              </div>
              <div className="wl-field">
                <label className="wl-label" htmlFor={"white-label-login-background-image"}>Login background image</label>
                <input className="wl-input" value={brand.loginBackgroundUrl}
                  onChange={e=>set("loginBackgroundUrl",e.target.value)}
                  placeholder="https://images.unsplash.com/..." id={"white-label-login-background-image"}/>
              </div>
              <div className="wl-field">
                <p className="wl-hint" style={{fontSize:12}}>
                  💡 Tip: Use Unsplash (unsplash.com) for free professional background images.
                  Recommended size: 1920×1080px.
                </p>
              </div>
            </div>
          )}

          {/* PDF EXPORTS */}
          {tab==="pdf" && (
            <div className="wl-section">
              <LogoUploader label="PDF report logo" value={brand.pdfLogoUrl}
                onChange={v=>set("pdfLogoUrl",v)} size="100px"/>
              <div className="wl-field" style={{marginTop:16}}>
                <label className="wl-label" htmlFor={"white-label-pdf-accent-colour"}>PDF accent colour</label>
                <div style={{display:"flex",gap:10,alignItems:"center"}}>
                  <input type="color" value={brand.pdfColor||brand.primaryColor}
                    onChange={e=>set("pdfColor",e.target.value)}
                    style={{width:44,height:36,border:"1px solid var(--border)",borderRadius:6,padding:2}} id={"white-label-pdf-accent-colour"}/>
                  <input className="wl-input" value={brand.pdfColor}
                    onChange={e=>set("pdfColor",e.target.value)}
                    placeholder="Same as primary colour" style={{maxWidth:200}} aria-label={"PDF accent colour"}/>
                </div>
              </div>
              <div className="wl-field">
                <label className="wl-label" htmlFor={"white-label-pdf-footer-text"}>PDF footer text</label>
                <input className="wl-input" value={brand.pdfFooter}
                  onChange={e=>set("pdfFooter",e.target.value)}
                  placeholder="Confidential — Acme Corp Internal Report" id={"white-label-pdf-footer-text"}/>
              </div>
            </div>
          )}

          {/* LINKS & LEGAL */}
          {tab==="links" && (
            <div className="wl-section">
              <div className="wl-field">
                <label className="wl-label" htmlFor={"white-label-support-email"}>Support email</label>
                <input className="wl-input" value={brand.supportEmail}
                  onChange={e=>set("supportEmail",e.target.value)}
                  placeholder="support@yourcompany.com" id={"white-label-support-email"}/>
              </div>
              <div className="wl-field">
                <label className="wl-label" htmlFor={"white-label-help-centre-url"}>Help centre URL</label>
                <input className="wl-input" value={brand.helpUrl}
                  onChange={e=>set("helpUrl",e.target.value)}
                  placeholder="https://help.yourcompany.com" id={"white-label-help-centre-url"}/>
              </div>
              <div className="wl-field">
                <label className="wl-label" htmlFor={"white-label-privacy-policy-url"}>Privacy policy URL</label>
                <input className="wl-input" value={brand.privacyUrl}
                  onChange={e=>set("privacyUrl",e.target.value)}
                  placeholder="https://yourcompany.com/privacy" id={"white-label-privacy-policy-url"}/>
              </div>
              <div className="wl-field">
                <label className="wl-label" htmlFor={"white-label-terms-of-service-url"}>Terms of service URL</label>
                <input className="wl-input" value={brand.termsUrl}
                  onChange={e=>set("termsUrl",e.target.value)}
                  placeholder="https://yourcompany.com/terms" id={"white-label-terms-of-service-url"}/>
              </div>
            </div>
          )}

          {/* CUSTOM CODE */}
          {tab==="code" && (
            <div className="wl-section">
              <div className="wl-field">
                <label className="wl-label" htmlFor="whitelabel-custom-css">Custom CSS</label>
                <p className="wl-hint">Injected into the <code>&lt;head&gt;</code> of every page. Use CSS variables like <code>var(--ds-brand)</code>.</p>
                <textarea className="wl-code-editor" rows={10} id="whitelabel-custom-css"
                  value={brand.customCss}
                  onChange={e=>set("customCss",e.target.value)}
                  placeholder={`.sidebar-nav { border-right: 3px solid var(--ds-brand); }\n.page-title { font-family: 'Georgia', serif; }`}
                  spellCheck={false}/>
              </div>
              <div className="wl-field">
                <label className="wl-label" htmlFor="whitelabel-custom-js">Custom JavaScript</label>
                <p className="wl-hint">⚠️ Use with caution — runs on every page after React mounts. Do not include <code>&lt;script&gt;</code> tags.</p>
                <textarea className="wl-code-editor" rows={6} id="whitelabel-custom-js"
                  value={brand.customJs}
                  onChange={e=>set("customJs",e.target.value)}
                  placeholder={`// Example: add custom analytics\nwindow.dataLayer = window.dataLayer || [];\n// gtag('config', 'G-XXXXXXXX');`}
                  spellCheck={false}/>
              </div>
            </div>
          )}
        </div>

        {/* ── Live preview ────────────────────────────────────────── */}
        <div className="wl-right">
          <div className="wl-preview-label">Live preview</div>
          <LivePreview brand={brand}/>
          <div className="wl-preview-note">
            Preview updates as you type. Save to apply workspace-wide.
          </div>

          {/* Brand summary */}
          <div className="wl-brand-summary">
            <div className="wl-bs-row">
              <span className="wl-bs-key">App name</span>
              <span className="wl-bs-val">{brand.appName||"Prowosma"}</span>
            </div>
            <div className="wl-bs-row">
              <span className="wl-bs-key">Primary colour</span>
              <span style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{width:14,height:14,borderRadius:3,
                  background:brand.primaryColor,display:"inline-block",
                  border:"1px solid rgba(0,0,0,0.1)"}}/>
                <span className="wl-bs-val">{brand.primaryColor}</span>
              </span>
            </div>
            <div className="wl-bs-row">
              <span className="wl-bs-key">Custom domain</span>
              <span className="wl-bs-val">{brand.customDomain||"—"}</span>
            </div>
            <div className="wl-bs-row">
              <span className="wl-bs-key">Remove branding</span>
              <span className="wl-bs-val">{brand.removeProwosmaBranding?"Yes":"No"}</span>
            </div>
            <div className="wl-bs-row">
              <span className="wl-bs-key">Email sender</span>
              <span className="wl-bs-val">
                {brand.customEmailSender
                  ? `${brand.customEmailSender} <noreply@${brand.customEmailDomain||"..."}>`
                  : "Default (Prowosma)"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
