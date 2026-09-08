export default function SidebarBadge({ count, color }) {
  if (!count || count === 0) return null;
  return (
    <span
      style={{
        background: color || "#ef4444",
        color: "#fff",
        fontSize: "10px",
        fontWeight: 700,
        padding: "1px 6px",
        borderRadius: "10px",
        marginLeft: "auto",
        minWidth: "18px",
        textAlign: "center",
        lineHeight: "16px",
        height: "16px",
        display: "inline-block",
      }}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
