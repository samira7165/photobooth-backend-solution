'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import StatusBadge from './StatusBadge';
import SubmissionDetailModal from './SubmissionDetailModal';
import { formatDate } from '@/lib/utils';

export default function SubmissionsTab({ campaignId, canManage }) {
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [retrying, setRetrying] = useState(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/submissions', { params: { campaignId } });
      setSubmissions(res.data.submissions);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load submissions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  const handleRetry = async (id) => {
    setRetrying(id);
    try {
      await api.patch(`/submissions/${id}/retry`);
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Retry failed');
    } finally {
      setRetrying(null);
    }
  };

  return (
    <div className="bg-[#111111] border border-white/10 rounded-xl overflow-hidden">
      {error && <div className="text-red-400 text-sm p-4">{error}</div>}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400 border-b border-white/10">
              <th className="px-5 py-3 font-medium">User</th>
              <th className="px-5 py-3 font-medium">Phone</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Mode</th>
              <th className="px-5 py-3 font-medium">Processing Time</th>
              <th className="px-5 py-3 font-medium">Created At</th>
              <th className="px-5 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-5 py-8 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : submissions.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-5 py-8 text-center text-gray-500">
                  No submissions yet
                </td>
              </tr>
            ) : (
              submissions.map((s) => (
                <tr
                  key={s.id}
                  className="border-b border-white/5 hover:bg-white/5 cursor-pointer"
                  onClick={() => setSelected(s)}
                >
                  <td className="px-5 py-3 text-white">{s.userName || '—'}</td>
                  <td className="px-5 py-3 text-gray-300">{s.userPhone || '—'}</td>
                  <td className="px-5 py-3">
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="px-5 py-3 text-gray-300">{s.mode}</td>
                  <td className="px-5 py-3 text-gray-400">
                    {s.processingTime ? `${s.processingTime}ms` : '—'}
                  </td>
                  <td className="px-5 py-3 text-gray-400">{formatDate(s.createdAt)}</td>
                  <td className="px-5 py-3">
                    {canManage && s.status === 'FAILED' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRetry(s.id);
                        }}
                        disabled={retrying === s.id}
                        className="text-xs bg-[#2563eb] hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg px-2.5 py-1 transition-colors"
                      >
                        {retrying === s.id ? 'Retrying…' : 'Retry'}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <SubmissionDetailModal submission={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
