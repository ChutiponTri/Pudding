'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface AvatarProps {
  src?: string | null;
  /** Full name or first/last; used for the initials when there is no photo. */
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  /** Size and ring classes, e.g. "w-8 h-8 text-xs". */
  className?: string;
  /** Tap the photo to see it full size (teacher lists of students / teachers). No effect without a photo. */
  zoom?: boolean;
}

function initialsOf({ name, firstName, lastName }: Pick<AvatarProps, 'name' | 'firstName' | 'lastName'>) {
  const parts = firstName || lastName ? [firstName, lastName] : (name || '').trim().split(/\s+/);
  const letters = parts.map((p) => p?.trim()?.[0] || '').join('').slice(0, 2);
  return letters || '?';
}

/** The largest version of a profile picture: a LINE link ending in /small, /large or /preview is a thumbnail of the bare link. */
function fullSizeOf(src: string) {
  return /profile\.line-scdn\.net/.test(src) ? src.replace(/\/(small|large|preview)$/, '') : src;
}

/** A person's photo, or their initials when they have none. */
export function Avatar({ src, name, firstName, lastName, className = 'w-8 h-8 text-xs', zoom = false }: AvatarProps) {
  // The src that failed to load (a LINE picture link dies when the person changes their picture).
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  if (src && src !== failedSrc) {
    const img = <img src={src} alt="" onError={() => setFailedSrc(src)} className={`${className} rounded-full object-cover shrink-0`} />;
    if (!zoom) return img;
    const label = name || [firstName, lastName].filter(Boolean).join(' ') || undefined;
    // A span, not a button: avatars often sit inside a row's own button or link, and must not trigger it.
    const show = (e: React.SyntheticEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setOpen(true);
    };
    return (
      <>
        <span
          role="button"
          tabIndex={0}
          aria-label={label ? `ดูรูปของ ${label}` : 'ดูรูป'}
          onClick={show}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && show(e)}
          className="inline-flex shrink-0 rounded-full cursor-zoom-in focus-visible:outline-2 focus-visible:outline-amber-500"
        >
          {img}
        </span>
        {open && <PhotoViewer src={fullSizeOf(src)} fallback={src} label={label} onClose={() => setOpen(false)} />}
      </>
    );
  }
  return (
    <span
      aria-hidden
      className={`${className} rounded-full bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 font-black flex items-center justify-center shrink-0 uppercase`}
    >
      {initialsOf({ name, firstName, lastName })}
    </span>
  );
}

/** Full-screen photo; tap anywhere or press Esc to close. */
function PhotoViewer({ src, fallback, label, onClose }: { src: string; fallback: string; label?: string; onClose: () => void }) {
  const [shown, setShown] = useState(src);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const stop = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onClose();
  };
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label || 'รูปโปรไฟล์'}
      onClick={stop}
      className="fixed inset-0 z-[100] bg-black/85 flex flex-col items-center justify-center gap-3 p-4 cursor-zoom-out animate-in fade-in"
    >
      <button type="button" onClick={stop} aria-label="ปิด" className="absolute top-3 right-3 w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center cursor-pointer">
        <X className="w-5 h-5" />
      </button>
      <img
        src={shown}
        alt={label || ''}
        onError={() => shown !== fallback && setShown(fallback)}
        className="max-w-full max-h-[80vh] w-auto h-auto rounded-2xl object-contain shadow-2xl"
      />
      {label && <p className="text-white text-sm font-bold text-center px-4 truncate max-w-full">{label}</p>}
    </div>,
    document.body,
  );
}
