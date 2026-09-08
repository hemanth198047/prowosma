// Extracted from DesignSwitcher.jsx so this file has no non-component
// exports — react-refresh/only-export-components requires files that
// export a component to export *only* components, or Fast Refresh
// (HMR) can't reliably preserve state across edits.

export const BUILT_IN_DESIGNS = [
  // ── PROFESSIONAL ──────────────────────────────────────────────────
  {
    id:"corp-blue", name:"Corporate Blue", category:"Professional",
    preview:["#1d4ed8","#3b82f6","#dbeafe","#f8fafc","#1e40af"],
    font:"Inter, system-ui, sans-serif",
    radius:"8px", radiusLg:"16px", radiusFull:"9999px",
    sidebar:"#1e3a5f", sidebarText:"rgba(255,255,255,0.75)", sidebarActive:"#3b82f6",
    sidebarActiveText:"#fff", sidebarLabel:"rgba(255,255,255,0.35)",
    topbar:"#ffffff", topbarBorder:"#e2e8f0", topbarText:"#1e293b",
    brand:"#1d4ed8", brandLight:"#dbeafe", brandDark:"#1e40af",
    bg:"#f8fafc", card:"#ffffff", cardBorder:"#e2e8f0",
    shadow:"0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)",
    text:"#1e293b", textMuted:"#64748b",
    accent:"#3b82f6", accentText:"#fff",
    searchBg:"#f1f5f9", searchBorder:"#e2e8f0",
    btnPrimary:"#1d4ed8", btnPrimaryText:"#fff",
    badge:"#dbeafe", badgeText:"#1d4ed8",
  },  {
    id:"slate-pro", name:"Slate Pro", category:"Professional",
    preview:["#334155","#475569","#64748b","#f1f5f9","#0ea5e9"],
    font:"'DM Sans', Inter, sans-serif",
    radius:"10px", radiusLg:"18px", radiusFull:"9999px",
    sidebar:"#1e293b", sidebarText:"rgba(255,255,255,0.6)", sidebarActive:"#0ea5e9",
    sidebarActiveText:"#fff", sidebarLabel:"rgba(255,255,255,0.3)",
    topbar:"#f8fafc", topbarBorder:"#e2e8f0", topbarText:"#1e293b",
    brand:"#0ea5e9", brandLight:"#e0f2fe", brandDark:"#0284c7",
    bg:"#f1f5f9", card:"#ffffff", cardBorder:"#e2e8f0",
    shadow:"0 2px 8px rgba(15,23,42,0.08)",
    text:"#1e293b", textMuted:"#64748b",
    accent:"#0ea5e9", accentText:"#fff",
    searchBg:"#fff", searchBorder:"#cbd5e1",
    btnPrimary:"#0284c7", btnPrimaryText:"#fff",
    badge:"#e0f2fe", badgeText:"#0369a1",
  },
  {
    id:"navy-gold", name:"Navy & Gold", category:"Professional",
    preview:["#1e3a5f","#2563eb","#fbbf24","#fffbeb","#f8fafc"],
    font:"'Playfair Display', Georgia, serif",
    radius:"4px", radiusLg:"8px", radiusFull:"4px",
    sidebar:"#1e3a5f", sidebarText:"rgba(255,255,255,0.75)", sidebarActive:"#fbbf24",
    sidebarActiveText:"#1e3a5f", sidebarLabel:"rgba(255,255,255,0.35)",
    topbar:"#ffffff", topbarBorder:"#e5e7eb", topbarText:"#111827",
    brand:"#fbbf24", brandLight:"#fffbeb", brandDark:"#d97706",
    bg:"#f9fafb", card:"#ffffff", cardBorder:"#e5e7eb",
    shadow:"0 1px 4px rgba(30,58,95,0.1)",
    text:"#111827", textMuted:"#6b7280",
    accent:"#fbbf24", accentText:"#1e3a5f",
    searchBg:"#f9fafb", searchBorder:"#d1d5db",
    btnPrimary:"#1e3a5f", btnPrimaryText:"#fff",
    badge:"#fffbeb", badgeText:"#92400e",
  },
  {
    id:"teal-corp", name:"Teal Corporate", category:"Professional",
    preview:["#0d9488","#14b8a6","#ccfbf1","#f0fdfa","#1e293b"],
    font:"Inter, system-ui, sans-serif",
    radius:"8px", radiusLg:"16px", radiusFull:"9999px",
    sidebar:"#134e4a", sidebarText:"rgba(255,255,255,0.7)", sidebarActive:"#14b8a6",
    sidebarActiveText:"#fff", sidebarLabel:"rgba(255,255,255,0.35)",
    topbar:"#ffffff", topbarBorder:"#ccfbf1", topbarText:"#134e4a",
    brand:"#0d9488", brandLight:"#ccfbf1", brandDark:"#0f766e",
    bg:"#f0fdfa", card:"#ffffff", cardBorder:"#99f6e4",
    shadow:"0 2px 8px rgba(13,148,136,0.1)",
    text:"#134e4a", textMuted:"#5eead4",
    accent:"#0d9488", accentText:"#fff",
    searchBg:"#f0fdfa", searchBorder:"#99f6e4",
    btnPrimary:"#0d9488", btnPrimaryText:"#fff",
    badge:"#ccfbf1", badgeText:"#0f766e",
  },
  {
    id:"charcoal", name:"Charcoal Pro", category:"Professional",
    preview:["#18181b","#27272a","#52525b","#a1a1aa","#f4f4f5"],
    font:"'IBM Plex Sans', Inter, sans-serif",
    radius:"6px", radiusLg:"12px", radiusFull:"9999px",
    sidebar:"#18181b", sidebarText:"rgba(255,255,255,0.6)", sidebarActive:"#e4e4e7",
    sidebarActiveText:"#18181b", sidebarLabel:"rgba(255,255,255,0.3)",
    topbar:"#ffffff", topbarBorder:"#e4e4e7", topbarText:"#18181b",
    brand:"#52525b", brandLight:"#f4f4f5", brandDark:"#27272a",
    bg:"#fafafa", card:"#ffffff", cardBorder:"#e4e4e7",
    shadow:"0 1px 3px rgba(0,0,0,0.06)",
    text:"#18181b", textMuted:"#71717a",
    accent:"#18181b", accentText:"#fff",
    searchBg:"#f4f4f5", searchBorder:"#d4d4d8",
    btnPrimary:"#18181b", btnPrimaryText:"#fff",
    badge:"#f4f4f5", badgeText:"#3f3f46",
  },
  {
    id:"candy", name:"Candy Pop", category:"Playful",
    preview:["#ec4899","#f472b6","#fb7185","#fef3c7","#a78bfa"],
    font:"'Nunito', 'Poppins', sans-serif",
    radius:"16px", radiusLg:"24px", radiusFull:"9999px",
    sidebar:"#4a044e", sidebarText:"rgba(255,255,255,0.75)", sidebarActive:"#f472b6",
    sidebarActiveText:"#fff", sidebarLabel:"rgba(255,255,255,0.4)",
    topbar:"#ffffff", topbarBorder:"#fce7f3", topbarText:"#831843",
    brand:"#ec4899", brandLight:"#fce7f3", brandDark:"#be185d",
    bg:"#fdf2f8", card:"#ffffff", cardBorder:"#fce7f3",
    shadow:"0 4px 20px rgba(236,72,153,0.12)",
    text:"#831843", textMuted:"#db2777",
    accent:"#ec4899", accentText:"#fff",
    searchBg:"#fdf2f8", searchBorder:"#f9a8d4",
    btnPrimary:"#ec4899", btnPrimaryText:"#fff",
    badge:"#fce7f3", badgeText:"#be185d",
  },  {
    id:"bubblegum", name:"Bubblegum", category:"Playful",
    preview:["#a855f7","#c084fc","#fb7185","#fce7f3","#fbbf24"],
    font:"'Nunito', sans-serif",
    radius:"20px", radiusLg:"28px", radiusFull:"9999px",
    sidebar:"#3b0764", sidebarText:"rgba(255,255,255,0.75)", sidebarActive:"#c084fc",
    sidebarActiveText:"#fff", sidebarLabel:"rgba(255,255,255,0.35)",
    topbar:"#fefce8", topbarBorder:"#fef08a", topbarText:"#3b0764",
    brand:"#a855f7", brandLight:"#f3e8ff", brandDark:"#7e22ce",
    bg:"#fef9ff", card:"#fff", cardBorder:"#e9d5ff",
    shadow:"0 6px 24px rgba(168,85,247,0.15)",
    text:"#3b0764", textMuted:"#9333ea",
    accent:"#a855f7", accentText:"#fff",
    searchBg:"#faf5ff", searchBorder:"#d8b4fe",
    btnPrimary:"#a855f7", btnPrimaryText:"#fff",
    badge:"#f3e8ff", badgeText:"#7e22ce",
  },
  {
    id:"citrus", name:"Citrus Zest", category:"Playful",
    preview:["#eab308","#ca8a04","#f97316","#fff7ed","#84cc16"],
    font:"'Poppins', sans-serif",
    radius:"12px", radiusLg:"20px", radiusFull:"9999px",
    sidebar:"#422006", sidebarText:"rgba(255,255,255,0.75)", sidebarActive:"#eab308",
    sidebarActiveText:"#422006", sidebarLabel:"rgba(255,255,255,0.4)",
    topbar:"#fffbeb", topbarBorder:"#fde68a", topbarText:"#92400e",
    brand:"#eab308", brandLight:"#fefce8", brandDark:"#ca8a04",
    bg:"#fffdf0", card:"#fff", cardBorder:"#fde68a",
    shadow:"0 4px 16px rgba(234,179,8,0.15)",
    text:"#92400e", textMuted:"#d97706",
    accent:"#eab308", accentText:"#422006",
    searchBg:"#fefce8", searchBorder:"#fcd34d",
    btnPrimary:"#ca8a04", btnPrimaryText:"#fff",
    badge:"#fefce8", badgeText:"#92400e",
  },
  {
    id:"midnight", name:"Midnight", category:"Dark",
    preview:["#020817","#0f172a","#1e293b","#6366f1","#22d3ee"],
    font:"Inter, system-ui, sans-serif",
    radius:"8px", radiusLg:"16px", radiusFull:"9999px",
    sidebar:"#020817", sidebarText:"rgba(255,255,255,0.55)", sidebarActive:"#6366f1",
    sidebarActiveText:"#fff", sidebarLabel:"rgba(255,255,255,0.25)",
    topbar:"#0f172a", topbarBorder:"rgba(255,255,255,0.08)", topbarText:"#e2e8f0",
    brand:"#6366f1", brandLight:"rgba(99,102,241,0.15)", brandDark:"#4f46e5",
    bg:"#020817", card:"#0f172a", cardBorder:"rgba(255,255,255,0.07)",
    shadow:"0 4px 24px rgba(0,0,0,0.5)",
    text:"#e2e8f0", textMuted:"#64748b",
    accent:"#6366f1", accentText:"#fff",
    searchBg:"rgba(255,255,255,0.05)", searchBorder:"rgba(255,255,255,0.1)",
    btnPrimary:"#6366f1", btnPrimaryText:"#fff",
    badge:"rgba(99,102,241,0.2)", badgeText:"#a5b4fc",
  },
  {
    id:"dracula", name:"Dracula", category:"Dark",
    preview:["#282a36","#44475a","#bd93f9","#ff79c6","#50fa7b"],
    font:"'Fira Code', 'JetBrains Mono', monospace",
    radius:"6px", radiusLg:"10px", radiusFull:"9999px",
    sidebar:"#1e1f29", sidebarText:"#6272a4", sidebarActive:"#bd93f9",
    sidebarActiveText:"#fff", sidebarLabel:"#44475a",
    topbar:"#282a36", topbarBorder:"#44475a", topbarText:"#f8f8f2",
    brand:"#bd93f9", brandLight:"rgba(189,147,249,0.15)", brandDark:"#9d79e0",
    bg:"#1a1b24", card:"#282a36", cardBorder:"#44475a",
    shadow:"0 4px 20px rgba(0,0,0,0.6)",
    text:"#f8f8f2", textMuted:"#6272a4",
    accent:"#ff79c6", accentText:"#282a36",
    searchBg:"rgba(255,255,255,0.05)", searchBorder:"#44475a",
    btnPrimary:"#bd93f9", btnPrimaryText:"#282a36",
    badge:"rgba(189,147,249,0.15)", badgeText:"#bd93f9",
  },
  {
    id:"monokai", name:"Monokai Pro", category:"Dark",
    preview:["#272822","#3e3d32","#f92672","#66d9e8","#a6e22e"],
    font:"'Fira Code', monospace",
    radius:"5px", radiusLg:"8px", radiusFull:"9999px",
    sidebar:"#1c1c17", sidebarText:"#75715e", sidebarActive:"#f92672",
    sidebarActiveText:"#fff", sidebarLabel:"#3e3d32",
    topbar:"#272822", topbarBorder:"#3e3d32", topbarText:"#f8f8f2",
    brand:"#a6e22e", brandLight:"rgba(166,226,46,0.12)", brandDark:"#8bc51e",
    bg:"#1c1c17", card:"#272822", cardBorder:"#3e3d32",
    shadow:"0 4px 16px rgba(0,0,0,0.5)",
    text:"#f8f8f2", textMuted:"#75715e",
    accent:"#f92672", accentText:"#fff",
    searchBg:"rgba(255,255,255,0.04)", searchBorder:"#3e3d32",
    btnPrimary:"#f92672", btnPrimaryText:"#fff",
    badge:"rgba(249,38,114,0.15)", badgeText:"#f92672",
  },
  {
    id:"nord", name:"Nord Aurora", category:"Dark",
    preview:["#2e3440","#3b4252","#88c0d0","#81a1c1","#a3be8c"],
    font:"'JetBrains Mono', 'Fira Code', monospace",
    radius:"8px", radiusLg:"14px", radiusFull:"9999px",
    sidebar:"#2e3440", sidebarText:"#7a8a99", sidebarActive:"#88c0d0",
    sidebarActiveText:"#2e3440", sidebarLabel:"#4c566a",
    topbar:"#3b4252", topbarBorder:"#4c566a", topbarText:"#eceff4",
    brand:"#88c0d0", brandLight:"rgba(136,192,208,0.12)", brandDark:"#5e81ac",
    bg:"#242933", card:"#2e3440", cardBorder:"#3b4252",
    shadow:"0 4px 16px rgba(0,0,0,0.4)",
    text:"#eceff4", textMuted:"#7a8a99",
    accent:"#88c0d0", accentText:"#2e3440",
    searchBg:"rgba(255,255,255,0.05)", searchBorder:"#4c566a",
    btnPrimary:"#88c0d0", btnPrimaryText:"#2e3440",
    badge:"rgba(136,192,208,0.15)", badgeText:"#88c0d0",
  },
  {
    id:"one-dark", name:"One Dark Pro", category:"Dark",
    preview:["#21252b","#282c34","#61afef","#98c379","#e06c75"],
    font:"'JetBrains Mono', monospace",
    radius:"6px", radiusLg:"10px", radiusFull:"9999px",
    sidebar:"#21252b", sidebarText:"#5c6370", sidebarActive:"#61afef",
    sidebarActiveText:"#fff", sidebarLabel:"#3e4451",
    topbar:"#282c34", topbarBorder:"#3e4451", topbarText:"#abb2bf",
    brand:"#61afef", brandLight:"rgba(97,175,239,0.12)", brandDark:"#4d8fd8",
    bg:"#1c2026", card:"#21252b", cardBorder:"#3e4451",
    shadow:"0 4px 16px rgba(0,0,0,0.45)",
    text:"#abb2bf", textMuted:"#5c6370",
    accent:"#61afef", accentText:"#fff",
    searchBg:"rgba(255,255,255,0.05)", searchBorder:"#3e4451",
    btnPrimary:"#61afef", btnPrimaryText:"#282c34",
    badge:"rgba(97,175,239,0.15)", badgeText:"#61afef",
  },
  {
    id:"abyss", name:"Deep Abyss", category:"Dark",
    preview:["#000814","#001d3d","#003566","#ffd60a","#0096c7"],
    font:"Inter, system-ui, sans-serif",
    radius:"8px", radiusLg:"14px", radiusFull:"9999px",
    sidebar:"#000814", sidebarText:"rgba(255,255,255,0.5)", sidebarActive:"#ffd60a",
    sidebarActiveText:"#000814", sidebarLabel:"rgba(255,255,255,0.2)",
    topbar:"#001d3d", topbarBorder:"rgba(255,255,255,0.08)", topbarText:"#e2e8f0",
    brand:"#0096c7", brandLight:"rgba(0,150,199,0.15)", brandDark:"#0077a8",
    bg:"#000814", card:"#001d3d", cardBorder:"rgba(255,255,255,0.08)",
    shadow:"0 8px 32px rgba(0,0,0,0.7)",
    text:"#e2e8f0", textMuted:"#64748b",
    accent:"#ffd60a", accentText:"#000814",
    searchBg:"rgba(255,255,255,0.04)", searchBorder:"rgba(255,255,255,0.1)",
    btnPrimary:"#ffd60a", btnPrimaryText:"#000814",
    badge:"rgba(255,214,10,0.15)", badgeText:"#ffd60a",
  },
  {
    id:"earth", name:"Earth Tones", category:"Nature",
    preview:["#78350f","#92400e","#d97706","#fef3c7","#f5f0e8"],
    font:"'Merriweather', Georgia, serif",
    radius:"8px", radiusLg:"14px", radiusFull:"9999px",
    sidebar:"#451a03", sidebarText:"rgba(255,255,255,0.7)", sidebarActive:"#f59e0b",
    sidebarActiveText:"#451a03", sidebarLabel:"rgba(255,255,255,0.35)",
    topbar:"#fff8f0", topbarBorder:"#fde68a", topbarText:"#78350f",
    brand:"#d97706", brandLight:"#fef3c7", brandDark:"#b45309",
    bg:"#fefce8", card:"#fffef5", cardBorder:"#fde68a",
    shadow:"0 2px 10px rgba(120,53,15,0.1)",
    text:"#78350f", textMuted:"#b45309",
    accent:"#d97706", accentText:"#fff",
    searchBg:"#fef9e7", searchBorder:"#fcd34d",
    btnPrimary:"#d97706", btnPrimaryText:"#fff",
    badge:"#fef3c7", badgeText:"#92400e",
  },
  {
    id:"lavender", name:"Lavender Fields", category:"Nature",
    preview:["#7c3aed","#8b5cf6","#c4b5fd","#ede9fe","#f5f3ff"],
    font:"'Lato', sans-serif",
    radius:"12px", radiusLg:"20px", radiusFull:"9999px",
    sidebar:"#4c1d95", sidebarText:"rgba(255,255,255,0.7)", sidebarActive:"#c4b5fd",
    sidebarActiveText:"#4c1d95", sidebarLabel:"rgba(255,255,255,0.35)",
    topbar:"#f5f3ff", topbarBorder:"#ede9fe", topbarText:"#4c1d95",
    brand:"#7c3aed", brandLight:"#ede9fe", brandDark:"#6d28d9",
    bg:"#faf5ff", card:"#fff", cardBorder:"#ddd6fe",
    shadow:"0 2px 12px rgba(124,58,237,0.1)",
    text:"#4c1d95", textMuted:"#7c3aed",
    accent:"#7c3aed", accentText:"#fff",
    searchBg:"#faf5ff", searchBorder:"#c4b5fd",
    btnPrimary:"#7c3aed", btnPrimaryText:"#fff",
    badge:"#ede9fe", badgeText:"#6d28d9",
  },
  {
    id:"ocean-deep", name:"Ocean Deep", category:"Nature",
    preview:["#0c4a6e","#075985","#0ea5e9","#bae6fd","#f0f9ff"],
    font:"Inter, sans-serif",
    radius:"10px", radiusLg:"18px", radiusFull:"9999px",
    sidebar:"#0c4a6e", sidebarText:"rgba(255,255,255,0.7)", sidebarActive:"#38bdf8",
    sidebarActiveText:"#0c4a6e", sidebarLabel:"rgba(255,255,255,0.3)",
    topbar:"#f0f9ff", topbarBorder:"#bae6fd", topbarText:"#0c4a6e",
    brand:"#0ea5e9", brandLight:"#e0f2fe", brandDark:"#0284c7",
    bg:"#f0f9ff", card:"#fff", cardBorder:"#bae6fd",
    shadow:"0 2px 12px rgba(12,74,110,0.1)",
    text:"#0c4a6e", textMuted:"#0284c7",
    accent:"#0ea5e9", accentText:"#fff",
    searchBg:"#f0f9ff", searchBorder:"#7dd3fc",
    btnPrimary:"#0284c7", btnPrimaryText:"#fff",
    badge:"#e0f2fe", badgeText:"#0369a1",
  },
  {
    id:"cherry", name:"Cherry Blossom", category:"Nature",
    preview:["#9d174d","#be185d","#f472b6","#fce7f3","#fff0f8"],
    font:"'Lato', sans-serif",
    radius:"12px", radiusLg:"20px", radiusFull:"9999px",
    sidebar:"#500724", sidebarText:"rgba(255,255,255,0.7)", sidebarActive:"#f472b6",
    sidebarActiveText:"#fff", sidebarLabel:"rgba(255,255,255,0.35)",
    topbar:"#fff0f8", topbarBorder:"#fce7f3", topbarText:"#9d174d",
    brand:"#be185d", brandLight:"#fce7f3", brandDark:"#9d174d",
    bg:"#fff0f8", card:"#fff", cardBorder:"#fbcfe8",
    shadow:"0 2px 12px rgba(157,23,77,0.1)",
    text:"#9d174d", textMuted:"#db2777",
    accent:"#be185d", accentText:"#fff",
    searchBg:"#fff0f8", searchBorder:"#f9a8d4",
    btnPrimary:"#be185d", btnPrimaryText:"#fff",
    badge:"#fce7f3", badgeText:"#9d174d",
  },
  {
    id:"sage", name:"Sage & Stone", category:"Nature",
    preview:["#4d7c0f","#65a30d","#a3e635","#ecfccb","#f7fef4"],
    font:"'Lato', sans-serif",
    radius:"8px", radiusLg:"14px", radiusFull:"9999px",
    sidebar:"#1a2e05", sidebarText:"rgba(255,255,255,0.65)", sidebarActive:"#a3e635",
    sidebarActiveText:"#1a2e05", sidebarLabel:"rgba(255,255,255,0.3)",
    topbar:"#f7fef4", topbarBorder:"#d9f99d", topbarText:"#1a2e05",
    brand:"#65a30d", brandLight:"#ecfccb", brandDark:"#4d7c0f",
    bg:"#f7fef4", card:"#fff", cardBorder:"#d9f99d",
    shadow:"0 2px 10px rgba(77,124,15,0.1)",
    text:"#1a2e05", textMuted:"#65a30d",
    accent:"#65a30d", accentText:"#fff",
    searchBg:"#f7fef4", searchBorder:"#bef264",
    btnPrimary:"#65a30d", btnPrimaryText:"#fff",
    badge:"#ecfccb", badgeText:"#3f6212",
  },
  {
    id:"pure-white", name:"Pure White", category:"Minimal",
    preview:["#ffffff","#f9fafb","#f3f4f6","#6b7280","#111827"],
    font:"Inter, system-ui, sans-serif",
    radius:"6px", radiusLg:"10px", radiusFull:"9999px",
    sidebar:"#ffffff", sidebarText:"#6b7280", sidebarActive:"#111827",
    sidebarActiveText:"#fff", sidebarLabel:"#9ca3af",
    topbar:"#ffffff", topbarBorder:"#f3f4f6", topbarText:"#111827",
    brand:"#111827", brandLight:"#f9fafb", brandDark:"#030712",
    bg:"#f9fafb", card:"#ffffff", cardBorder:"#f3f4f6",
    shadow:"0 1px 2px rgba(0,0,0,0.04)",
    text:"#111827", textMuted:"#6b7280",
    accent:"#111827", accentText:"#fff",
    searchBg:"#f9fafb", searchBorder:"#e5e7eb",
    btnPrimary:"#111827", btnPrimaryText:"#fff",
    badge:"#f3f4f6", badgeText:"#374151",
  },
  {
    id:"paper", name:"Paper & Ink", category:"Minimal",
    preview:["#fafaf9","#f5f5f4","#78716c","#292524","#e7e5e4"],
    font:"'Merriweather', Georgia, serif",
    radius:"4px", radiusLg:"6px", radiusFull:"4px",
    sidebar:"#1c1917", sidebarText:"rgba(255,255,255,0.6)", sidebarActive:"#e7e5e4",
    sidebarActiveText:"#1c1917", sidebarLabel:"rgba(255,255,255,0.3)",
    topbar:"#fafaf9", topbarBorder:"#e7e5e4", topbarText:"#1c1917",
    brand:"#292524", brandLight:"#f5f5f4", brandDark:"#1c1917",
    bg:"#fafaf9", card:"#ffffff", cardBorder:"#e7e5e4",
    shadow:"0 1px 2px rgba(0,0,0,0.06)",
    text:"#292524", textMuted:"#78716c",
    accent:"#292524", accentText:"#fff",
    searchBg:"#f5f5f4", searchBorder:"#d6d3d1",
    btnPrimary:"#292524", btnPrimaryText:"#fff",
    badge:"#f5f5f4", badgeText:"#57534e",
  },
  {
    id:"clean-indigo", name:"Clean Indigo", category:"Minimal",
    preview:["#4f46e5","#6366f1","#818cf8","#e0e7ff","#eef2ff"],
    font:"Inter, system-ui, sans-serif",
    radius:"8px", radiusLg:"14px", radiusFull:"9999px",
    sidebar:"#312e81", sidebarText:"rgba(255,255,255,0.65)", sidebarActive:"#818cf8",
    sidebarActiveText:"#fff", sidebarLabel:"rgba(255,255,255,0.3)",
    topbar:"#ffffff", topbarBorder:"#e0e7ff", topbarText:"#312e81",
    brand:"#4f46e5", brandLight:"#eef2ff", brandDark:"#4338ca",
    bg:"#eef2ff", card:"#ffffff", cardBorder:"#e0e7ff",
    shadow:"0 2px 8px rgba(79,70,229,0.1)",
    text:"#312e81", textMuted:"#6366f1",
    accent:"#4f46e5", accentText:"#fff",
    searchBg:"#eef2ff", searchBorder:"#c7d2fe",
    btnPrimary:"#4f46e5", btnPrimaryText:"#fff",
    badge:"#e0e7ff", badgeText:"#4338ca",
  },
  {
    id:"mono-green", name:"Mono Green", category:"Minimal",
    preview:["#052e16","#14532d","#16a34a","#dcfce7","#f0fdf4"],
    font:"'IBM Plex Mono', monospace",
    radius:"4px", radiusLg:"6px", radiusFull:"4px",
    sidebar:"#052e16", sidebarText:"rgba(255,255,255,0.6)", sidebarActive:"#22c55e",
    sidebarActiveText:"#052e16", sidebarLabel:"rgba(255,255,255,0.25)",
    topbar:"#f0fdf4", topbarBorder:"#bbf7d0", topbarText:"#052e16",
    brand:"#16a34a", brandLight:"#dcfce7", brandDark:"#15803d",
    bg:"#f0fdf4", card:"#fff", cardBorder:"#bbf7d0",
    shadow:"0 1px 3px rgba(5,46,22,0.08)",
    text:"#052e16", textMuted:"#16a34a",
    accent:"#16a34a", accentText:"#fff",
    searchBg:"#f0fdf4", searchBorder:"#86efac",
    btnPrimary:"#16a34a", btnPrimaryText:"#fff",
    badge:"#dcfce7", badgeText:"#15803d",
  },
];

