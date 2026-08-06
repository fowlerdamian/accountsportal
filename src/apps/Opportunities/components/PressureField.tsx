// ─────────────────────────────────────────────────────────────────────────────
// The field: every open opportunity as a bubble in a d3-force layout, drawn on
// a single canvas from one requestAnimationFrame loop. Runs on WALL CLOCK time
// — no simulated clock, no speed controls. Within a session the field is
// near-static; the change is visible day to day.
//
// prefers-reduced-motion: the simulation settles synchronously and holds still;
// colour and size stay accurate via a slow repaint interval.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef } from "react";
import {
  forceSimulation,
  forceCollide,
  forceX,
  forceY,
  type Simulation,
} from "d3-force";
import { computeOpportunityState } from "../lib/growth.js";
import type { Opportunity, OpportunityActivity } from "../hooks/useOpportunityQueries";
import type { StaffTask } from "@tasks/hooks/use-task-queries";

interface FieldNode {
  id: string;
  opp: Opportunity;
  state: ReturnType<typeof computeOpportunityState>;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
}

interface PressureFieldProps {
  opportunities: Opportunity[];
  activitiesByOpp: Map<string, OpportunityActivity[]>;
  tasksByOpp: Map<string, StaffTask[]>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

// ── Colour: teal (healthy) → brand accent → red (past tolerance) ─────────────

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lerpRgb(a: [number, number, number], b: [number, number, number], t: number) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t)) as [number, number, number];
}

function healthRgb(
  health: number,
  teal: [number, number, number],
  accent: [number, number, number],
  red: [number, number, number],
): [number, number, number] {
  if (health <= 0.55) return lerpRgb(teal, accent, health / 0.55);
  if (health <= 1) return lerpRgb(accent, red, (health - 0.55) / 0.45);
  return red;
}

const STATE_REFRESH_MS = 5_000; // growth moves daily; 5 s is plenty of resolution

