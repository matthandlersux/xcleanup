import { RefObject, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Keeps the active link of a horizontally scrolling tab row in view on narrow
 * screens. Runs on every route change; a no-op when the row doesn't scroll.
 */
export function useCenterActive(ref: RefObject<HTMLElement>) {
  const { pathname } = useLocation();
  useEffect(() => {
    const row = ref.current;
    if (!row || row.scrollWidth <= row.clientWidth) return;
    const active = row.querySelector<HTMLElement>('a.active');
    if (!active) return;
    row.scrollLeft = active.offsetLeft - (row.clientWidth - active.offsetWidth) / 2;
  }, [pathname, ref]);
}
