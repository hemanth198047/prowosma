import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export function exportToCSV(data, filename) {
  if (!data || data.length === 0) return;
  const headers = Object.keys(data[0]);
  const rows = data.map((row) =>
    headers.map((h) => {
      const val = row[h];
      if (val === null || val === undefined) return "";
      if (typeof val === "object") return JSON.stringify(val);
      return String(val).replace(/,/g, ";");
    }),
  );
  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportToPDF(title, columns, rows, filename) {
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text(title, 14, 16);
  doc.setFontSize(10);
  doc.setTextColor(150);
  doc.text(`Exported on ${new Date().toLocaleDateString()}`, 14, 24);
  autoTable(doc, {
    startY: 30,
    head: [columns],
    body: rows,
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: {
      fillColor: [99, 102, 241],
      textColor: 255,
      fontStyle: "bold",
    },
    alternateRowStyles: { fillColor: [245, 245, 255] },
    margin: { left: 14, right: 14 },
  });
  doc.save(`${filename}.pdf`);
}
