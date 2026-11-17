import { useEffect, useState } from 'react';

/**
 * Keeps a surface mounted while it slides out. `mounted` is true while open and for `ms` after closing; `shown` is true only from the
 * frame after it mounted open, so the closed state is drawn once and the transition has somewhere to start. Pressing again during
 * a motion reverses it from where it is, because the state flips and the CSS transition follows.
 */
export function usePresence(open: boolean, ms: number): { mounted: boolean; shown: boolean } {
  const [mounted, setMounted] = useState(open), [shown, setShown] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      let inner = 0;
      const outer = requestAnimationFrame(() => { inner = requestAnimationFrame(() => setShown(true)); });
      return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner); };
    }
    setShown(false);
    const timer = setTimeout(() => setMounted(false), ms);
    return () => clearTimeout(timer);
  }, [open, ms]);
  return { mounted: mounted || open, shown: shown && open };
}
