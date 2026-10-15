"use client";
import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";

export type ToastType = "success" | "error" | "info" | "warning";

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

type Listener = (toast: Toast) => void;
const listeners: Listener[] = [];

export function toast(message: string, type: ToastType = "info") {
  const id = Math.random().toString(36).slice(2);
  const t: Toast = { id, message, type };
  listeners.forEach((l) => l(t));
}

const ICONS: Record<ToastType, string> = {
  success: "✓",
  error: "✕",
  info: "ℹ",
  warning: "⚠",
};

const COLORS: Record<ToastType, { bg: string; border: string; color: string }> = {
  success: { bg: "#0a1f18", border: "rgba(0,212,170,0.3)", color: "#00d4aa" },
  error:   { bg: "#1f0a0a", border: "rgba(239,68,68,0.3)",  color: "#ef4444" },
  info:    { bg: "#0a1020", border: "rgba(59,130,246,0.3)", color: "#3b82f6" },
  warning: { bg: "#1f1500", border: "rgba(245,158,11,0.3)", color: "#f59e0b" },
};

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: () => void }) {
  const [visible, setVisible] = useState(false);
  const c = COLORS[toast.type];

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const t = setTimeout(() => {
      setVisible(false);
      setTimeout(onRemove, 300);
    }, 3500);
    return () => clearTimeout(t);
  }, [onRemove]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 14px",
        borderRadius: 10,
        background: c.bg,
        border: `1px solid ${c.border}`,
        boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
        pointerEvents: "all",
        cursor: "pointer",
        minWidth: 240,
        maxWidth: 360,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(12px)",
        transition: "opacity 0.25s ease, transform 0.25s ease",
      }}
      onClick={() => { setVisible(false); setTimeout(onRemove, 300); }}
    >
      <span style={{ color: c.color, fontWeight: 700, fontSize: "0.9rem", flexShrink: 0 }}>
        {ICONS[toast.type]}
      </span>
      <span style={{ fontSize: "0.82rem", color: "#e2e8f0", lineHeight: 1.4 }}>{toast.message}</span>
    </div>
  );
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const handler: Listener = (t) => setToasts((prev) => [...prev, t]);
    listeners.push(handler);
    return () => {
      const idx = listeners.indexOf(handler);
      if (idx > -1) listeners.splice(idx, 1);
    };
  }, []);

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  if (!mounted) return null;
  const root = document.getElementById("toast-root");
  if (!root) return null;

  return createPortal(
    <>
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onRemove={() => remove(t.id)} />
      ))}
    </>,
    root
  );
}
