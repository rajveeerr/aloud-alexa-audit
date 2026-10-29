/**
 * A small writer for Excalidraw scenes. Shapes carry bound text (containerId / boundElements),
 * arrows are bound to the shapes they connect (startBinding / endBinding), so the files stay
 * editable by hand in excalidraw.com: move a box and its text and arrows follow.
 */

export const C = {
  text: "#2F2F2D",
  orange: "#FF8800",
  orangeFill: "#FFE8CC",
  green: "#2F9E44",
  greenFill: "#E3F6E6",
  warm: "#FFF7ED",
  warmLine: "#2F2F2D",
  grey: "#F7F6F5",
  muted: "#6B6A66",
  red: "#C92A2A",
  redFill: "#FFE3E3",
  white: "#FFFFFF",
};

export type Style = { stroke: string; fill: string; width?: number; dashed?: boolean; rounded?: boolean };

export const S = {
  model: { stroke: C.orange, fill: C.orangeFill, width: 2 },
  code: { stroke: C.green, fill: C.greenFill, width: 2 },
  box: { stroke: C.warmLine, fill: C.warm, width: 2 },
  store: { stroke: C.warmLine, fill: C.grey, width: 2 },
  hero: { stroke: C.orange, fill: C.warm, width: 4 },
  note: { stroke: C.muted, fill: C.white, width: 1, dashed: true },
  callout: { stroke: C.red, fill: "#FFF5F5", width: 2 },
  state: { stroke: C.warmLine, fill: C.warm, width: 2 },
  done: { stroke: C.green, fill: C.greenFill, width: 3 },
  failed: { stroke: C.red, fill: C.redFill, width: 3 },
} satisfies Record<string, Style>;

/** Excalidraw font families: 2 is Helvetica (normal), 5 is Excalifont (hand-drawn). */
export const FONT = { body: 2, hand: 5 } as const;
const LINE_HEIGHT: Record<number, number> = { 2: 1.15, 5: 1.25 };
/** Average glyph width as a share of the font size; only used to size text boxes before Excalidraw measures them. */
const CHAR_W: Record<number, number> = { 2: 0.53, 5: 0.56 };

export type Box = { id: string; x: number; y: number; w: number; h: number; type: string };
export type Side = "left" | "right" | "top" | "bottom";

type El = Record<string, unknown> & { id: string; boundElements: { id: string; type: string }[] | null };

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
/** Fractional index keys in order: a0..az, then b00..bzz. */
function fractionalIndex(i: number): string {
  if (i < 62) return `a${DIGITS[i]}`;
  const j = i - 62;
  return `b${DIGITS[Math.floor(j / 62)]}${DIGITS[j % 62]}`;
}

export function measure(text: string, size: number, font: number = FONT.body): { w: number; h: number } {
  const lines = text.split("\n");
  const longest = Math.max(...lines.map((l) => l.length));
  return { w: Math.ceil(longest * size * CHAR_W[font]!), h: Math.ceil(lines.length * size * LINE_HEIGHT[font]!) };
}

export class Scene {
  readonly elements: El[] = [];
  private byId = new Map<string, El>();
  private boxes = new Map<string, Box>();
  private cardHeads = new Map<string, string>();

  constructor(readonly name: string) {}

  private base(id: string, type: string, x: number, y: number, w: number, h: number, style: Partial<Style> = {}): El {
    if (this.byId.has(id)) throw new Error(`${this.name}: duplicate id ${id}`);
    const seed = hash(`${this.name}:${id}`);
    const el: El = {
      id,
      type,
      x,
      y,
      width: w,
      height: h,
      angle: 0,
      strokeColor: style.stroke ?? C.text,
      backgroundColor: style.fill ?? "transparent",
      fillStyle: "solid",
      strokeWidth: style.width ?? 2,
      strokeStyle: style.dashed ? "dashed" : "solid",
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      index: fractionalIndex(this.elements.length),
      roundness: null,
      seed,
      version: 1,
      versionNonce: hash(`${seed}`),
      isDeleted: false,
      boundElements: null,
      updated: 1,
      link: null,
      locked: false,
    };
    this.elements.push(el);
    this.byId.set(id, el);
    return el;
  }