export default function PressureField({
  opportunities,
  activitiesByOpp,
  tasksByOpp,
  selectedId,
  onSelect,
}: PressureFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const simRef = useRef<Simulation<FieldNode, undefined> | null>(null);
  const nodesRef = useRef<FieldNode[]>([]);
  const selectedRef = useRef<string | null>(selectedId);
  selectedRef.current = selectedId;

  // Data changes (new sync, ticked task) recompute immediately.
  const dataRef = useRef({ activitiesByOpp, tasksByOpp });
  dataRef.current = { activitiesByOpp, tasksByOpp };

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const teal = hexToRgb(cssVar("--brand-aqua", "#335c67"));
    const accent = hexToRgb(cssVar("--brand-accent", "#e09f3e"));
    const red = hexToRgb(cssVar("--brand-pink", "#9e2a2b"));
    const mutedText = cssVar("--text-tertiary", "#6b7280");
    const labelColor = cssVar("--text-primary", "#f8fafc");

    let width = wrap.clientWidth;
    let height = wrap.clientHeight;
    const dpr = window.devicePixelRatio || 1;

    const sizeCanvas = () => {
      width = wrap.clientWidth;
      height = wrap.clientHeight;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    sizeCanvas();

    const computeStates = (nowMs: number) => {
      for (const n of nodesRef.current) {
        n.state = computeOpportunityState(
          n.opp,
          dataRef.current.activitiesByOpp.get(n.id) ?? [],
          dataRef.current.tasksByOpp.get(n.id) ?? [],
          nowMs,
        );
      }
    };

    // Preserve positions for bubbles that already exist; seed new ones centre-out.
    const prev = new Map(nodesRef.current.map((n) => [n.id, n]));
    nodesRef.current = opportunities.map((opp, i) => {
      const existing = prev.get(opp.id);
      const angle = (i / Math.max(1, opportunities.length)) * Math.PI * 2;
      return {
        id: opp.id,
        opp,
        state: existing?.state ?? computeOpportunityState(opp, [], [], Date.now()),
        x: existing?.x ?? width / 2 + Math.cos(angle) * Math.min(width, height) * 0.25,
        y: existing?.y ?? height / 2 + Math.sin(angle) * Math.min(width, height) * 0.25,
        vx: existing?.vx,
        vy: existing?.vy,
      };
    });
    computeStates(Date.now());

    const sim = forceSimulation<FieldNode>(nodesRef.current)
      .force("x", forceX<FieldNode>(() => width / 2).strength(0.02))
      .force("y", forceY<FieldNode>(() => height / 2).strength(0.03))
      .force(
        "collide",
        // Collision radius re-read from current bubble size on every tick.
        forceCollide<FieldNode>().radius((d) => d.state.haloRadius + 2).iterations(2),
      )
      .alphaDecay(reducedMotion ? 0.0228 : 0) // reduced motion: settle then stop
      .velocityDecay(0.35)
      .stop();
    simRef.current = sim;

    const clampNodes = () => {
      for (const n of nodesRef.current) {
        const r = n.state.haloRadius + 2;
        n.x = Math.min(width - r, Math.max(r, n.x));
        n.y = Math.min(height - r, Math.max(r, n.y));
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      ctx.font = '11px Inter, sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      for (const n of nodesRef.current) {
        const { coreRadius, haloRadius, health, parked, overTolerance } = n.state;

        if (parked) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, coreRadius, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(107, 114, 128, 0.18)";
          ctx.fill();
          ctx.strokeStyle = "rgba(107, 114, 128, 0.45)";
          ctx.lineWidth = 1;
          ctx.stroke();
        } else {
          const [r, g, b] = healthRgb(health, teal, accent, red);
          // Halo: neglect.
          if (haloRadius > coreRadius + 0.5) {
            ctx.beginPath();
            ctx.arc(n.x, n.y, haloRadius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.16)`;
            ctx.fill();
          }
          // Core: deal value.
          ctx.beginPath();
          ctx.arc(n.x, n.y, coreRadius, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.85)`;
          ctx.fill();
          // Over the line: dashed ring, and only then.
          if (overTolerance) {
            ctx.beginPath();
            ctx.arc(n.x, n.y, haloRadius + 5, 0, Math.PI * 2);
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.9)`;
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }

        if (n.id === selectedRef.current) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.state.haloRadius + 9, 0, Math.PI * 2);
          ctx.strokeStyle = labelColor;
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        // Label only once the bubble can hold it legibly.
        const label = n.opp.account_name || n.opp.deal_name;
        if (label) {
          const textW = ctx.measureText(label).width;
          if (textW + 10 <= n.state.haloRadius * 2) {
            ctx.fillStyle = parked ? mutedText : labelColor;
            ctx.fillText(label, n.x, n.y);
          }
        }
      }
    };

    let raf = 0;
    let lastStateRefresh = 0;
    let stateTimer: ReturnType<typeof setInterval> | null = null;

    if (reducedMotion) {
      // Settle once, synchronously, then hold positions still.
      sim.alpha(1);
      for (let i = 0; i < 300; i++) sim.tick();
      clampNodes();
      draw();
      // Colour and size must stay accurate even while nothing moves.
      stateTimer = setInterval(() => {
        computeStates(Date.now());
        draw();
      }, STATE_REFRESH_MS);
    } else {
      sim.alpha(0.9);
      const loop = (t: number) => {
        if (t - lastStateRefresh > STATE_REFRESH_MS) {
          computeStates(Date.now());
          lastStateRefresh = t;
        }
        sim.tick();
        clampNodes();
        draw();
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }

    const hit = (ev: MouseEvent): FieldNode | null => {
      const rect = canvas.getBoundingClientRect();
      const mx = ev.clientX - rect.left;
      const my = ev.clientY - rect.top;
      // Topmost = smallest hit halo wins on overlap.
      let best: FieldNode | null = null;
      for (const n of nodesRef.current) {
        const d2 = (n.x - mx) ** 2 + (n.y - my) ** 2;
        const r = Math.max(n.state.haloRadius, n.state.coreRadius) + 2;
        if (d2 <= r * r && (!best || r < best.state.haloRadius)) best = n;
      }
      return best;
    };

    const onClick = (ev: MouseEvent) => {
      const n = hit(ev);
      onSelect(n ? n.id : null);
      if (reducedMotion) {
        // No animation loop running — repaint once so the selection ring shows.
        requestAnimationFrame(() => draw());
      } else if (simRef.current) {
        simRef.current.alpha(Math.max(simRef.current.alpha(), 0.1));
      }
    };
    const onMove = (ev: MouseEvent) => {
      canvas.style.cursor = hit(ev) ? "pointer" : "default";
    };
    canvas.addEventListener("click", onClick);
    canvas.addEventListener("mousemove", onMove);

    const ro = new ResizeObserver(() => {
      sizeCanvas();
      if (reducedMotion) {
        sim.alpha(1);
        for (let i = 0; i < 200; i++) sim.tick();
        clampNodes();
        draw();
      } else {
        sim.alpha(Math.max(sim.alpha(), 0.3));
      }
    });
    ro.observe(wrap);

    return () => {
      cancelAnimationFrame(raf);
      if (stateTimer) clearInterval(stateTimer);
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("mousemove", onMove);
      ro.disconnect();
      sim.stop();
    };
    // Rebuild when the set of opportunities (or their sync state) changes;
    // activity/task refs update via dataRef without a rebuild.
  }, [opportunities, onSelect]);

  // Nudge state recompute when register data changes (deflation must be prompt).
  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    for (const n of nodesRef.current) {
      n.state = computeOpportunityState(
        n.opp,
        activitiesByOpp.get(n.id) ?? [],
        tasksByOpp.get(n.id) ?? [],
        Date.now(),
      );
    }
    sim.alpha(Math.max(sim.alpha(), 0.15));
  }, [activitiesByOpp, tasksByOpp]);

  return (
    <div ref={wrapRef} style={{ position: "absolute", inset: 0 }}>
      <canvas ref={canvasRef} style={{ display: "block" }} />
    </div>
  );
}
