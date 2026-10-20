import React from 'react';

interface AvatarProps {
  src?: string | null;
  /** Full name or first/last; used for the initials when there is no photo. */
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  /** Size and ring classes, e.g. "w-8 h-8 text-xs". */
  className?: string;
}

function initialsOf({ name, firstName, lastName }: Pick<AvatarProps, 'name' | 'firstName' | 'lastName'>) {
  const parts = firstName || lastName ? [firstName, lastName] : (name || '').trim().split(/\s+/);
  const letters = parts.map((p) => p?.trim()?.[0] || '').join('').slice(0, 2);
  return letters || '?';
}

/** A person's photo, or their initials when they have none. */
export function Avatar({ src, name, firstName, lastName, className = 'w-8 h-8 text-xs' }: AvatarProps) {
  if (src) {
    return <img src={src} alt="" className={`${className} rounded-full object-cover shrink-0`} />;
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