  private bind(container: El, child: { id: string; type: string }) {
    container.boundElements = [...(container.boundElements ?? []), child];
  }

  private textEl(
    id: string,
    x: number,
    y: number,
    text: string,
    o: { size: number; font?: number; color?: string; align?: "left" | "center" | "right"; valign?: "top" | "middle" | "bottom"; containerId?: string | null },
  ): El {
    const font = o.font ?? FONT.body;
    const m = measure(text, o.size, font);
    const el = this.base(id, "text", x, y, m.w, m.h, { stroke: o.color ?? C.text });
    Object.assign(el, {
      text,
      originalText: text,
      fontSize: o.size,
      fontFamily: font,
      textAlign: o.align ?? "left",
      verticalAlign: o.valign ?? "top",
      containerId: o.containerId ?? null,
      autoResize: true,
      lineHeight: LINE_HEIGHT[font],
    });
    return el;
  }

  /** Free-standing text, top-left at (x, y). */
  text(id: string, x: number, y: number, text: string, size = 22, o: { font?: number; color?: string; align?: "left" | "center" | "right" } = {}) {
    const el = this.textEl(id, x, y, text, { size, ...o });
    if (o.align === "center") el.x = x - (el.width as number) / 2;
    return el;
  }

  title(text: string, sub?: string) {
    this.text("title", 0, 0, text, 48, { font: FONT.hand });
    if (sub) this.text("subtitle", 2, 70, sub, 24, { color: C.muted });
  }

  /** A rectangle, ellipse or diamond with its text bound inside, centred. */
  shape(
    id: string,
    x: number,
    y: number,
    w: number,
    h: number,
    style: Style,
    label = "",
    o: { size?: number; type?: "rectangle" | "ellipse" | "diamond"; align?: "left" | "center"; font?: number; color?: string } = {},
  ): Box {
    const type = o.type ?? "rectangle";
    const el = this.base(id, type, x, y, w, h, style);
    if (type === "rectangle" && style.rounded !== false) el.roundness = { type: 3 };
    if (type === "diamond") el.roundness = { type: 2 };
    if (label) {
      const size = o.size ?? 22;
      const t = this.textEl(`${id}.text`, 0, 0, label, { size, containerId: id, align: o.align ?? "center", valign: "middle", ...(o.font && { font: o.font }), ...(o.color && { color: o.color }) });
      const tw = t.width as number;
      const th = t.height as number;
      t.x = o.align === "left" ? x + 14 : x + (w - tw) / 2;
      t.y = y + (h - th) / 2;
      this.bind(el, { id: t.id, type: "text" });
    }
    const box = { id, x, y, w, h, type };
    this.boxes.set(id, box);
    return box;
  }

  /** A card: a coloured header bar with a title, on top of a body box. Both carry bound text and move as one group. */
  card(id: string, x: number, y: number, w: number, h: number, style: Style, heading: string, body: string, o: { size?: number; headH?: number; headFill?: string } = {}): Box {
    const headH = o.headH ?? 56;
    const group = `${id}.group`;
    const head = this.shape(`${id}.head`, x, y, w, headH, { ...style, fill: o.headFill ?? style.stroke }, heading, { size: 26, color: C.white });
    const bodyBox = this.shape(id, x, y + headH, w, h - headH, style, body, { size: o.size ?? 22 });
    for (const e of [head.id, `${head.id}.text`, id, `${id}.text`]) {
      const el = this.byId.get(e);
      if (el) el.groupIds = [group];
    }
    // Arrows aim at the whole card; they bind to the body, or to the header when they land on top.
    const full = { id, x, y, w, h, type: "rectangle" };
    this.boxes.set(id, full);
    this.cardHeads.set(id, head.id);
    return full;
  }

  box(id: string): Box {
    const b = this.boxes.get(id);
    if (!b) throw new Error(`${this.name}: no box ${id}`);
    return b;
  }

