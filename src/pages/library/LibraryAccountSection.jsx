import React from "react";

export default function LibraryAccountSection({
  isDarkLibraryTheme,
  accountProfile,
  accountSaveMessage,
  onFieldChange,
  onSave
}) {
  return (
    <section
      data-testid="library-account-panel"
      className={`workspace-surface mb-4 p-6 md:p-8 ${
        isDarkLibraryTheme ? "workspace-surface-dark" : "workspace-surface-light"
      }`}
    >
      <div className="mx-auto max-w-5xl">
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
      </div>
    </section>
  );
}
