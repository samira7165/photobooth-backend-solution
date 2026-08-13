'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

const TYPE_STYLES = {
  success: {
    icon: CheckCircle2,
    iconColor: 'text-green-400',
    border: 'border-green-500/30',
    bar: 'bg-green-500',
  },
  error: {
    icon: AlertCircle,
    iconColor: 'text-red-400',
    border: 'border-red-500/30',
    bar: 'bg-red-500',
  },
  info: {
    icon: Info,
    iconColor: 'text-[#2563eb]',
    border: 'border-[#2563eb]/30',
    bar: 'bg-[#2563eb]',
  },
};

// Self-contained single toast: slides in from the right, counts itself down
// with a shrinking progress bar, and calls onClose either when the timer
// runs out or the admin dismisses it early — either way through the same
// exit transition so it never just vanishes mid-frame.
export default function Toast({ message, type = 'info', duration = 4000, onClose }) {
  const [entered, setEntered] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [shrink, setShrink] = useState(false);
  const styles = TYPE_STYLES[type] || TYPE_STYLES.info;
  const Icon = styles.icon;

  useEffect(() => {
    // Two ticks: mount in the "before" position, then flip to "after" on the
    // next frame so the transform/width actually animate instead of the
    // enter state applying instantly on first paint.
    const raf = requestAnimationFrame(() => {
      setEntered(true);
      setShrink(true);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const handleClose = () => {
    setExiting(true);
    setTimeout(() => onClose?.(), 250);
  };

  useEffect(() => {
    const timer = setTimeout(() => handleClose(), duration);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration]);

  return (
    <div
      role="status"
      className={`w-full max-w-sm bg-[#111111] border ${styles.border} rounded-lg shadow-2xl overflow-hidden
        transition-transform duration-300 ease-out motion-reduce:transition-none
        ${entered && !exiting ? 'translate-x-0' : 'translate-x-[120%]'}`}
    >
      <div className="flex items-start gap-3 px-4 py-3">
        <Icon size={18} className={`${styles.iconColor} shrink-0 mt-0.5`} />
        <p className="text-sm text-white flex-1 min-w-0">{message}</p>
        <button
          onClick={handleClose}
          aria-label="Dismiss notification"
          className="text-gray-500 hover:text-white shrink-0 transition-colors motion-reduce:transition-none"
        >
          <X size={15} />
        </button>
      </div>
      <div className="h-0.5 bg-white/5">
        <div
          className={`h-full ${styles.bar} motion-reduce:transition-none`}
          style={{
            width: shrink ? '0%' : '100%',
            transition: shrink ? `width ${duration}ms linear` : 'none',
          }}
        />
      </div>
    </div>
  );
}