  /** The point on a side of a box, `t` from -0.5 to 0.5 along the side, pushed out by `gap`. */
  point(id: string, side: Side, t = 0, gap = 6): [number, number] {
    const b = this.box(id);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    let px: number, py: number;
    if (side === "left" || side === "right") {
      py = cy + t * b.h;
      px = side === "left" ? b.x - gap : b.x + b.w + gap;
      if (b.type === "ellipse") {
        const dy = (py - cy) / (b.h / 2);
        const dx = Math.sqrt(Math.max(0, 1 - dy * dy)) * (b.w / 2);
        px = side === "left" ? cx - dx - gap : cx + dx + gap;
      }
      if (b.type === "diamond") {
        const dx = (b.w / 2) * (1 - Math.abs(py - cy) / (b.h / 2));
        px = side === "left" ? cx - dx - gap : cx + dx + gap;
      }
    } else {
      px = cx + t * b.w;
      py = side === "top" ? b.y - gap : b.y + b.h + gap;
      if (b.type === "ellipse") {
        const dx = (px - cx) / (b.w / 2);
        const dy = Math.sqrt(Math.max(0, 1 - dx * dx)) * (b.h / 2);
        py = side === "top" ? cy - dy - gap : cy + dy + gap;
      }
      if (b.type === "diamond") {
        const dy = (b.h / 2) * (1 - Math.abs(px - cx) / (b.w / 2));
        py = side === "top" ? cy - dy - gap : cy + dy + gap;
      }
    }
    return [Math.round(px), Math.round(py)];
  }

  /**
   * An arrow bound at both ends. `via` adds bend points (absolute). A label is bound text on the
   * arrow, placed at `labelAt` (absolute) or the middle of the path.
   */
  arrow(
    id: string,
    from: { id: string; side: Side; t?: number },
    to: { id: string; side: Side; t?: number },
    o: { label?: string; via?: [number, number][]; dashed?: boolean; color?: string; size?: number; labelAt?: [number, number]; width?: number; both?: boolean } = {},
  ) {
    const a = this.point(from.id, from.side, from.t ?? 0);
    const b = this.point(to.id, to.side, to.t ?? 0);
    const fromId = from.side === "top" ? (this.cardHeads.get(from.id) ?? from.id) : from.id;
    const toId = to.side === "top" ? (this.cardHeads.get(to.id) ?? to.id) : to.id;
    const pts = [a, ...(o.via ?? []), b];
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const el = this.base(id, "arrow", a[0], a[1], Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), {
      stroke: o.color ?? C.text,
      width: o.width ?? 2,
      dashed: o.dashed ?? false,
    });
    el.roundness = o.via?.length ? null : { type: 2 };
    Object.assign(el, {
      points: pts.map(([x, y]) => [x - a[0], y - a[1]]),
      lastCommittedPoint: null,
      startBinding: { elementId: fromId, focus: 0, gap: 6, fixedPoint: null },
      endBinding: { elementId: toId, focus: 0, gap: 6, fixedPoint: null },
      startArrowhead: o.both ? "arrow" : null,
      endArrowhead: "arrow",
      elbowed: false,
    });
    // Bind to the shape the arrow touches, so it follows when the shape moves.
    this.bind(this.byId.get(fromId)!, { id, type: "arrow" });
    this.bind(this.byId.get(toId)!, { id, type: "arrow" });
    if (o.label) {
      let mid: [number, number];
      if (o.labelAt) mid = o.labelAt;
      else {
        const k = Math.floor((pts.length - 1) / 2);
        const p = pts[k]!;
        const q = pts[k + 1]!;
        mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      }
      const t = this.textEl(`${id}.label`, 0, 0, o.label, { size: o.size ?? 20, containerId: id, align: "center", valign: "middle" });
      t.x = mid[0] - (t.width as number) / 2;
      t.y = mid[1] - (t.height as number) / 2;
      this.bind(el, { id: t.id, type: "text" });
    }
    return el;
  }

  /** Small legend swatch with a caption. */
  legend(id: string, x: number, y: number, style: Style, caption: string) {
    this.shape(id, x, y, 44, 30, style);
    this.text(`${id}.caption`, x + 58, y + 2, caption, 22);
  }

  toJSON() {
    return {
      type: "excalidraw",
      version: 2,
      source: "https://excalidraw.com",
      elements: this.elements,
      appState: { viewBackgroundColor: "#ffffff", gridSize: 20, gridStep: 5, gridModeEnabled: false },
      files: {},
    };
  }
}
