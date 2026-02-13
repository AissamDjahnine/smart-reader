import React from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

const toneClasses = {
  success: {
    light: "border-emerald-200 bg-emerald-50 text-emerald-900",
    dark: "border-emerald-800 bg-emerald-950/80 text-emerald-100",
    icon: CheckCircle2
  },
  warning: {
    light: "border-amber-200 bg-amber-50 text-amber-900",
    dark: "border-amber-800 bg-amber-950/80 text-amber-100",
    icon: AlertTriangle
  },
  destructive: {
    light: "border-red-200 bg-red-50 text-red-900",
    dark: "border-red-800 bg-red-950/80 text-red-100",
    icon: AlertTriangle
  },
  info: {
    light: "border-blue-200 bg-blue-50 text-blue-900",
    dark: "border-blue-800 bg-blue-950/80 text-blue-100",
    icon: Info
  }
};

export default function FeedbackToast({
  toast,
  isDark = false,
  onDismiss,
  className = "",
  testId = "feedback-toast",
  actionTestId = "feedback-toast-action"
}) {
  if (!toast) return null;
  const tone = toneClasses[toast.tone] ? toast.tone : "info";
  const Icon = toneClasses[tone].icon;

  return (
    <div data-testid={testId} className={className}>
      <div
        className={`min-w-[280px] max-w-[420px] rounded-2xl border px-3.5 py-3 shadow-lg backdrop-blur ${isDark ? toneClasses[tone].dark : toneClasses[tone].light}`}
      >
        <div className="flex items-start gap-2.5">
          <Icon size={16} className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold">{toast.title}</div>
            {toast.message ? <div className="mt-0.5 text-xs opacity-90">{toast.message}</div> : null}
            {toast.actionLabel && typeof toast.onAction === "function" ? (
              <button
                type="button"
                data-testid={actionTestId}
                onClick={toast.onAction}
                className={`mt-2 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                  isDark ? "border-white/25 bg-white/10 hover:bg-white/20" : "border-black/10 bg-white/70 hover:bg-white"
                }`}
              >
                {toast.actionLabel}
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className={`rounded-full p-1 ${isDark ? "hover:bg-white/10" : "hover:bg-black/5"}`}
            aria-label="Dismiss message"
          >
            <X size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
