import type { HistoryPoint } from "@aloud/contracts";
import { useEffect, useRef, useState } from "react";

const H = 150;
const PAD = { top: 16, right: 36, bottom: 22, left: 28 };

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Score over time for one ASIN: a single 2px line, hoverable points, and a table for screen readers. */
export function HistoryChart({ points }: { points: HistoryPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLElement>(null);
  const [W, setW] = useState(320);
  // Draw at the real pixel width so text and marks keep their size at any width.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scored = points.filter((p): p is HistoryPoint & { score: number } => p.score !== null);
  if (scored.length === 0) return <p className="text-sm text-muted-foreground">No scored audits yet.</p>;

  const t0 = Date.parse(scored[0]!.at);
  const t1 = Date.parse(scored[scored.length - 1]!.at);
  const x = (iso: string) => PAD.left + (t1 === t0 ? 0.5 : (Date.parse(iso) - t0) / (t1 - t0)) * (W - PAD.left - PAD.right);
  const y = (s: number) => PAD.top + (1 - s / 100) * (H - PAD.top - PAD.bottom);
  const d = scored.map((p, i) => `${i ? "L" : "M"}${x(p.at).toFixed(1)},${y(p.score).toFixed(1)}`).join(" ");
  const last = scored[scored.length - 1]!;
  const active = hover === null ? null : scored[hover];

  return (
    <figure ref={box}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full overflow-visible" role="img" aria-label={`Score history: ${scored.map((p) => `${day(p.at)} ${p.score}`).join(", ")}`}>
        {[0, 50, 100].map((g) => (
          <g key={g}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(g)} y2={y(g)} stroke="#ebe8e3" strokeDasharray={g === 0 ? undefined : "2 3"} />
            <text x={PAD.left - 6} y={y(g) + 3.5} textAnchor="end" className="fill-muted-foreground text-[10px]">
              {g}
            </text>
          </g>
        ))}
        {active && <line x1={x(active.at)} x2={x(active.at)} y1={PAD.top} y2={H - PAD.bottom} stroke="#c9c4bc" />}
        <path d={d} fill="none" stroke="var(--primary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {scored.map((p, i) => (
          <g key={p.auditId}>
            <circle cx={x(p.at)} cy={y(p.score)} r={4.5} fill="var(--primary)" stroke="#fff" strokeWidth={2} />
            <text x={x(p.at)} y={H - 6} textAnchor="middle" className="fill-muted-foreground text-[10px]">
              {day(p.at)}
            </text>
            {/* A larger, invisible hit target than the mark itself. */}
            <circle
              cx={x(p.at)}
              cy={y(p.score)}
              r={14}
              fill="transparent"
              tabIndex={0}
              aria-label={`${day(p.at)}: ${p.score}`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              className="outline-none focus-visible:stroke-ring focus-visible:stroke-2"
            />
          </g>
        ))}
        <text x={x(last.at) + 9} y={y(last.score) + 4} className="fill-foreground text-[12px] font-semibold">
          {last.score}
        </text>
        {active && (
          <g transform={`translate(${Math.min(x(active.at) - 40, W - PAD.right - 80)},${Math.max(y(active.score) - 34, 0)})`} pointerEvents="none">
            <rect width={80} height={24} rx={6} fill="#2f2f2d" />
            <text x={40} y={16} textAnchor="middle" className="fill-white text-[11px]">
              {day(active.at)}: {active.score}
            </text>
          </g>
        )}
      </svg>
      <table className="sr-only">
        <caption>Score by audit date</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Score</th>
            <th scope="col">Trigger</th>
          </tr>
        </thead>
        <tbody>
          {scored.map((p) => (
            <tr key={p.auditId}>
              <td>{day(p.at)}</td>
              <td>{p.score}</td>
              <td>{p.origin}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
