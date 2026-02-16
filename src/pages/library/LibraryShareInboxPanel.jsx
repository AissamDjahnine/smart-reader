import React, { useEffect, useState } from 'react';
import { acceptShare, fetchShareInbox, rejectShare } from '../../services/collabApi';

export default function LibraryShareInboxPanel({ onAccepted }) {
  const [shares, setShares] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const loadInbox = async () => {
    setIsLoading(true);
    setError('');
    try {
      const rows = await fetchShareInbox();
      setShares(rows);
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to load inbox');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadInbox();
  }, []);

  const handleAccept = async (shareId) => {
    try {
      await acceptShare(shareId);
      await loadInbox();
      onAccepted?.();
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to accept share');
    }
  };

  const handleReject = async (shareId) => {
    try {
      await rejectShare(shareId);
      await loadInbox();
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to reject share');
    }
  };

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5" data-testid="share-inbox-panel">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-gray-900">Share Inbox</h2>
        <button type="button" className="text-xs font-semibold text-blue-700" onClick={loadInbox}>Refresh</button>
      </div>

      {isLoading && <p className="mt-3 text-sm text-gray-600">Loading...</p>}
      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}

      {!isLoading && shares.length === 0 && (
        <p className="mt-3 text-sm text-gray-600">No pending shares.</p>
      )}

      <div className="mt-4 space-y-3">
        {shares.map((share) => (
          <article key={share.id} className="rounded-xl border border-gray-200 p-3">
            <p className="text-sm font-semibold text-gray-900">{share.book?.title || 'Book'}</p>
            <p className="text-xs text-gray-600 mt-1">
              from {share.fromUser?.displayName || share.fromUser?.email}
            </p>
            {share.message ? (
              <p className="mt-2 text-xs text-gray-700">"{share.message}"</p>
            ) : null}
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleAccept(share.id)}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white"
              >
                Accept
              </button>
              <button
                type="button"
                onClick={() => handleReject(share.id)}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700"
              >
                Reject
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