export const CATEGORIES = ["All", "Professional", "Playful", "Dark", "Nature", "Minimal", "Retro", "Neon", "Custom"];

/* ─── Apply design to DOM ──────────────────────────────────────── */
export function applyDesign(design) {
  const root = document.documentElement;
  const body = document.body;

  // ── Helper functions ──────────────────────────────────────────
  function hex2rgb(hex) {
    const h = hex.replace('#','');
    if (h.length < 6) return [128,128,128];
    return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
  }
  function rgba(hex, a) {
    try { const [r,g,b] = hex2rgb(hex); return "rgba("+r+","+g+","+b+","+a+")"; }
    catch { return hex; }
  }
  const brand     = design.brand      || "#6366f1";
  const brandDark = design.brandDark  || brand;
  const brandLight= design.brandLight || rgba(brand, 0.15);
  const card      = design.card       || "#ffffff";
  const cardBdr   = design.cardBorder || "#e2e8f0";
  const text      = design.text       || "#1e293b";
  const textMuted = design.textMuted  || "#64748b";
  const topbar    = design.topbar     || "#ffffff";
  const topbarBdr = design.topbarBorder || cardBdr;
  // Detect dark designs properly
  const DARK_IDS = new Set(["midnight","dracula","monokai","nord","one-dark","abyss",
    "charcoal","neon-blue","neon-green","neon-purple","neon-orange","neon-pink",
    "neon-coral","retro-80s","retro-terminal","retro-amber","vaporwave"]);
  const isDark = design.category === "Dark" || design.category === "Neon"
    || DARK_IDS.has(design.id)
    || (design.bg && (design.bg.includes("0f172a") || design.bg.includes("020817")
        || design.bg.includes("000814") || design.bg.includes("001100")))
    || (design.sidebar && (design.sidebar.startsWith("#0") || design.sidebar.startsWith("#1")
        || design.sidebar.startsWith("#2") || design.sidebar.includes("rgba(0")
        || design.sidebar.includes("rgba(1")));

  // Derive gray scale from text colour so it's always readable
  const grayScale = isDark ? {
    "50":"rgba(255,255,255,0.04)","100":"rgba(255,255,255,0.08)",
    "200":"rgba(255,255,255,0.12)","300":"rgba(255,255,255,0.25)",
    "400":"rgba(255,255,255,0.45)","500":"rgba(255,255,255,0.6)",
    "600":"rgba(255,255,255,0.72)","700":"rgba(255,255,255,0.82)",
    "800":"rgba(255,255,255,0.92)","900":"rgba(255,255,255,0.97)",
  } : {
    "50":"#f8fafc","100":"#f1f5f9","200":"#e2e8f0","300":"#cbd5e1",
    "400":"#94a3b8","500":"#64748b","600":"#475569","700":"#334155",
    "800":"#1e293b","900":"#0f172a",
  };

  // ── 1. Brand colours ──────────────────────────────────────────────
  root.style.setProperty("--brand-500",   brand);
  root.style.setProperty("--brand-600",   brandDark);
  root.style.setProperty("--brand-700",   brandDark);
  root.style.setProperty("--brand-50",    brandLight);
  root.style.setProperty("--brand-100",   brandLight);
  root.style.setProperty("--accent-500",  brand);
  root.style.setProperty("--accent-600",  brandDark);
  root.style.setProperty("--ds-brand",    brand);

  // ── 2. Gray scale (adapts to light/dark) ─────────────────────────
  Object.entries(grayScale).forEach(([k,v]) => root.style.setProperty("--gray-"+k, v));

  // ── 3. Page & card backgrounds ───────────────────────────────────
  const pageBg = (design.bg && (design.bg.includes("http")||design.bg.startsWith("linear")))
    ? (design.bgFallback || "#0f172a") : (design.bg || "#f8fafc");
  root.style.setProperty("--bg-page",     pageBg);
  root.style.setProperty("--bg-card",     card);
  root.style.setProperty("--bg-input",    card);
  root.style.setProperty("--border",      cardBdr);

  // For scenic/image designs: use semi-transparent frosted cards
  const isImageDesign = design.bg && (design.bg.includes("http") || design.bg.includes("unsplash"));
  const isGlassDesign = !!design.isGlass || design.category === "Glassmorphism";
  const effectiveCard  = isImageDesign ? "rgba(255,255,255,0.88)"
                       : isGlassDesign ? card
                       : card;
  const effectiveBdr   = isImageDesign ? "rgba(255,255,255,0.5)" : cardBdr;
  const effectiveShadow = isImageDesign
    ? "0 4px 24px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.5)"
    : (design.shadow || "0 1px 3px rgba(0,0,0,0.08)");

  root.style.setProperty("--card-bg",     effectiveCard);
  root.style.setProperty("--card-border", effectiveBdr);
  root.style.setProperty("--card-shadow", effectiveShadow);

  // Text must be dark for scenic designs (image bg can be any colour)
  // For dark designs: ensure text is bright (use design.text which is already light)
  // For image designs: force dark text for readability on light frosted glass
  const effectiveText      = isImageDesign ? "#1e293b" : text;
  const effectiveTextMuted = isImageDesign ? "#475569" : textMuted;

  // ── 4. Sidebar ────────────────────────────────────────────────────
  root.style.setProperty("--sidebar-bg",          design.sidebar);
  root.style.setProperty("--sidebar-text",        design.sidebarText);
  root.style.setProperty("--sidebar-active-bg",   design.sidebarActive);
  root.style.setProperty("--sidebar-active-text", design.sidebarActiveText);
  root.style.setProperty("--sidebar-label",       design.sidebarLabel);

  // ── 5. Topbar ─────────────────────────────────────────────────────
  root.style.setProperty("--topbar-bg",    topbar);

  // ── 6. Typography ─────────────────────────────────────────────────
  root.style.setProperty("--text-primary", effectiveText);
  root.style.setProperty("--text-muted",   effectiveTextMuted);
  root.style.setProperty("--gray-800",     effectiveText);
  root.style.setProperty("--gray-900",     effectiveText);
  root.style.setProperty("--gray-500",     effectiveTextMuted);
  root.style.setProperty("--color-text-primary",    effectiveText);
  root.style.setProperty("--color-text-secondary",  effectiveTextMuted);
  root.style.setProperty("--color-text-tertiary",   grayScale["400"]);
  root.style.setProperty("--color-background-primary",   effectiveCard);
  root.style.setProperty("--color-background-secondary", pageBg);
  root.style.setProperty("--font-sans",    design.font || "Inter, system-ui, sans-serif");
  body.style.fontFamily = design.font || "Inter, system-ui, sans-serif";

  // ── 7. Border radius ─────────────────────────────────────────────
  root.style.setProperty("--radius-sm",   design.radius    || "6px");
  root.style.setProperty("--radius-md",   design.radius    || "8px");
  root.style.setProperty("--radius-lg",   design.radiusLg  || "14px");
  root.style.setProperty("--radius-xl",   design.radiusLg  || "18px");
  root.style.setProperty("--radius-full", design.radiusFull|| "9999px");
  root.style.setProperty("--border-radius-md", design.radius   || "8px");
  root.style.setProperty("--border-radius-lg", design.radiusLg || "14px");

  // ── 8. Inputs & search ────────────────────────────────────────────
  root.style.setProperty("--input-bg",      design.searchBg  || card);
  root.style.setProperty("--input-border",  design.searchBorder || cardBdr);
  root.style.setProperty("--search-bg",     design.searchBg  || grayScale["100"]);
  root.style.setProperty("--search-border", design.searchBorder || cardBdr);

  // ── 9. Buttons ───────────────────────────────────────────────────
  root.style.setProperty("--btn-primary-bg",   design.btnPrimary || brand);
  root.style.setProperty("--btn-primary-text", design.btnPrimaryText || "#fff");

  // ── 10. AI insight card — adapts based on design darkness ─────────
  if (isDark || design.id?.includes("dark") || design.id?.includes("night")
      || design.id?.includes("neon") || design.id?.includes("3d")
      || design.id?.includes("abyss") || design.id?.includes("dracula")
      || design.id?.includes("monokai") || design.id?.includes("nord")
      || design.category === "Dark" || design.category === "Neon"
      || design.category === "3D" || design.category === "Scenic") {
    // Keep the dramatic dark card for dark themes
    root.style.setProperty("--ai-card-bg",
      "linear-gradient(160deg,rgba(0,0,0,0.6) 0%,rgba(0,0,20,0.7) 100%)");
    root.style.setProperty("--ai-card-border", rgba(brand, 0.4));
    root.style.setProperty("--ai-card-text",   "#fff");
    root.style.setProperty("--ai-card-btn",    "linear-gradient(135deg,"+brand+" 0%,"+brandDark+" 100%)");
  } else {
    // Light themes: use a gentle brand-tinted card
    root.style.setProperty("--ai-card-bg",
      "linear-gradient(160deg,"+rgba(brand,0.06)+" 0%,"+rgba(brandDark,0.1)+" 100%)");
    root.style.setProperty("--ai-card-border", rgba(brand, 0.25));
    root.style.setProperty("--ai-card-text",   text);
    root.style.setProperty("--ai-card-btn",    "linear-gradient(135deg,"+brand+" 0%,"+brandDark+" 100%)");
  }

  // ── 11. Shadows ───────────────────────────────────────────────────
  root.style.setProperty("--shadow-xs", design.shadow || "0 1px 2px rgba(0,0,0,0.05)");
  root.style.setProperty("--shadow-sm", design.shadow || "0 1px 3px rgba(0,0,0,0.08)");
  root.style.setProperty("--shadow-md", design.shadow || "0 4px 12px rgba(0,0,0,0.1)");
  root.style.setProperty("--shadow-lg", design.shadow || "0 8px 24px rgba(0,0,0,0.12)");

  // ── 12. Body background ───────────────────────────────────────────
  if (design.bg) {
    const isImg      = design.bg.includes("http") || design.bg.includes("unsplash");
    const isGradient = design.bg.startsWith("linear") || design.bg.startsWith("radial");
    if (isImg) {
      body.style.backgroundImage    = "url('" + design.bg + "')";
      body.style.backgroundSize     = "cover";
      body.style.backgroundPosition = "center";
      body.style.backgroundAttachment = "fixed";
      body.style.backgroundColor   = design.bgFallback || "#0f172a";
    } else if (isGradient) {
      body.style.backgroundImage = design.bg;
      body.style.backgroundColor = design.bgFallback || "#0f172a";
    } else {
      body.style.backgroundImage = "";
      body.style.backgroundColor = design.bg;
    }
  }

  // ── 13. Targeted CSS overrides for all elements ──────────────────
  let el = document.getElementById("ds-overrides");
  if (!el) {
    el = document.createElement("style");
    el.id = "ds-overrides";
    document.head.appendChild(el);
  }

  const btnPrimary = design.btnPrimary || brand;
  const btnPriText = design.btnPrimaryText || "#fff";
  const isImage    = isImageDesign;

  // Card background: for image/scenic designs use semi-transparent overlay
  // For glass designs use the glass card value
  // For solid designs use the card colour directly
  const cardBgOverride = effectiveCard;

  const cardBdrOverride = effectiveBdr;

  const textOverride    = effectiveText;
  const textMutedOvr    = effectiveTextMuted;
  const hubTileBg       = effectiveCard;
  const heroBg          = effectiveCard;
  const sectionBg       = effectiveCard;
  const statBg          = isImage ? "rgba(255,255,255,0.7)" : grayScale["50"];
  const topbarBgOvr     = isImage ? "rgba(255,255,255,0.85)" : topbar;
  const sidebarBgOvr    = isImage
    ? design.sidebar   // sidebar already has opacity set per design
    : design.sidebar;

  el.textContent = [
    "/* DS targeted overrides */",

    // ── Sidebar ──
    ".sidebar { background: " + sidebarBgOvr + " !important; backdrop-filter: blur(12px) !important; }",
    ".sidebar a, .sidebar .sidebar-nav a { color: " + design.sidebarText + " !important; }",
    ".sidebar a.active, .sidebar a[aria-current='page'] { background: " + design.sidebarActive + " !important; color: " + design.sidebarActiveText + " !important; }",
    ".sidebar-section-label,.sidebar-group-label,[class*='sidebar-label'] { color: " + design.sidebarLabel + " !important; }",
    ".sidebar-group-icon { color: " + design.sidebarText + " !important; }",
    ".workspace-name,.workspace-label { color: " + design.sidebarText + " !important; }",

    // ── Topbar ──
    // ── Topbar: background only, children untouched ──
    ".topbar { background: " + topbarBgOvr + " !important; border-color: " + topbarBdr + " !important; }",

    // For dark designs: make topbar buttons subtle (not noisy coloured)
    isDark ? [
      // Search bar — subtle glass look
      ".topbar-search-btn { background: rgba(255,255,255,0.06) !important; border-color: rgba(255,255,255,0.12) !important; color: rgba(255,255,255,0.5) !important; }",
      ".topbar-search-kbd { background: rgba(255,255,255,0.1) !important; color: rgba(255,255,255,0.5) !important; }",
      // Design/Font/Help buttons — keep them neutral, NOT brand-coloured
      ".topbar-right-cluster button:not(.upgrade-btn):not([class*='upgrade']) { background: rgba(255,255,255,0.06) !important; border-color: rgba(255,255,255,0.12) !important; color: rgba(255,255,255,0.75) !important; }",
      ".topbar-right-cluster a:not(.upgrade-btn) { color: rgba(255,255,255,0.75) !important; }",
      // Moon/sun toggle
      ".theme-toggle-btn { color: rgba(255,255,255,0.6) !important; }",
      // Date/time text
      ".topbar-clock, .topbar-date, [class*='clock'], [class*='date'] { color: rgba(255,255,255,0.8) !important; }",
      // Right cluster dividers
      ".topbar-divider-v { background: rgba(255,255,255,0.1) !important; }",
      // Live dot — keep it green
      ".ws-status { background: rgba(16,185,129,0.1) !important; border-color: rgba(16,185,129,0.2) !important; }",
    ].join("\n") : [
      // Light designs: restore natural topbar button colours
      ".topbar-search-btn { background: var(--gray-50) !important; border-color: var(--border) !important; }",
      ".topbar-right-cluster button:not(.upgrade-btn) { background: transparent !important; }",
    ].join("\n"),

    // ── Buttons ──
    ".btn-primary { background: " + btnPrimary + " !important; color: " + btnPriText + " !important; border-color: " + btnPrimary + " !important; }",

    // ── Cards & sections — CRITICAL for scenic designs ──
    ".cc3-section-card,.cc3-proj-goals-row .cc3-section-card { background: " + sectionBg + " !important; border-color: " + cardBdrOverride + " !important; backdrop-filter: blur(8px) !important; }",
    ".cc3-hero { background: " + heroBg + " !important; border-color: " + cardBdrOverride + " !important; backdrop-filter: blur(8px) !important; }",
    ".cc3-hub-tile { background: " + hubTileBg + " !important; border-color: " + cardBdrOverride + " !important; backdrop-filter: blur(8px) !important; }",
    ".cc3-chart-wrap { background: " + cardBgOverride + " !important; border-color: " + cardBdrOverride + " !important; backdrop-filter: blur(8px) !important; }",
    ".cc3-mini-stat { background: " + statBg + " !important; }",
    ".project-card,.task-row,.goal-card,.card { background: " + cardBgOverride + " !important; border-color: " + cardBdrOverride + " !important; backdrop-filter: blur(8px) !important; }",
    ".bg-card { background: " + cardBgOverride + " !important; }",
    ".status-strip-wrap { background: rgba(255,255,255," + (isImage?"0.75":"0") + ") !important; backdrop-filter: " + (isImage?"blur(8px)":"none") + " !important; }",

    // ── Typography — ALL text must be readable ──
    // Set page text color only on content area, NOT on topbar
    ".content-wrapper, .page-content, main { color: " + textOverride + "; }",
    "h1,h2,h3,h4,h5,h6 { color: " + textOverride + " !important; }",
    ".cc3-hero-greeting,.cc3-hero-date { color: " + textOverride + " !important; }",
    ".cc3-hero-date { opacity: 0.75; }",
    ".cc3-hub-tile-name { color: " + textOverride + " !important; }",
    ".cc3-hub-tile-label { color: " + textMutedOvr + " !important; }",
    ".cc3-item-name { color: " + textOverride + " !important; }",
    ".cc3-item-pct { color: " + textMutedOvr + " !important; }",
    ".cc3-section-title,.page-header-title { color: " + textOverride + " !important; }",
    "[class*='-title']:not([class*='badge']):not([class*='btn']) { color: " + textOverride + " !important; }",
    ".cc3-chart-title { color: " + textMutedOvr + " !important; }",
    ".cc3-compact-item span,.cc3-compact-item div { color: " + textMutedOvr + " !important; }",
    ".cc3-section-hdr,[class*='section-label'],[class*='group-label'] { color: " + textMutedOvr + " !important; }",
    // dark-specific: make card text light WITHOUT touching topbar
    (isDark ? [
      ".cc3-section-card, .cc3-hub-tile, .project-card { color: " + textOverride + "; }",
      ".cc3-section-card *:not(button):not(.badge):not([class*='btn']):not(svg):not([class*='topbar']) { color: inherit; }",
    ].join("\n") : ""),

    // ── Status strip (text must be visible) ──
    ".cc3-status-strip span { color: " + textOverride + " !important; }",

    // ── Search ──
    ".topbar input,.search-bar input { background: " + (design.searchBg || grayScale["100"]) + " !important; border-color: " + (design.searchBorder || cardBdr) + " !important; color: " + textOverride + " !important; }",

    // ── ScrollBars ──
    "::-webkit-scrollbar-track { background: " + grayScale["50"] + " !important; }",
    "::-webkit-scrollbar-thumb { background: " + grayScale["300"] + " !important; }",
  ].join("\n");

  // ── 14. Signal dark mode via data attribute (layout.css reads [data-theme="dark"]) ──
  if (isDark) {
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }

  // ── 15. Persist ───────────────────────────────────────────────────
  localStorage.setItem("prowosma-design",      design.id);
  localStorage.setItem("prowosma-design-data", JSON.stringify(design));
}

