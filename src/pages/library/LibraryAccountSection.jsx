import React from "react";

export default function LibraryAccountSection({
  isDarkLibraryTheme,
  accountProfile,
  accountSaveMessage,
  isUploadingAvatar = false,
  loanTemplate = null,
  isSavingLoanTemplate = false,
  onFieldChange,
  onLoanTemplateFieldChange,
  onLoanTemplatePermissionChange,
  onAvatarUpload,
  onSave,
  onSaveLoanTemplate
}) {
  return (
    <section
      data-testid="library-account-panel"
      className={`workspace-surface mb-4 p-6 md:p-8 ${
        isDarkLibraryTheme ? "workspace-surface-dark" : "workspace-surface-light"
      }`}
    >
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center gap-4">
          <div className={`h-16 w-16 overflow-hidden rounded-full border ${isDarkLibraryTheme ? "border-slate-600" : "border-gray-200"}`}>
            {accountProfile?.avatarUrl ? (
              <img
                src={accountProfile.avatarUrl}
                alt="Profile avatar"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className={`flex h-full w-full items-center justify-center text-lg font-semibold ${isDarkLibraryTheme ? "bg-slate-800 text-slate-300" : "bg-gray-100 text-gray-500"}`}>
                {(accountProfile?.firstName || accountProfile?.email || "R").trim().charAt(0).toUpperCase() || "R"}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <label
              htmlFor="account-avatar-input"
              className="inline-flex h-10 cursor-pointer items-center rounded-lg bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700"
            >
              {isUploadingAvatar ? "Uploading..." : "Upload picture"}
            </label>
            <input
              id="account-avatar-input"
              data-testid="library-account-avatar-input"
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onAvatarUpload?.(file);
                event.target.value = "";
              }}
            />
            <span className={`text-xs ${isDarkLibraryTheme ? "text-slate-400" : "text-slate-500"}`}>
              PNG/JPG up to 2MB
            </span>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="account-first-name" className={`text-sm font-semibold ${isDarkLibraryTheme ? "text-slate-200" : "text-slate-700"}`}>
              First name
            </label>
            <input
              id="account-first-name"
              data-testid="library-account-first-name"
              type="text"
              value={accountProfile.firstName}
              onChange={(event) => onFieldChange("firstName", event.target.value)}
              className={`mt-2 h-11 w-full rounded-lg border px-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 ${
                isDarkLibraryTheme
                  ? "border-slate-600 bg-slate-800 text-slate-100 placeholder:text-slate-500"
                  : "border-gray-200 bg-white text-slate-800"
              }`}
              placeholder="Enter your first name"
            />
          </div>

          <div>
            <label htmlFor="account-email" className={`text-sm font-semibold ${isDarkLibraryTheme ? "text-slate-200" : "text-slate-700"}`}>
              Email address (not editable)
            </label>
            <input
              id="account-email"
              data-testid="library-account-email"
              type="email"
              value={accountProfile.email}
              readOnly
              disabled
              className={`mt-2 h-11 w-full cursor-not-allowed rounded-lg border px-3 text-sm ${
                isDarkLibraryTheme
                  ? "border-slate-600 bg-slate-800/70 text-slate-300"
                  : "border-gray-200 bg-gray-100 text-slate-700"
              }`}
            />
          </div>

          <div>
            <label htmlFor="account-preferred-language" className={`text-sm font-semibold ${isDarkLibraryTheme ? "text-slate-200" : "text-slate-700"}`}>
              Preferred language
            </label>
            <select
              id="account-preferred-language"
              data-testid="library-account-language"
              value={accountProfile.preferredLanguage}
              onChange={(event) => onFieldChange("preferredLanguage", event.target.value)}
              className={`mt-2 h-11 w-full rounded-lg border px-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 ${
                isDarkLibraryTheme
                  ? "border-slate-600 bg-slate-800 text-slate-100"
                  : "border-gray-200 bg-white text-slate-800"
              }`}
            >
              <option value="en">English</option>
              <option value="fr">French</option>
              <option value="es">Spanish</option>
              <option value="ar">Arabic</option>
            </select>
          </div>

          <div>
            <label htmlFor="account-email-notifications" className={`text-sm font-semibold ${isDarkLibraryTheme ? "text-slate-200" : "text-slate-700"}`}>
              Email notifications
            </label>
            <select
              id="account-email-notifications"
              data-testid="library-account-email-notifications"
              value={accountProfile.emailNotifications}
              onChange={(event) => onFieldChange("emailNotifications", event.target.value)}
              className={`mt-2 h-11 w-full rounded-lg border px-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 ${
                isDarkLibraryTheme
                  ? "border-slate-600 bg-slate-800 text-slate-100"
                  : "border-gray-200 bg-white text-slate-800"
              }`}
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </div>

          <div>
            <label htmlFor="account-loan-reminder-days" className={`text-sm font-semibold ${isDarkLibraryTheme ? "text-slate-200" : "text-slate-700"}`}>
              Borrow reminder (days before due)
            </label>
            <input
              id="account-loan-reminder-days"
              data-testid="library-account-loan-reminder-days"
              type="number"
              min={0}
              max={30}
              value={Number(accountProfile?.loanReminderDays ?? 3)}
              onChange={(event) => onFieldChange("loanReminderDays", Math.max(0, Math.min(30, Number(event.target.value) || 0)))}
              className={`mt-2 h-11 w-full rounded-lg border px-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 ${
                isDarkLibraryTheme
                  ? "border-slate-600 bg-slate-800 text-slate-100 placeholder:text-slate-500"
                  : "border-gray-200 bg-white text-slate-800"
              }`}
            />
            <p className={`mt-1 text-xs ${isDarkLibraryTheme ? "text-slate-400" : "text-slate-500"}`}>
              Set `0` to disable due-soon reminders.
            </p>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            data-testid="library-account-save"
            onClick={onSave}
            className="inline-flex h-10 items-center rounded-lg bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700"
          >
            Save changes
          </button>
          {accountSaveMessage && (
            <span
              data-testid="library-account-save-message"
              className={`text-sm font-semibold ${isDarkLibraryTheme ? "text-emerald-300" : "text-emerald-700"}`}
            >
              {accountSaveMessage}
            </span>
          )}
        </div>

        {loanTemplate && (
          <div className={`mt-8 rounded-xl border p-4 ${isDarkLibraryTheme ? "border-slate-700 bg-slate-900/45" : "border-gray-200 bg-gray-50/60"}`}>
            <h3 className={`text-sm font-bold ${isDarkLibraryTheme ? "text-slate-100" : "text-slate-900"}`}>Default Lending Template</h3>
            <p className={`mt-1 text-xs ${isDarkLibraryTheme ? "text-slate-400" : "text-slate-600"}`}>
              Used as default values when you send a new loan request.
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div>
                <label className={`text-xs font-semibold ${isDarkLibraryTheme ? "text-slate-300" : "text-slate-700"}`}>Duration (days)</label>
                <input type="number" min={1} max={365} value={Number(loanTemplate.durationDays || 14)} onChange={(event) => onLoanTemplateFieldChange?.("durationDays", Math.max(1, Math.min(365, Number(event.target.value) || 1)))} className={`mt-1 h-10 w-full rounded-lg border px-3 text-sm ${isDarkLibraryTheme ? "border-slate-600 bg-slate-800 text-slate-100" : "border-gray-200 bg-white text-slate-800"}`} />
              </div>
              <div>
                <label className={`text-xs font-semibold ${isDarkLibraryTheme ? "text-slate-300" : "text-slate-700"}`}>Grace (days)</label>
                <input type="number" min={0} max={30} value={Number(loanTemplate.graceDays || 0)} onChange={(event) => onLoanTemplateFieldChange?.("graceDays", Math.max(0, Math.min(30, Number(event.target.value) || 0)))} className={`mt-1 h-10 w-full rounded-lg border px-3 text-sm ${isDarkLibraryTheme ? "border-slate-600 bg-slate-800 text-slate-100" : "border-gray-200 bg-white text-slate-800"}`} />
              </div>
              <div>
                <label className={`text-xs font-semibold ${isDarkLibraryTheme ? "text-slate-300" : "text-slate-700"}`}>Due reminder (days)</label>
                <input type="number" min={0} max={30} value={Number(loanTemplate.remindBeforeDays || 0)} onChange={(event) => onLoanTemplateFieldChange?.("remindBeforeDays", Math.max(0, Math.min(30, Number(event.target.value) || 0)))} className={`mt-1 h-10 w-full rounded-lg border px-3 text-sm ${isDarkLibraryTheme ? "border-slate-600 bg-slate-800 text-slate-100" : "border-gray-200 bg-white text-slate-800"}`} />
              </div>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {[
                ["canAddNotes", "Allow adding notes"],
                ["canEditNotes", "Allow editing/deleting notes"],
                ["canAddHighlights", "Allow adding highlights"],
                ["canEditHighlights", "Allow editing/deleting highlights"]
              ].map(([key, label]) => (
                <label key={key} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${isDarkLibraryTheme ? "border-slate-700 text-slate-300" : "border-gray-200 text-slate-700"}`}>
                  <input
                    type="checkbox"
                    checked={Boolean(loanTemplate?.permissions?.[key])}
                    onChange={(event) => onLoanTemplatePermissionChange?.(key, event.target.checked)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <select value={loanTemplate?.permissions?.annotationVisibility || "PRIVATE"} onChange={(event) => onLoanTemplatePermissionChange?.("annotationVisibility", event.target.value)} className={`h-10 rounded-lg border px-3 text-xs ${isDarkLibraryTheme ? "border-slate-600 bg-slate-800 text-slate-100" : "border-gray-200 bg-white text-slate-800"}`}>
                <option value="PRIVATE">Borrower notes private</option>
                <option value="SHARED_WITH_LENDER">Borrower notes shared with lender</option>
              </select>
              <label className={`flex items-center gap-2 text-xs ${isDarkLibraryTheme ? "text-slate-300" : "text-slate-700"}`}>
                <input type="checkbox" checked={Boolean(loanTemplate?.permissions?.shareLenderAnnotations)} onChange={(event) => onLoanTemplatePermissionChange?.("shareLenderAnnotations", event.target.checked)} />
                Show lender existing notes/highlights to borrower
              </label>
            </div>
            <div className="mt-4">
              <button type="button" onClick={onSaveLoanTemplate} disabled={isSavingLoanTemplate} className="inline-flex h-10 items-center rounded-lg bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60">
                {isSavingLoanTemplate ? "Saving template..." : "Save lending template"}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
