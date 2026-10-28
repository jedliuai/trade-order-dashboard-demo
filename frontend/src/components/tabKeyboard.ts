import type { KeyboardEvent } from 'react';

export function handleTabListKeyDown(event: KeyboardEvent<HTMLElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;

  const tabs = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]:not([disabled])')
  ).filter((tab) => tab.offsetParent !== null);
  if (!tabs.length) return;

  const currentIndex = tabs.indexOf(document.activeElement as HTMLElement);
  if (currentIndex < 0) return;

  event.preventDefault();
  const backwards = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
  const nextIndex = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? tabs.length - 1
      : (currentIndex + (backwards ? -1 : 1) + tabs.length) % tabs.length;
  tabs[nextIndex]?.focus();
  tabs[nextIndex]?.click();
}
