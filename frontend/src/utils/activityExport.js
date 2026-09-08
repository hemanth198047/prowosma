/**
 * Activity Log — Multi-format Export Utilities
 * Supports: CSV, TXT, PDF, DOCX
 */

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const ACTION_META = {
  CREATED:          "Created",
  UPDATED:          "Updated",
  DELETED:          "Deleted",
  STATUS_CHANGED:   "Status Changed",
  PROGRESS_UPDATED: "Progress Updated",
};

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function formatUser(email) {
  if (!email || email === "System") return "System";
  return email.includes("@") ? email : email;
}

// ── CSV ──────────────────────────────────────────────────────────────
export function exportActivityCSV(logs, filename = "audit-log") {
  const headers = ["Date", "User", "Action", "Entity Type", "Entity Name", "Old Value", "New Value"];
  const rows = logs.map((l) => [
    formatDate(l.createdAt),
    formatUser(l.performedBy),
    ACTION_META[l.action] || l.action,
    l.entityType || "",
    l.entityName || "",
    l.oldValue || "",
    l.newValue || "",
  ]);
  const escape = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [headers.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))].join("\n");
  download(new Blob([csv], { type: "text/csv;charset=utf-8;" }), `${filename}.csv`);
}

// ── TXT ──────────────────────────────────────────────────────────────
export function exportActivityTXT(logs, filename = "audit-log") {
  const lines = [];
  lines.push("PROWOSMA — AUDIT LOG");
  lines.push(`Exported: ${new Date().toLocaleString()}`);
  lines.push(`Total entries: ${logs.length}`);
  lines.push("=".repeat(72));
  lines.push("");

  // Group by date
  const groups = groupByDate(logs);
  for (const [date, entries] of Object.entries(groups)) {
    lines.push(`── ${date.toUpperCase()} (${entries.length} entries) ──`);
    lines.push("");
    for (const l of entries) {
      const user   = formatUser(l.performedBy);
      const action = ACTION_META[l.action] || l.action;
      const time   = l.createdAt ? new Date(l.createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "";
      lines.push(`  [${time}]  ${user}  •  ${action}  —  ${l.entityType}: ${l.entityName}`);
      if (l.oldValue && l.newValue) {
        lines.push(`           Change: "${l.oldValue}"  →  "${l.newValue}"`);
      }
    }
    lines.push("");
  }
  download(new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8;" }), `${filename}.txt`);
}

// ── PDF ──────────────────────────────────────────────────────────────
export function exportActivityPDF(logs, filename = "audit-log") {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();

  // Header bar
  doc.setFillColor(14, 165, 233);
  doc.rect(0, 0, pageW, 18, "F");
  doc.setFontSize(13);
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.text("PROWOSMA — Audit Log", 12, 12);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text(`Exported: ${new Date().toLocaleString()}   |   Total entries: ${logs.length}`, pageW - 12, 12, { align: "right" });

  // Table
  const rows = logs.map((l) => [
    l.createdAt ? new Date(l.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "",
    l.createdAt ? new Date(l.createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "",
    formatUser(l.performedBy),
    ACTION_META[l.action] || l.action,
    l.entityType || "",
    l.entityName || "",
    l.oldValue ? `${l.oldValue} → ${l.newValue}` : "",
  ]);

  autoTable(doc, {
    startY: 22,
    head: [["Date", "Time", "User", "Action", "Type", "Entity", "Change"]],
    body: rows,
    styles: { fontSize: 8, cellPadding: 2.5, font: "helvetica" },
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: "bold", fontSize: 8 },
    alternateRowStyles: { fillColor: [240, 249, 255] },
    columnStyles: {
      0: { cellWidth: 24 },
      1: { cellWidth: 18 },
      2: { cellWidth: 42 },
      3: { cellWidth: 32 },
      4: { cellWidth: 20 },
      5: { cellWidth: 60 },
      6: { cellWidth: 60 },
    },
    margin: { left: 8, right: 8 },
    didDrawPage: (data) => {
      // Footer
      const pageCount = doc.internal.getNumberOfPages();
      doc.setFontSize(7);
      doc.setTextColor(150);
      doc.text(
        `Page ${data.pageNumber} of ${pageCount}  |  Prowosma Audit Log`,
        pageW / 2,
        doc.internal.pageSize.getHeight() - 5,
        { align: "center" }
      );
    },
  });

  doc.save(`${filename}.pdf`);
}

// ── DOCX ─────────────────────────────────────────────────────────────
export async function exportActivityDOCX(logs, filename = "audit-log") {
  // Dynamically import docx to avoid bundle bloat when not used
  const {
    Document, Paragraph, Table, TableRow, TableCell,
    TextRun, WidthType, AlignmentType, BorderStyle,
    ShadingType, Header, Footer, PageNumber, Packer,
    HeadingLevel,
  } = await import("docx");

  const borderNone = {
    top: { style: BorderStyle.NONE, size: 0 },
    bottom: { style: BorderStyle.NONE, size: 0 },
    left: { style: BorderStyle.NONE, size: 0 },
    right: { style: BorderStyle.NONE, size: 0 },
  };
  const borderBottom = {
    ...borderNone,
    bottom: { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0" },
  };

  const ACTION_COLORS = {
    CREATED: "16A34A", UPDATED: "2563EB", DELETED: "DC2626",
    STATUS_CHANGED: "D97706", PROGRESS_UPDATED: "7C3AED",
  };

  const cell = (text, opts = {}) =>
    new TableCell({
      borders: borderBottom,
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      shading: opts.shade ? { fill: opts.shade, type: ShadingType.CLEAR } : undefined,
      children: [new Paragraph({
        alignment: opts.center ? AlignmentType.CENTER : AlignmentType.LEFT,
        children: [new TextRun({
          text: String(text ?? ""),
          size: 18,
          font: "Inter",
          bold: opts.bold || false,
          color: opts.color || "334155",
        })],
      })],
    });

  const headerCell = (text) =>
    new TableCell({
      borders: borderNone,
      margins: { top: 80, bottom: 80, left: 100, right: 100 },
      shading: { fill: "0F172A", type: ShadingType.CLEAR },
      children: [new Paragraph({
        children: [new TextRun({ text, size: 18, font: "Inter", bold: true, color: "FFFFFF" })],
      })],
    });

  // Group by date for sections
  const groups = groupByDate(logs);
  const children = [];

  // Title
  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun({ text: "PROWOSMA — Audit Log", bold: true, size: 40, font: "Inter", color: "0369A1" })],
      spacing: { before: 0, after: 160 },
    }),
    new Paragraph({
      children: [new TextRun({ text: `Exported: ${new Date().toLocaleString()}   |   Total entries: ${logs.length}`, size: 18, font: "Inter", color: "64748B" })],
      spacing: { before: 0, after: 400 },
    })
  );

  for (const [date, entries] of Object.entries(groups)) {
    // Date heading
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: date, bold: true, size: 22, font: "Inter", color: "0F172A" })],
      spacing: { before: 300, after: 120 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0" } },
    }));

    // Table for this group
    const tableRows = [
      new TableRow({
        tableHeader: true,
        children: [
          headerCell("Time"),
          headerCell("User"),
          headerCell("Action"),
          headerCell("Type"),
          headerCell("Entity"),
          headerCell("Change"),
        ],
      }),
      ...entries.map((l, i) =>
        new TableRow({
          children: [
            cell(l.createdAt ? new Date(l.createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "", { shade: i % 2 === 0 ? "F8FAFC" : "FFFFFF" }),
            cell(formatUser(l.performedBy), { shade: i % 2 === 0 ? "F8FAFC" : "FFFFFF", bold: true }),
            new TableCell({
              borders: borderBottom,
              margins: { top: 60, bottom: 60, left: 100, right: 100 },
              shading: { fill: i % 2 === 0 ? "F8FAFC" : "FFFFFF", type: ShadingType.CLEAR },
              children: [new Paragraph({
                children: [new TextRun({
                  text: ACTION_META[l.action] || l.action,
                  size: 18, font: "Inter", bold: true,
                  color: ACTION_COLORS[l.action] || "334155",
                })],
              })],
            }),
            cell(l.entityType || "", { shade: i % 2 === 0 ? "F8FAFC" : "FFFFFF" }),
            cell(l.entityName || "", { shade: i % 2 === 0 ? "F8FAFC" : "FFFFFF" }),
            cell(l.oldValue && l.newValue ? `${l.oldValue} → ${l.newValue}` : "", { shade: i % 2 === 0 ? "F8FAFC" : "FFFFFF", color: "64748B" }),
          ],
        })
      ),
    ];

    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: tableRows,
      margins: { top: 0, bottom: 0 },
    }));
  }

  const doc = new Document({
    sections: [{
      properties: { page: { margin: { top: 900, bottom: 900, left: 1000, right: 1000 } } },
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: "0369A1" } },
            spacing: { after: 100 },
            children: [
              new TextRun({ text: "Prowosma ", bold: true, size: 16, font: "Inter", color: "0369A1" }),
              new TextRun({ text: "— Audit Log", size: 16, font: "Inter", color: "94A3B8" }),
            ],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            border: { top: { style: BorderStyle.SINGLE, size: 1, color: "E2E8F0" } },
            spacing: { before: 100 },
            children: [
              new TextRun({ text: "Page ", size: 14, color: "94A3B8", font: "Inter" }),
              new TextRun({ children: [PageNumber.CURRENT], size: 14, color: "94A3B8", font: "Inter" }),
              new TextRun({ text: "  |  Prowosma Audit Log", size: 14, color: "94A3B8", font: "Inter" }),
            ],
          })],
        }),
      },
      children,
    }],
  });

  const buffer = await Packer.toBlob(doc);
  download(buffer, `${filename}.docx`);
}

// ── Helpers ───────────────────────────────────────────────────────────
function groupByDate(logs) {
  return logs.reduce((acc, log) => {
    const key = new Date(log.createdAt).toLocaleDateString("en-US", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });
    if (!acc[key]) acc[key] = [];
    acc[key].push(log);
    return acc;
  }, {});
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href    = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
