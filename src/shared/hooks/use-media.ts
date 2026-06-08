import { useEffect, useState } from "react";

/**
 * Tracks a media query. Drives the Daybook's mobile↔desktop switch (sidebar vs
 * bottom tabs, paddings, grid columns) from the live viewport. Subscribing to
 * `matchMedia` is an external-system sync, hence the effect.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** Phone / small-tablet breakpoint — the design's 390px phone artboard up to ~760px. */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 760px)");
}
