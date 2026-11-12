import { useState, useRef, useEffect } from "react";
import {
  addAttachment,
  deleteAttachment,
  getAttachmentUrl,
} from "../api/tasks";
import { useToast } from "./ToastContext";
import { useConfirm } from "../hooks/useConfirm";

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function fileIcon(type) {
  if (!type) return "📎";
  if (type.startsWith("image/")) return "🖼️";
  if (type === "application/pdf") return "📄";
  if (type.includes("word")) return "📝";
  if (type.includes("sheet") || type.includes("excel")) return "📊";
  if (type.includes("zip") || type.includes("rar")) return "🗜️";
  return "📎";
}

export default function FileAttachments({ task, onRefresh }) {
  const { show: showToast } = useToast();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10485760) {
      showToast("File too large. Max 10MB.", "error");
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("uploadedBy", "User");
      await addAttachment(task.id, formData);
      onRefresh();
    } catch {
      showToast("Upload failed. Please try again.", "error");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleDelete = async (attachmentId) => {
    if (await confirm({ title: "Delete this attachment?", danger: true, confirmText: "Delete" })) {
      await deleteAttachment(task.id, attachmentId);
      onRefresh();
    }
  };

  const count = task.attachments?.length || 0;

  return (
    <div className="file-attachments-wrapper" ref={ref}>
      <button
        className="file-attach-toggle"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        📎 Files {count > 0 ? `(${count})` : ""} {open ? "▲" : "▼"}
      </button>

      {open && (
        <div
          className="file-attachments-panel"
          onClick={(e) => e.stopPropagation()} role="presentation"
        >
          <div className="task-comments-header">Attachments</div>

          {/* File list */}
          {count > 0 ? (
            <div className="attachments-list">
              {task.attachments.map((a) => (
                <div key={a.id} className="attachment-item">
                  <span className="attachment-icon">
                    {fileIcon(a.fileType)}
                  </span>
                  <div className="attachment-info">
                    <a
                      href={getAttachmentUrl(a.fileName)}
                      className="attachment-name"
                      target="_blank"
                      rel="noreferrer"
                      download={a.originalName}
                    >
                      {a.originalName}
                    </a>
                    <div className="attachment-meta">
                      {formatSize(a.fileSize)} •{" "}
                      {new Date(a.uploadedAt).toLocaleDateString()}
                    </div>
                  </div>
                  <button
                    className="btn-icon"
                    style={{ fontSize: "12px" }}
                    onClick={() => handleDelete(a.id)}
                  >
                    🗑️
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: "12px", color: "#aaa", padding: "8px 0" }}>
              No attachments yet.
            </p>
          )}

          {/* Upload */}
          <div className="attachment-upload">
            <input
              ref={fileRef}
              type="file"
              style={{ display: "none" }}
              onChange={handleUpload}
            />
            <button
              className="btn-secondary"
              style={{ fontSize: "12px", padding: "6px 12px", width: "100%" }}
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? "⏳ Uploading..." : "⬆️ Upload File"}
            </button>
            <p
              style={{
                fontSize: "10px",
                color: "#aaa",
                textAlign: "center",
                marginTop: "4px",
              }}
            >
              Max 10MB
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
