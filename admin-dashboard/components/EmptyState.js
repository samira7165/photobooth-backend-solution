'use client';

// Shared empty-state block for tables/lists across the dashboard — an icon,
// a short message, and an optional action so an empty table doesn't read as
// broken or unloaded.
export default function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-14 px-6 text-center">
      {Icon && (
        <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
          <Icon size={22} className="text-gray-500" />
        </div>
      )}
      <div>
        <div className="text-sm font-medium text-gray-300">{title}</div>
        {description && <div className="text-xs text-gray-500 mt-1 max-w-xs">{description}</div>}
      </div>
      {action}
    </div>
  );
}
