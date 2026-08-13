'use client';

// Shared skeleton-loading rows for tables across the dashboard — replaces a
// bare "Loading…" cell with shimmering placeholder bars shaped roughly like
// the real content, so the table doesn't flash empty-then-full.
// `widths` lets a caller hint at each column's typical content width
// (defaults to a medium bar); pass one entry per column.
export default function TableSkeleton({ columns, rows = 5, widths = [] }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-b border-white/10 last:border-0">
          {Array.from({ length: columns }).map((_, c) => (
            <td key={c} className="px-5 py-3.5">
              <div
                className={`h-3.5 rounded bg-white/10 animate-pulse motion-reduce:animate-none ${widths[c] || 'w-24'}`}
                style={{ animationDelay: `${r * 60}ms` }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
