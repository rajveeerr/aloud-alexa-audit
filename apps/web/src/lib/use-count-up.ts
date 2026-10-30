import { useEffect, useState } from "react";

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Counts from 0 up to `to` once, easing out, so a score lands with a little weight.
 * Returns `to` straight away when motion is reduced or the value isn't a number.
 */
export function useCountUp(to: number | null | undefined, ms = 900): number | null | undefined {
  const [value, setValue] = useState(() => (typeof to === "number" && !reduced() ? 0 : to));

  useEffect(() => {
    if (typeof to !== "number" || reduced()) {
      setValue(to);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 4);
      setValue(Math.round(eased * to));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [to, ms]);

  return value;
}