export function resetToDefault() {
  // Remove all saved design state
  localStorage.removeItem("prowosma-design-data");
  localStorage.removeItem("prowosma-design");
  // Remove injected overrides
  const el = document.getElementById("ds-overrides");
  if (el) el.remove();
  // Remove body inline styles set by applyDesign
  document.body.style.backgroundImage  = "";
  document.body.style.backgroundColor = "";
  document.body.style.backgroundAttachment = "";
  document.body.style.fontFamily       = "";
  // Remove all --ds-* and design token CSS vars from :root
  const root = document.documentElement;
  const varsToClear = [
    "--sidebar-bg","--sidebar-text","--sidebar-active-bg","--sidebar-active-text","--sidebar-label",
    "--topbar-bg","--bg-card","--bg-page","--bg-input","--border",
    "--brand-500","--brand-600","--brand-700","--brand-50","--brand-100",
    "--accent-500","--accent-600","--ds-brand",
    "--card-bg","--card-border","--card-shadow",
    "--text-primary","--text-muted",
    "--gray-50","--gray-100","--gray-200","--gray-300","--gray-400",
    "--gray-500","--gray-600","--gray-700","--gray-800","--gray-900",
    "--font-sans","--radius-sm","--radius-md","--radius-lg","--radius-xl","--radius-full",
    "--border-radius-md","--border-radius-lg",
    "--input-bg","--input-border","--search-bg","--search-border",
    "--btn-primary-bg","--btn-primary-text",
    "--ai-card-bg","--ai-card-border","--ai-card-text","--ai-card-btn",
    "--shadow-xs","--shadow-sm","--shadow-md","--shadow-lg",
    "--color-text-primary","--color-text-secondary","--color-text-tertiary",
    "--color-background-primary","--color-background-secondary",
  ];
  varsToClear.forEach(v => root.style.removeProperty(v));
  // Remove dark-mode signal
  root.removeAttribute("data-theme");
}

export function initDesign() {
  // Support ?reset=1 URL param to force-clear design state
  if (window.location.search.includes("reset=1")) {
    resetToDefault();
    // Remove param from URL without reload
    window.history.replaceState({}, "", window.location.pathname);
    return;
  }
  const saved = localStorage.getItem("prowosma-design-data");
  if (saved) {
    try {
      const design = JSON.parse(saved);
      // Validate — must have required fields
      if (design && design.id && design.sidebar && design.topbar && design.brand) {
        applyDesign(design);
      } else {
        resetToDefault();
      }
    } catch {
      resetToDefault();
    }
  }
}
