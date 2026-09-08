'use client';

import { useEffect, useRef, useState } from 'react';
import { Video as VideoIcon, Download, Play, Pause, RefreshCw } from 'lucide-react';
import api from '@/lib/api';
import DashboardLayout from '@/components/DashboardLayout';
import EmptyState from '@/components/EmptyState';
import { resolveImageUrl, downloadFile, resultExtension, formatDate, truncateId } from '@/lib/utils';

const PAGE_SIZE = 20;

export default function VideosPage() {
  const [campaigns, setCampaigns] = useState([]);
  const [videos, setVideos] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [campaignFilter, setCampaignFilter] = useState('All');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const [playingId, setPlayingId] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);
  const videoRefs = useRef({});

  useEffect(() => {
    api.get('/campaigns').then((res) => setCampaigns(res.data)).catch(() => {});
  }, []);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const params = { mode: 'video', limit: PAGE_SIZE, offset: page * PAGE_SIZE };
      if (campaignFilter !== 'All') params.campaignId = campaignFilter;
      if (search) params.search = search;

      const res = await api.get('/submissions', { params });
      setVideos(res.data.submissions);
      setTotal(res.data.total);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load videos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignFilter, search, page]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setPage(0);
    setSearch(searchInput.trim());
  };

  // Only one video plays at a time — pausing whichever else was playing
  // before starting a new one avoids several booth clips overlapping audio.
  const handlePlayPause = (id) => {
    const el = videoRefs.current[id];
    if (!el) return;

    if (playingId === id) {
      el.pause();
      setPlayingId(null);
      return;
    }
    if (playingId && videoRefs.current[playingId]) {
      videoRefs.current[playingId].pause();
    }
    el.play();
    setPlayingId(id);
  };

  // A video's real extension (.webm/.mp4/.mov) varies by what the booth
  // recorded — resultExtension reads it off the resolved URL itself instead
  // of assuming one, so the downloaded file is never mislabeled.
  const handleDownload = async (submission, e) => {
    e.stopPropagation();
    const url = resolveImageUrl(submission.resultUrl);
    setDownloadingId(submission.id);
    try {
      const name = submission.userName || 'video';
      await downloadFile(url, `${name}-${truncateId(submission.id)}${resultExtension(url)}`);
    } catch (err) {
      alert(err.message || 'Download failed');
    } finally {
      setDownloadingId(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <DashboardLayout title="Videos">
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <select
          value={campaignFilter}
          onChange={(e) => {
            setCampaignFilter(e.target.value);
            setPage(0);
          }}
          className="bg-[#111111] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
        >
          <option value="All">All campaigns</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <form onSubmit={handleSearchSubmit} className="flex gap-2">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by name or email..."
            className="bg-[#111111] border border-white/10 rounded-lg px-3 py-2 text-sm text-white w-56 focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
          />
          <button
            type="submit"
            className="text-xs border border-white/10 hover:bg-white/5 text-gray-300 rounded-lg px-3 py-2 transition-colors"
          >
            Search
          </button>
        </form>

        <button
          onClick={load}
          className="flex items-center gap-1.5 text-xs border border-white/10 hover:bg-white/5 text-gray-300 rounded-lg px-3 py-2 transition-colors"
        >
          <RefreshCw size={13} />
          Refresh
        </button>

        <span className="text-sm text-gray-500 ml-auto">{total} total</span>
      </div>

      {error && (
        <div className="mb-6 bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-[#111111] border border-white/10 rounded-xl aspect-[9/16] animate-pulse" />
          ))}
        </div>
      ) : videos.length === 0 ? (
        <div className="bg-[#111111] border border-white/10 rounded-xl">
          <EmptyState
            icon={VideoIcon}
            title="No video submissions found"
            description={
              campaignFilter !== 'All' || search
                ? 'Nothing matches the current filters.'
                : 'Videos recorded at the booth will appear here.'
            }
            action={
              (campaignFilter !== 'All' || search) && (
                <button
                  onClick={() => {
                    setCampaignFilter('All');
                    setSearchInput('');
                    setSearch('');
                    setPage(0);
                  }}
                  className="text-xs border border-white/10 hover:bg-white/5 text-gray-300 rounded-lg px-3 py-1.5 transition-colors"
                >
                  Clear filters
                </button>
              )
            }
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {videos.map((s) => {
            const videoUrl = resolveImageUrl(s.resultUrl);
            const isPlaying = playingId === s.id;

            return (
              <div key={s.id} className="bg-[#111111] border border-white/10 rounded-xl overflow-hidden">
                <div className="relative aspect-[9/16] bg-black">
                  {videoUrl ? (
                    <>
                      <video
                        ref={(el) => {
                          if (el) videoRefs.current[s.id] = el;
                        }}
                        src={videoUrl}
                        className="absolute inset-0 w-full h-full object-cover"
                        onEnded={() => setPlayingId(null)}
                        playsInline
                        preload="metadata"
                      />
                      <button
                        onClick={() => handlePlayPause(s.id)}
                        className="absolute inset-0 flex items-center justify-center bg-black/20 hover:bg-black/40 transition-colors"
                      >
                        <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur flex items-center justify-center">
                          {isPlaying ? (
                            <Pause size={20} className="text-white" />
                          ) : (
                            <Play size={20} className="text-white ml-0.5" />
                          )}
                        </div>
                      </button>
                    </>
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-gray-600">
                      <VideoIcon size={28} />
                    </div>
                  )}
                </div>

                <div className="p-3 space-y-2">
                  <div>
                    <div className="text-sm font-medium text-white truncate">{s.userName || 'Anonymous'}</div>
                    {(s.userEmail || s.userPhone) && (
                      <div className="text-xs text-gray-500 truncate">{s.userEmail || s.userPhone}</div>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 truncate">
                      {s.campaign?.name || '—'}
                    </span>
                    <span className="text-xs text-gray-500 whitespace-nowrap">{formatDate(s.createdAt)}</span>
                  </div>

                  <button
                    onClick={(e) => handleDownload(s, e)}
                    disabled={downloadingId === s.id || !videoUrl}
                    className="w-full flex items-center justify-center gap-1.5 text-xs border border-white/10 hover:bg-white/5 disabled:opacity-50 text-gray-300 rounded-lg px-2.5 py-1.5 transition-colors"
                  >
                    <Download size={13} />
                    {downloadingId === s.id ? 'Downloading…' : 'Download'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between px-1 py-4 text-sm">
        <span className="text-gray-400">
          Page {page + 1} of {totalPages}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-3 py-1.5 rounded-lg border border-white/10 text-gray-300 disabled:opacity-40 hover:bg-white/5"
          >
            Previous
          </button>
          <button
            onClick={() => setPage((p) => (p + 1 < totalPages ? p + 1 : p))}
            disabled={page + 1 >= totalPages}
            className="px-3 py-1.5 rounded-lg border border-white/10 text-gray-300 disabled:opacity-40 hover:bg-white/5"
          >
            Next
          </button>
        </div>
      </div>
    </DashboardLayout>
  );
}
