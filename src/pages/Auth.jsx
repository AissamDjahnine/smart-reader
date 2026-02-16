import React, { useMemo, useState } from 'react';
import { authLogin, authRegister, isCollabMode } from '../services/collabApi';

export default function Auth({ onAuthed }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canSubmit = useMemo(() => {
    if (!email.trim() || !password.trim()) return false;
    if (mode === 'register' && !displayName.trim()) return false;
    return true;
  }, [email, password, displayName, mode]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canSubmit || isSubmitting) return;
    setIsSubmitting(true);
    setError('');
    try {
      if (mode === 'register') {
        await authRegister({ email, password, displayName });
      } else {
        await authLogin({ email, password });
      }
      onAuthed?.();
    } catch (err) {
      const message = err?.response?.data?.error || err?.message || 'Authentication failed';
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isCollabMode) return null;

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">Ariadne</h1>
        <p className="mt-1 text-sm text-slate-600">
          {mode === 'register' ? 'Create an account for this shared server.' : 'Sign in to your shared reading space.'}
        </p>

        <form className="mt-6 space-y-3" onSubmit={handleSubmit}>
          {mode === 'register' && (
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Display name"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          )}
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            placeholder="Email"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            placeholder="Password"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          {error && <p className="text-xs text-rose-600">{error}</p>}

          <button
            type="submit"
            disabled={!canSubmit || isSubmitting}
            className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {isSubmitting ? 'Please wait...' : mode === 'register' ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode((prev) => (prev === 'login' ? 'register' : 'login'));
            setError('');
          }}
          className="mt-4 text-xs font-semibold text-slate-700"
        >
          {mode === 'login' ? 'Need an account? Register' : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  );
}
