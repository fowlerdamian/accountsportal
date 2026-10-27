"""step2drawing — batch STEP → A3 third-angle PDF drawings.

One PDF per part: front / top / right orthographic views (third angle), an
isometric view, hidden lines dashed, overall envelope dimensions on every
view, hole callouts (Ø + qty) from cylindrical faces, and an AGA title block.

Geometry: build123d (OpenCascade HLR). PDF: reportlab. No CAD software needed.
"""

from __future__ import annotations

import argparse
import datetime as dt
import getpass
import math
import os
import re
import sys
from dataclasses import dataclass, field
from fractions import Fraction
from pathlib import Path

import build123d as bd
from reportlab.lib.pagesizes import A3, landscape
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas as rl_canvas

HERE = Path(__file__).resolve().parent
DEFAULT_LOGO = HERE / "assets" / "aga-logo.png"

# ── Sheet geometry (all mm, origin bottom-left) ────────────────────────────
SHEET_W, SHEET_H = 420.0, 297.0  # A3 landscape
BORDER = 10.0
TB_W, TB_H = 250.0, 66.0  # title block, bottom-right inside the border
VIEW_GAP = 28.0  # space between adjacent views (room for labels)
DIM_OFFSET = 10.0  # dimension line distance from the view
LABEL_OFFSET = 20.0  # view label distance below the view
MARGIN_DIM = 24.0  # space reserved around the view block for dims/labels

# ISO 5455 preferred scales, largest first
# plus 1:2.5 and 1:4 (BS 8888 / common practice) so a part that just misses 1:2 doesn't drop straight to 1:5
SCALES = [Fraction(n) for n in (50, 20, 10, 5, 2)] + [Fraction(1, d) for d in (1, 2)] + [Fraction(2, 5), Fraction(1, 4)]     + [Fraction(1, d) for d in (5, 10, 20, 50, 100, 200, 500)]

LW_VISIBLE, LW_HIDDEN, LW_THIN = 0.5, 0.25, 0.18
HIDDEN_DASH = (3.0, 1.5)
CHAIN_DASH = (8.0, 1.5, 1.5, 1.5)
TEXT_H = 3.5  # dimension text height
ARROW_L = 3.0
HOLE_MIN_COVERAGE = 0.5  # concave cylinders covering less arc than this are fillets, not holes

# Principal views: camera direction (from part centre), viewport up, and how
# 3D (x, y, z) maps to the view's 2D (u, v). Verified against HLR output.
VIEWS = {
    "front": dict(dir=(0, -1, 0), up=(0, 0, 1), uv=lambda p: (p[0], p[2])),
    "top": dict(dir=(0, 0, 1), up=(0, 1, 0), uv=lambda p: (p[0], p[1])),
    "right": dict(dir=(1, 0, 0), up=(0, 0, 1), uv=lambda p: (p[1], p[2])),
}
ISO_DIR, ISO_UP = (1, -1, 1), (0, 0, 1)  # conventional iso corner; tie-break winner
# Isometric candidates: all eight cube corners. Views from below are allowed but
# must beat the best view from above by this much visible-edge fraction.
ISO_CANDIDATES = [(sx, sy, sz) for sz in (1, -1) for sx in (1, -1) for sy in (-1, 1)]
ISO_BELOW_PENALTY = 0.05
AXIS_VIEW = {0: "right", 1: "front", 2: "top"}  # hole axis ∥ X/Y/Z → view showing it as a circle

Rect = tuple[float, float, float, float]  # x0, y0, x1, y1


# ── Geometry ───────────────────────────────────────────────────────────────
@dataclass
class ProjectedView:
    visible: list[list[tuple[float, float]]]
    hidden: list[list[tuple[float, float]]]
    bbox: tuple[float, float, float, float]  # umin, vmin, umax, vmax (model mm, relative to part centre)

    @property
    def width(self) -> float:
        return self.bbox[2] - self.bbox[0]

    @property
    def height(self) -> float:
        return self.bbox[3] - self.bbox[1]


@dataclass
class HoleGroup:
    diameter: float
    axis: int | None  # 0/1/2 when parallel to X/Y/Z, else None
    centres: list[tuple[float, float, float]] = field(default_factory=list)  # a point on each hole axis

    @property
    def qty(self) -> int:
        return len(self.centres)


def _polyline(edge: bd.Edge, resolution: float) -> list[tuple[float, float]]:
    """Edge → 2D points. Lines need only their endpoints; curves are sampled every `resolution` model mm."""
    if edge.geom_type == bd.GeomType.LINE:
        ts = (0.0, 1.0)
    else:
        n = max(8, min(400, int(edge.length / max(resolution, 1e-6))))
        ts = [i / n for i in range(n + 1)]
    return [(p.X, p.Y) for p in (edge.position_at(t) for t in ts)]


def project(shape: bd.Shape, direction, up, centre: bd.Vector, resolution: float, hidden=True) -> ProjectedView:
    eye = centre + bd.Vector(*direction).normalized() * 10_000
    vis_edges, hid_edges = shape.project_to_viewport(eye, up, centre)
    vis = [_polyline(e, resolution) for e in vis_edges]
    hid = [_polyline(e, resolution) for e in hid_edges] if hidden else []
    pts = [p for line in vis + hid for p in line] or [(0.0, 0.0)]
    us, vs = [p[0] for p in pts], [p[1] for p in pts]
    return ProjectedView(vis, hid, (min(us), min(vs), max(us), max(vs)))


def pick_iso_direction(shape: bd.Shape, centre: bd.Vector) -> tuple[tuple[int, int, int], float]:
    """Isometric corner that hides the least: highest share of edge length left visible.

    Folds, flanges and pockets that face away from a corner turn into hidden
    edges there, so the corner with the most visible edge length shows the most
    features. Returns (direction, visible fraction).
    """
    best, best_score, best_frac = ISO_DIR, -math.inf, 0.0
    for d in ISO_CANDIDATES:
        eye = centre + bd.Vector(*d).normalized() * 10_000
        vis, hid = shape.project_to_viewport(eye, ISO_UP, centre)
        lv, lh = sum(e.length for e in vis), sum(e.length for e in hid)
        frac = lv / (lv + lh) if lv + lh > 0 else 0.0
        score = frac - (ISO_BELOW_PENALTY if d[2] < 0 else 0.0) + (1e-3 if d == ISO_DIR else 0.0)
        if score > best_score:
            best, best_score, best_frac = d, score, frac
    return best, best_frac


ORIENT_CANDIDATES = 6  # largest plate directions tried as the front face


def _face_front(shape: bd.Shape, n: bd.Vector) -> bd.Shape:
    """Rotate so plate normal n points along Y (seen flat in the front view), then spin about Y
    to the tightest outline with the longest side horizontal."""
    target = bd.Vector(0, 1, 0)
    axis = n.cross(target)
    if axis.length > 1e-9:
        ang = math.degrees(math.acos(max(-1.0, min(1.0, n.dot(target)))))
        shape = shape.rotate(bd.Axis(shape.bounding_box().center(), axis.normalized()), ang)

    pts = [(v.X, v.Z) for v in shape.vertices()]
    cands = {0.0}
    for e in shape.edges():  # straight edges lying in the X-Z plane give the candidate spins
        if e.geom_type == bd.GeomType.LINE and e.length > 1.0:
            d = e.position_at(1) - e.position_at(0)
            if abs(d.Y) < 1e-3 * e.length:
                cands.add(round(math.degrees(math.atan2(d.Z, d.X)) % 90.0, 3))

    def area(a):
        c, s = math.cos(math.radians(a)), math.sin(math.radians(a))
        us = [x * c + z * s for x, z in pts]
        ws = [-x * s + z * c for x, z in pts]
        return (max(us) - min(us)) * (max(ws) - min(ws))

    best = min(cands, key=area)
    if best > 1e-6:
        # rotation sense about Y is easiest to settle empirically: keep whichever way is tighter
        yc = bd.Axis(shape.bounding_box().center(), (0, 1, 0))
        shape = min((shape.rotate(yc, best), shape.rotate(yc, -best)),
                    key=lambda r: r.bounding_box().size.X * r.bounding_box().size.Z)
    b = shape.bounding_box()
    if b.size.Z > b.size.X:
        shape = shape.rotate(bd.Axis(b.center(), (0, 1, 0)), 90)
    return shape


def orient_part(shape: bd.Shape) -> tuple[bd.Shape, bool]:
    """Square a tilted part up to the drawing axes so envelope dims are real lengths.

    Parts are often modelled at an angle (a bracket placed as it sits on the
    vehicle). Their X/Y/Z spans then match no real edge and every hole reads as
    inclined. When the largest plate isn't square to an axis, each of the
    largest plate directions is tried as the front face; the winner puts the
    most plate area square to the views (so the main plate and its holes read
    true), with the smaller envelope as tie-break. A part whose largest plate
    is already square to an axis is left exactly as modelled.
    """
    areas: dict[tuple, list] = {}
    for f in shape.faces():
        if f.geom_type != bd.GeomType.PLANE:
            continue
        n = f.normal_at().normalized()
        if max((n.X, n.Y, n.Z), key=abs) < 0:
            n = -n
        key = (round(n.X, 2), round(n.Y, 2), round(n.Z, 2))
        areas.setdefault(key, [n, 0.0])[1] += f.area
    if not areas:
        return shape, False
    ranked = sorted(areas.values(), key=lambda a: -a[1])
    n0 = ranked[0][0]
    if max(abs(n0.X), abs(n0.Y), abs(n0.Z)) > 1 - 1e-4:
        return shape, False  # main plate already square to an axis: keep the modelled orientation

    def score(s):
        square = sum(f.area for f in s.faces() if f.geom_type == bd.GeomType.PLANE
                     and max(abs(c) for c in tuple(f.normal_at())) > 1 - 1e-4)
        b = s.bounding_box()
        return (-round(square, -2), b.size.X * b.size.Y * b.size.Z)  # area to ~100 mm² so near-ties fall to volume

    options = [_face_front(shape, n) for n, _ in ranked[:ORIENT_CANDIDATES]]
    return min(options, key=score), True


def find_holes(shape: bd.Shape) -> list[HoleGroup]:
    """Concave cylindrical faces → holes, de-duplicated per axis and grouped by diameter."""
    acc: dict[tuple, dict] = {}
    for face in shape.faces():
        if face.geom_type != bd.GeomType.CYLINDER:
            continue
        axis, r = face.axis_of_rotation, face.radius
        d, o = axis.direction.normalized(), axis.position
        pt = face.center()
        radial = pt - (o + d * (pt - o).dot(d))
        if face.normal_at(pt).dot(radial) >= 0:
            continue  # convex → boss / outer diameter, not a hole
        # canonical axis: direction with first significant component positive, foot point nearest origin
        comps = [c for c in (d.X, d.Y, d.Z) if abs(c) > 1e-6]
        if comps and comps[0] < 0:
            d = -d
        foot = o - d * o.dot(d)
        key = (round(2 * r, 3), round(d.X, 3), round(d.Y, 3), round(d.Z, 3),
               round(foot.X, 2), round(foot.Y, 2), round(foot.Z, 2))
        ts = [(v.center() - o).dot(d) for v in face.vertices()] or [0.0]
        entry = acc.setdefault(key, dict(area=0.0, tmin=math.inf, tmax=-math.inf, r=r, d=d, foot=foot))
        entry["area"] += face.area
        entry["tmin"], entry["tmax"] = min(entry["tmin"], *ts), max(entry["tmax"], *ts)

    groups: dict[tuple, HoleGroup] = {}
    for e in acc.values():
        length = e["tmax"] - e["tmin"]
        if length <= 1e-6 or e["area"] / (2 * math.pi * e["r"] * length) < HOLE_MIN_COVERAGE:
            continue  # partial arc → internal fillet / slot end, not a round hole
        d = e["d"]
        # within ~2.5° of an axis counts as on it: bent sheet parts are rarely squared up exactly
        axis = next((i for i, c in enumerate((d.X, d.Y, d.Z)) if abs(abs(c) - 1) < 1e-3), None)
        dia = round(2 * e["r"], 2)
        g = groups.setdefault((dia, axis), HoleGroup(dia, axis))
        g.centres.append((e["foot"].X, e["foot"].Y, e["foot"].Z))
    return sorted(groups.values(), key=lambda g: (-g.diameter, g.axis if g.axis is not None else 9))


# ── Formatting ─────────────────────────────────────────────────────────────
def fmt(v: float) -> str:
    return f"{v:.2f}".rstrip("0").rstrip(".")


def hole_label(g: HoleGroup) -> str:
    return f"{g.qty}× Ø{fmt(g.diameter)}" if g.qty > 1 else f"Ø{fmt(g.diameter)}"


def fmt_scale(s: Fraction) -> str:
    if s < 1 and s.numerator != 1:
        return f"1:{float(1 / s):g}"  # 2/5 → 1:2.5
    return f"{s.numerator}:{s.denominator}"


def pick_scale(fit: float) -> Fraction:
    return next((s for s in SCALES if s <= fit), SCALES[-1])


# ── 2D collision helpers (for placing callouts) ────────────────────────────
def rects_overlap(a: Rect, b: Rect) -> bool:
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def segment_hits_rect(p: tuple[float, float], q: tuple[float, float], r: Rect) -> bool:
    """Liang–Barsky: does segment pq pass through rectangle r?"""
    (x0, y0), (x1, y1) = p, q
    dx, dy = x1 - x0, y1 - y0
    t0, t1 = 0.0, 1.0
    for pk, qk in ((-dx, x0 - r[0]), (dx, r[2] - x0), (-dy, y0 - r[1]), (dy, r[3] - y0)):
        if abs(pk) < 1e-12:
            if qk < 0:
                return False
        else:
            t = qk / pk
            if pk < 0:
                t0 = max(t0, t)
            else:
                t1 = min(t1, t)
            if t0 > t1:
                return False
    return True


def segments_cross(a, b, c, d) -> bool:
    def orient(p, q, r):
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
    return orient(a, b, c) * orient(a, b, d) < 0 and orient(c, d, a) * orient(c, d, b) < 0


# ── PDF primitives (canvas is pre-scaled so 1 unit = 1 mm) ─────────────────
class Sheet:
    def __init__(self, path: Path):
        self.c = rl_canvas.Canvas(str(path), pagesize=landscape(A3))
        self.c.scale(mm, mm)
        self.c.setLineCap(1)
        self.c.setLineJoin(1)
        self.blocked: list[Rect] = []  # areas callout text/leaders must avoid
        self.leaders: list[tuple[tuple[float, float], tuple[float, float]]] = []

    def block(self, r: Rect, pad: float = 0.0):
        self.blocked.append((min(r[0], r[2]) - pad, min(r[1], r[3]) - pad, max(r[0], r[2]) + pad, max(r[1], r[3]) + pad))

    def style(self, width: float, dash=None, grey: float = 0.0):
        self.c.setLineWidth(width)
        self.c.setDash(list(dash) if dash else [])
        self.c.setStrokeGray(grey)

    def polyline(self, pts):
        if len(pts) < 2:
            return
        p = self.c.beginPath()
        p.moveTo(*pts[0])
        for q in pts[1:]:
            p.lineTo(*q)
        self.c.drawPath(p, stroke=1, fill=0)

    def line(self, x1, y1, x2, y2):
        self.c.line(x1, y1, x2, y2)

    def rect(self, x, y, w, h, width=LW_VISIBLE):
        self.style(width)
        self.c.rect(x, y, w, h, stroke=1, fill=0)

    def width_of(self, s: str, size=TEXT_H, font="Helvetica") -> float:
        return self.c.stringWidth(s, font, size)

    def text(self, x, y, s, size=TEXT_H, anchor="middle", font="Helvetica", angle=0.0):
        self.c.saveState()
        self.c.translate(x, y)
        self.c.rotate(angle)
        self.c.setFont(font, size)
        self.c.setFillGray(0)
        {"start": self.c.drawString, "middle": self.c.drawCentredString, "end": self.c.drawRightString}[anchor](0, 0, s)
        self.c.restoreState()

    def fit_text(self, x, y, s, max_w, size, font="Helvetica-Bold", anchor="start"):
        while size > 2 and self.c.stringWidth(s, font, size) > max_w:
            size -= 0.25
        self.text(x, y, s, size=size, font=font, anchor=anchor)

    def arrow(self, x, y, ux, uy, length=ARROW_L, half=0.9):
        """Filled arrowhead with its tip at (x, y) pointing along (ux, uy)."""
        bx, by = x - ux * length, y - uy * length
        p = self.c.beginPath()
        p.moveTo(x, y)
        p.lineTo(bx - uy * half, by + ux * half)
        p.lineTo(bx + uy * half, by - ux * half)
        p.close()
        self.c.setFillGray(0)
        self.c.drawPath(p, stroke=0, fill=1)

    def save(self):
        self.c.showPage()
        self.c.save()


# ── Drawing pieces ─────────────────────────────────────────────────────────
def draw_view(sh: Sheet, view: ProjectedView, cx: float, cy: float, scale: float) -> Rect:
    """Draw a projected view with its bbox centre at (cx, cy). Hidden first so visible lines sit on top."""
    mu, mv = (view.bbox[0] + view.bbox[2]) / 2, (view.bbox[1] + view.bbox[3]) / 2
    to_sheet = lambda line: [(cx + (u - mu) * scale, cy + (v - mv) * scale) for u, v in line]
    sh.style(LW_HIDDEN, HIDDEN_DASH)
    for line in view.hidden:
        sh.polyline(to_sheet(line))
    sh.style(LW_VISIBLE)
    for line in view.visible:
        sh.polyline(to_sheet(line))
    hw, hh = view.width * scale / 2, view.height * scale / 2
    return (cx - hw, cy - hh, cx + hw, cy + hh)


def dim_horizontal(sh: Sheet, x1, x2, y_feature, y_dim, value: float):
    """Horizontal dimension. Tight spans get arrows outside the extension lines, and text outside if it won't fit."""
    sign = 1 if y_dim > y_feature else -1
    label = fmt(value)
    tw = sh.width_of(label)
    span = x2 - x1
    sh.style(LW_THIN)
    for x in (x1, x2):
        sh.line(x, y_feature + sign * 1.5, x, y_dim + sign * 2.0)
    if span >= 2 * ARROW_L + 6:
        sh.line(x1, y_dim, x2, y_dim)
        sh.arrow(x1, y_dim, -1, 0)
        sh.arrow(x2, y_dim, 1, 0)
        lo, hi = x1, x2
    else:
        sh.line(x1 - ARROW_L - 4, y_dim, x2 + ARROW_L + 4, y_dim)
        sh.arrow(x1, y_dim, 1, 0)
        sh.arrow(x2, y_dim, -1, 0)
        lo, hi = x1 - ARROW_L - 4, x2 + ARROW_L + 4
    if span >= tw + 2:
        sh.text((x1 + x2) / 2, y_dim + 1.0, label)
    else:
        sh.text(hi + 1.0, y_dim - TEXT_H * 0.35, label, anchor="start")
        hi += tw + 2
    sh.block((lo, y_feature + sign * 1.0, hi, y_dim + (TEXT_H + 1.5 if sign > 0 else -2.0)), pad=0.5)
    sh.block((lo, y_dim - 1.0, hi, y_dim + TEXT_H + 1.5), pad=0.5)


def dim_vertical(sh: Sheet, y1, y2, x_feature, x_dim, value: float):
    sign = 1 if x_dim > x_feature else -1
    label = fmt(value)
    tw = sh.width_of(label)
    span = y2 - y1
    sh.style(LW_THIN)
    for y in (y1, y2):
        sh.line(x_feature + sign * 1.5, y, x_dim + sign * 2.0, y)
    if span >= 2 * ARROW_L + 6:
        sh.line(x_dim, y1, x_dim, y2)
        sh.arrow(x_dim, y1, 0, -1)
        sh.arrow(x_dim, y2, 0, 1)
        lo, hi = y1, y2
    else:
        sh.line(x_dim, y1 - ARROW_L - 4, x_dim, y2 + ARROW_L + 4)
        sh.arrow(x_dim, y1, 0, 1)
        sh.arrow(x_dim, y2, 0, -1)
        lo, hi = y1 - ARROW_L - 4, y2 + ARROW_L + 4
    if span >= tw + 2:
        sh.text(x_dim - 1.0, (y1 + y2) / 2, label, angle=90)
    else:
        sh.text(x_dim - 1.0, hi + 1.0, label, angle=90, anchor="start")
        hi += tw + 2
    sh.block((x_feature + sign * 1.0, lo, x_dim + (2.0 if sign > 0 else -(TEXT_H + 1.5)), hi), pad=0.5)
    sh.block((x_dim - TEXT_H - 1.5, lo, x_dim + 1.0, hi), pad=0.5)


def draw_centre_marks(sh: Sheet, groups: list[HoleGroup], view_name: str, to_sheet, scale: float):
    sh.style(LW_THIN, CHAIN_DASH)
    for g in groups:
        if g.axis is None or AXIS_VIEW[g.axis] != view_name:
            continue
        ext = g.diameter / 2 * scale + 2.0
        for p in g.centres:
            x, y = to_sheet(p)
            sh.line(x - ext, y, x + ext, y)
            sh.line(x, y - ext, x, y + ext)


def place_callout(sh: Sheet, label: str, anchors: list[tuple[float, float]], radius: float, own_view: Rect,
                  other_views: list[Rect]) -> bool:
    """Leader + 'n× Ø' text. Tries leader angles/lengths from every candidate hole and keeps the shortest
    one whose text clears everything already on the sheet and whose leader crosses no dims, text, leaders
    or other views (it may cross its own view to reach an inner hole)."""
    tw = sh.width_of(label)
    frame = (BORDER + 2, BORDER + 2, SHEET_W - BORDER - 2, SHEET_H - BORDER - 2)
    obstacles = sh.blocked + other_views
    best = None
    for (hx, hy) in anchors[:16]:
        for ang in (45, 135, -45, -135, 30, 150, -30, -150, 60, 120, -60, -120):
            ux, uy = math.cos(math.radians(ang)), math.sin(math.radians(ang))
            sx, sy = hx + ux * radius, hy + uy * radius
            for length in range(8, 160, 4):
                ex, ey = sx + ux * length, sy + uy * length
                right = ux > 0
                shoulder = 4.0 if right else -4.0
                tx0 = ex + shoulder + (1.0 if right else -1.0 - tw)
                trect = (tx0 - 0.5, ey - 2.0, tx0 + tw + 0.5, ey + TEXT_H - 0.5)
                lead_end = (ex + shoulder, ey)
                if not (frame[0] <= trect[0] and trect[2] <= frame[2] and frame[1] <= trect[1] and trect[3] <= frame[3]):
                    continue
                if rects_overlap(trect, own_view) or any(rects_overlap(trect, b) for b in obstacles):
                    continue
                segs = (((sx, sy), (ex, ey)), ((ex, ey), lead_end))
                if any(segment_hits_rect(a, b, r) for a, b in segs for r in obstacles):
                    continue
                if any(segments_cross(a, b, c, d) for a, b in segs for c, d in sh.leaders):
                    continue
                cost = length + 3 * abs(abs(ang) % 90 - 45) / 15
                if best is None or cost < best[0]:
                    best = (cost, (sx, sy), (ex, ey), lead_end, ux, uy, tx0, trect)
                break  # longer leaders at this angle only cost more
    if best is None:
        return False
    _, (sx, sy), (ex, ey), lead_end, ux, uy, tx0, trect = best
    sh.style(LW_THIN)
    sh.line(sx, sy, ex, ey)
    sh.line(ex, ey, *lead_end)
    sh.arrow(sx, sy, -ux, -uy, length=2.5, half=0.75)
    sh.text(tx0, ey - TEXT_H * 0.35, label, anchor="start")
    sh.block(trect)
    sh.leaders += [((sx, sy), (ex, ey)), ((ex, ey), lead_end)]
    return True


def third_angle_symbol(sh: Sheet, x: float, y: float, h: float = 9.0):
    """ISO 128 third-angle symbol: truncated cone side view on the left (narrow end → right), end view circles on the right."""
    R, r, L = h / 2, h / 4, h * 1.1
    sh.style(LW_VISIBLE * 0.7)
    sh.polyline([(x, y - R), (x + L, y - r), (x + L, y + r), (x, y + R), (x, y - R)])
    ccx = x + L + h * 0.45 + R
    sh.c.circle(ccx, y, R, stroke=1, fill=0)
    sh.c.circle(ccx, y, r, stroke=1, fill=0)
    sh.style(LW_THIN, (2.0, 0.8, 0.5, 0.8))
    sh.line(x - 1.5, y, ccx + R + 1.5, y)
    sh.line(ccx, y - R - 1.5, ccx, y + R + 1.5)


# Approx. weight: density (g/cm³) by material keyword, first match wins.
DENSITIES = [("stainless", 8.00), ("ss", 8.00), ("alumin", 2.70), ("brass", 8.50), ("copper", 8.96),
             ("steel", 7.85), ("ms", 7.85), ("galv", 7.85), ("nylon", 1.15), ("acetal", 1.41),
             ("abs", 1.05), ("hdpe", 0.95), ("polycarb", 1.20), ("pla", 1.24), ("petg", 1.27)]
CONFIDENTIAL = ("This drawing and any information or descriptive material set out in it are the confidential and "
                "copyright property of Automotive Group Australia Pty Ltd. © and MUST NOT BE DISCLOSED, COPIED, "
                "LOANED in whole or part or used for any purpose without the written permission of "
                "Automotive Group Australia Pty Ltd.")
TOLERANCES = ["Unless Otherwise Stated:", "Linear Tol.: ±0.2, Angular Tol.: 0°15'", "Surface Finish: 0.8µm",
              "All Dimensions: mm"]
OWNER_LINES = ["Automotive Group Australia Pty Ltd", "8 Ribbon Gum Avenue", "www.automotivegroupaustralia.com.au"]


def approx_weight(volume_mm3: float, material: str) -> str:
    """Kg from volume × density of the first recognised material word; blank when unknown."""
    words = material.lower().replace("-", " ").split()
    rho = next((r for k, r in DENSITIES if any(w.startswith(k) if len(k) > 3 else w == k for w in words)), None)
    if rho is None or volume_mm3 <= 0:
        return ""
    kg = volume_mm3 / 1000 * rho / 1000
    return f"{kg:.2f}" if kg < 10 else f"{kg:.1f}"


def part_number(drawing_number: str) -> str:
    """Drawing number less its trailing 6-digit DDMMYY date (FETFR281026 → FETFR)."""
    return re.sub(r"\d{6}$", "", drawing_number) or drawing_number


def wrap(sh: "Sheet", s: str, max_w: float, size: float) -> list[str]:
    lines, cur = [], ""
    for word in s.split():
        nxt = f"{cur} {word}".strip()
        if cur and sh.width_of(nxt, size) > max_w:
            lines.append(cur)
            cur = word
        else:
            cur = nxt
    return lines + ([cur] if cur else [])


TB_COL_B, TB_COL_C = 78.0, 158.0  # title block column splits from its left edge
TB_NOTES_H = 21.0  # notes box, top of column C


def title_block(sh: Sheet, drawing_number: str, scale: Fraction, date: str, drawn_by: str,
                material: str, finish: str, weight: str, logo: Path | None):
    """AGA title block: three columns — material/tolerances | confidentiality/owner | approvals/numbers."""
    x0, y0, W, H = SHEET_W - BORDER - TB_W, BORDER, TB_W, TB_H
    ca, cb = x0 + TB_COL_B, x0 + TB_COL_C
    top = y0 + H
    sh.rect(x0, y0, W, H)
    sh.block((x0, y0, x0 + W, top), pad=2.0)

    def box(x, y, w, h, label=None, value="", size=4.2, bold=False, centre=True):
        """Cell from (x, y) bottom-left: thin border, small label top-left, value below it."""
        sh.style(LW_THIN * 1.5)
        sh.c.rect(x, y, w, h, stroke=1, fill=0)
        if label:
            sh.text(x + 1.2, y + h - 2.6, label, size=2.1, anchor="start")
        if value:
            font = "Helvetica-Bold" if bold else "Helvetica"
            sz = size
            while sz > 2.0 and sh.width_of(value, sz, font) > w - 3:
                sz -= 0.2
            vy = y + (h - (3.0 if label else 0)) / 2 - sz * 0.35
            if centre:
                sh.text(x + w / 2, vy, value, size=sz, font=font)
            else:
                sh.text(x + 1.5, vy, value, size=sz, font=font, anchor="start")

    # ── Column A: material, finish, tolerances, scale, weight/standard, projection/sheet
    aw = ca - x0
    half = aw * 0.46
    rows_a = [9.0, 9.0, 15.0, 8.0, 11.5]  # from the top; projection row takes the rest
    y = top - rows_a[0]
    box(x0, y, aw, rows_a[0], "Material:", material.upper(), size=4.6)
    y -= rows_a[1]
    box(x0, y, aw, rows_a[1], "Finish:", finish.upper(), size=4.6)
    y -= rows_a[2]
    box(x0, y, aw, rows_a[2])
    for i, t in enumerate(TOLERANCES):
        sh.text(x0 + 1.2, y + rows_a[2] - 3.2 - i * 3.3, t, size=2.5, anchor="start")
    y -= rows_a[3]
    box(x0, y, aw, rows_a[3], "Drawing Scale:", fmt_scale(scale), size=4.0, bold=True)
    y -= rows_a[4]
    box(x0, y, half, rows_a[4], "Approx Weight:", f"{weight} Kg" if weight else "Kg", size=3.8)
    box(x0 + half, y, aw - half, rows_a[4])
    for i, t in enumerate(("Drawing Produced In", "Accordance With BS8888")):
        sh.text(x0 + half + (aw - half) / 2, y + rows_a[4] - 4.2 - i * 3.0, t, size=2.4)
    ph = y - y0
    box(x0, y0, half, ph, "Projection Method:")
    sh.text(x0 + half / 2, y0 + ph - 5.6, "THIRD ANGLE", size=2.4, font="Helvetica-Bold")
    third_angle_symbol(sh, x0 + half / 2 - 7.0, y0 + 3.6, h=5.0)
    box(x0 + half, y0, aw - half, ph, "Sheet Size:", "A3", size=6.0)

    # ── Column B: confidentiality, document type, company confidential, legal owner
    bw = cb - ca
    y = top - 21.0
    box(ca, y, bw, 21.0)
    for i, t in enumerate(wrap(sh, CONFIDENTIAL, bw - 3, 2.3)):
        sh.text(ca + 1.5, top - 3.2 - i * 2.75, t, size=2.3, anchor="start")
    y -= 9.0
    box(ca, y, bw, 9.0, "Document Type:", "Part Drawing", size=3.6)
    y -= 8.0
    box(ca, y, bw, 8.0, None, "Company Confidential", size=4.4, bold=True, centre=False)
    oh = y - y0
    box(ca, y0, bw, oh, "Legal Owner:")
    if logo and logo.exists():
        sh.c.drawImage(str(logo), ca + 3, y0 + 9.0, width=bw * 0.6, height=oh - 12.5,
                       preserveAspectRatio=True, anchor="sw", mask="auto")
    for i, t in enumerate(OWNER_LINES):
        sh.text(ca + 1.5, y0 + 6.6 - i * 2.6, t, size=2.2, anchor="start")

    # ── Column C: notes (filled by notes()), drawn, checked, part number, drawing number / sheet
    cw = x0 + W - cb
    hw = cw / 2
    y = top - TB_NOTES_H
    box(cb, y, cw, TB_NOTES_H, "Notes:")
    y -= 9.0
    box(cb, y, hw, 9.0, "Drawn by:", drawn_by, size=3.6)
    box(cb + hw, y, hw, 9.0, "Drawn date:", date, size=3.6)
    y -= 9.0
    box(cb, y, hw, 9.0, "Checked/Approved by:")
    box(cb + hw, y, hw, 9.0, "Checked/Approved date:")
    y -= 12.0
    box(cb, y, cw, 12.0, "Part Number:", part_number(drawing_number), size=4.8)
    nh = y - y0
    nw = cw * 0.72
    box(cb, y0, nw, nh, "Drawing Number:", drawing_number, size=4.8)
    box(cb + nw, y0, cw - nw, nh, "Sheet:", "1 of 1", size=3.4)


def notes(sh: Sheet, groups: list[HoleGroup], iso_scale: Fraction, scale: Fraction, unplaced: list[HoleGroup]):
    lines = ["1. ALL DIMENSIONS IN MILLIMETRES.", "2. THIRD ANGLE PROJECTION.",
             "3. ENVELOPE DIMENSIONS ONLY UNLESS SHOWN."]
    if groups:
        lines.append(f"{len(lines) + 1}. HOLES: " + ", ".join(
            hole_label(g) + (" (INCLINED AXIS)" if g.axis is None else "") for g in groups) + ".")
    if unplaced:
        lines.append(f"{len(lines) + 1}. NOT CALLED OUT ON VIEWS: " + ", ".join(hole_label(g) for g in unplaced) + ".")
    if iso_scale != scale:
        lines.append(f"{len(lines) + 1}. ISOMETRIC VIEW AT {fmt_scale(iso_scale)}.")
    # Into the title block's Notes box, shrinking the text until every wrapped line fits.
    x = SHEET_W - BORDER - TB_W + TB_COL_C + 1.2
    max_w = SHEET_W - BORDER - x - 1.2
    top = BORDER + TB_H - 3.6  # below the "Notes:" label
    avail = TB_NOTES_H - 4.4
    size, indent = 2.5, 2.5
    while True:
        rows = [(j > 0, part) for s in lines for j, part in enumerate(wrap(sh, s, max_w - indent, size))]
        if len(rows) * size * 1.2 <= avail or size <= 1.2:
            break
        size -= 0.1
    for k, (cont, part) in enumerate(rows):
        sh.text(x + (indent if cont else 0), top - size - k * size * 1.2, part, size=size, anchor="start")


# ── One part → one PDF ─────────────────────────────────────────────────────
def make_drawing(step_path: Path, out_path: Path, *, drawn_by: str, date: str, logo: Path | None,
                 material: str = "", finish: str = "") -> dict:
    shape, reoriented = orient_part(bd.import_step(str(step_path)))
    bb = shape.bounding_box()
    size = (bb.size.X, bb.size.Y, bb.size.Z)
    if max(size) <= 0:
        raise ValueError("no geometry read (invalid or empty STEP file)")
    centre = bb.center()
    centre_t = (centre.X, centre.Y, centre.Z)
    X, Y, Z = size

    # Usable area: inside the border, above the title-block band, less room for dims/labels.
    area_x0, area_x1 = BORDER + MARGIN_DIM, SHEET_W - BORDER - MARGIN_DIM
    area_y0, area_y1 = BORDER + TB_H + MARGIN_DIM, SHEET_H - BORDER - MARGIN_DIM
    fit = min((area_x1 - area_x0 - VIEW_GAP) / max(X + Y, 1e-6), (area_y1 - area_y0 - VIEW_GAP) / max(Z + Y, 1e-6))
    scale = pick_scale(fit)
    s = float(scale)

    res = 0.4 / s  # sample curves every ~0.4 mm of paper
    views = {name: project(shape, v["dir"], v["up"], centre, res) for name, v in VIEWS.items()}
    holes = find_holes(shape)

    # Third-angle block anchored bottom-left so spare room goes to the isometric.
    fw, fh, th, rw = X * s, Z * s, Y * s, Y * s
    bx, by = area_x0, area_y0
    centres = {
        "front": (bx + fw / 2, by + fh / 2),
        "top": (bx + fw / 2, by + fh + VIEW_GAP + th / 2),
        "right": (bx + fw + VIEW_GAP + rw / 2, by + fh / 2),
    }

    sh = Sheet(out_path)
    sh.rect(BORDER, BORDER, SHEET_W - 2 * BORDER, SHEET_H - 2 * BORDER, width=0.7)

    view_rects: dict[str, Rect] = {}
    for name, (cx, cy) in centres.items():
        view = views[name]
        r = view_rects[name] = draw_view(sh, view, cx, cy, s)
        uv = VIEWS[name]["uv"]
        cu, cv = uv(centre_t)
        draw_centre_marks(sh, holes, name, lambda p, uv=uv, cx=cx, cy=cy, cu=cu, cv=cv:
                          (cx + (uv(p)[0] - cu) * s, cy + (uv(p)[1] - cv) * s), s)
        left, bottom, right_, top = r
        u_val, v_val = {"front": (X, Z), "top": (X, Y), "right": (Y, Z)}[name]
        if name == "front":
            dim_horizontal(sh, left, right_, bottom, bottom - DIM_OFFSET, u_val)
            dim_vertical(sh, bottom, top, left, left - DIM_OFFSET, v_val)
            label_y = bottom - LABEL_OFFSET
        elif name == "top":
            dim_horizontal(sh, left, right_, top, top + DIM_OFFSET, u_val)
            dim_vertical(sh, bottom, top, left, left - DIM_OFFSET, v_val)
            label_y = bottom - 8.0
        else:
            dim_horizontal(sh, left, right_, bottom, bottom - DIM_OFFSET, u_val)
            dim_vertical(sh, bottom, top, right_, right_ + DIM_OFFSET + TEXT_H, v_val)
            label_y = bottom - LABEL_OFFSET
        label = f"{name.upper()} VIEW"
        sh.text(cx, label_y, label, size=3.5, font="Helvetica-Bold")
        lw = sh.width_of(label, 3.5, "Helvetica-Bold")
        sh.block((cx - lw / 2, label_y - 1.0, cx + lw / 2, label_y + 3.5), pad=1.0)

    # Isometric: visible edges only, from the corner that hides the fewest features,
    # in whichever free cell lets it be largest.
    iso_dir, iso_visible = pick_iso_direction(shape, centre)
    iso = project(shape, iso_dir, ISO_UP, centre, res, hidden=False)
    top_r, right_r = view_rects["top"], view_rects["right"]
    cells = [
        (top_r[2] + 30, right_r[3] + VIEW_GAP, SHEET_W - BORDER - 6, SHEET_H - BORDER - 6),  # above the right view
        (right_r[2] + DIM_OFFSET + TEXT_H + 14, BORDER + TB_H + 8, SHEET_W - BORDER - 6, SHEET_H - BORDER - 6),  # beside it
    ]
    label_room = 10.0

    def cell_fit(c):
        w, h = c[2] - c[0], c[3] - c[1] - label_room
        return min(w / max(iso.width, 1e-6), h / max(iso.height, 1e-6)) if w > 0 and h > 0 else 0.0

    cell = max(cells, key=cell_fit)
    iso_scale = min(scale, pick_scale(cell_fit(cell)))
    if cell_fit(cell) > 0:
        icx, icy = (cell[0] + cell[2]) / 2, (cell[1] + label_room + cell[3]) / 2
        ir = draw_view(sh, iso, icx, icy, float(iso_scale))
        sh.block(ir, pad=2.0)
        lab = "ISOMETRIC VIEW" + ("" if iso_scale == scale else f" ({fmt_scale(iso_scale)})")
        sh.text(icx, ir[1] - 7, lab, size=3.5, font="Helvetica-Bold")
        lw = sh.width_of(lab, 3.5, "Helvetica-Bold")
        sh.block((icx - lw / 2, ir[1] - 8, icx + lw / 2, ir[1] - 3.5), pad=1.0)

    weight = approx_weight(shape.volume, material)
    title_block(sh, step_path.stem, scale, date, drawn_by, material, finish, weight, logo)

    # Hole callouts last, so they can steer around everything already placed.
    unplaced = []
    for g in holes:
        if g.axis is None:
            continue  # inclined holes are listed in the notes only
        name = AXIS_VIEW[g.axis]
        cx, cy = centres[name]
        uv = VIEWS[name]["uv"]
        cu, cv = uv(centre_t)
        anchors = [(cx + (uv(p)[0] - cu) * s, cy + (uv(p)[1] - cv) * s) for p in g.centres]
        # prefer holes nearest the view edge — shortest leaders
        r = view_rects[name]
        anchors.sort(key=lambda a: min(a[0] - r[0], r[2] - a[0], a[1] - r[1], r[3] - a[1]))
        others = [view_rects[n] for n in view_rects if n != name]
        if not place_callout(sh, hole_label(g), anchors, g.diameter / 2 * s, r, others):
            unplaced.append(g)

    notes(sh, holes, iso_scale, scale, unplaced)
    sh.save()
    return dict(scale=fmt_scale(scale), size=size, iso_dir=iso_dir, iso_visible=round(iso_visible, 3), weight=weight, reoriented=reoriented, holes=[(g.qty, g.diameter) for g in holes],
                unplaced=[hole_label(g) for g in unplaced])


def render_preview(pdf: Path, dpi: int = 110) -> Path:
    """PDF → PNG next to it, for a quick visual check."""
    import pymupdf

    png = pdf.with_suffix(".png")
    with pymupdf.open(str(pdf)) as doc:
        doc[0].get_pixmap(dpi=dpi).save(str(png))
    return png


# ── CLI ────────────────────────────────────────────────────────────────────
def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):  # Windows consoles (cp1252) can't print every filename
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")
    ap = argparse.ArgumentParser(prog="step2drawing", description="Batch STEP -> A3 third-angle PDF drawings.")
    ap.add_argument("input", type=Path, help="folder containing .step / .stp files")
    ap.add_argument("-o", "--out", type=Path, help="output folder (default: <input>/drawings)")
    ap.add_argument("--drawn-by", default=os.environ.get("DRAWN_BY") or getpass.getuser(), help="title block DRAWN BY")
    ap.add_argument("--date", default=dt.date.today().isoformat(), help="title block DATE (default today)")
    ap.add_argument("--material", default="", help="title block MATERIAL, e.g. \"3mm mild steel\"")
    ap.add_argument("--finish", default="", help="title block FINISH, e.g. \"black textured PC\"")
    ap.add_argument("--logo", type=Path, default=DEFAULT_LOGO, help="logo image for the title block")
    ap.add_argument("-r", "--recursive", action="store_true", help="also search sub-folders")
    ap.add_argument("--preview", action="store_true", help="also write a PNG preview next to each PDF")
    args = ap.parse_args(argv)

    if not args.input.is_dir():
        ap.error(f"not a folder: {args.input}")
    pattern = "**/*" if args.recursive else "*"
    files = sorted(p for p in args.input.glob(pattern) if p.is_file() and p.suffix.lower() in (".step", ".stp"))
    if not files:
        print(f"no .step/.stp files in {args.input}", file=sys.stderr)
        return 1
    out = args.out or args.input / "drawings"
    out.mkdir(parents=True, exist_ok=True)

    failed = 0
    for f in files:
        pdf = out / f"{f.stem}.pdf"
        try:
            info = make_drawing(f, pdf, drawn_by=args.drawn_by, date=args.date, logo=args.logo,
                                material=args.material, finish=args.finish)
            # console output stays ASCII: Windows terminals often can't show × / Ø
            holes = ", ".join(f"{q}x dia {fmt(d)}" for q, d in info["holes"]) or "none"
            dims = " x ".join(fmt(v) for v in info["size"])
            print(f"OK    {f.name} -> {pdf.name}  scale {info['scale']}  envelope {dims}  holes: {holes}")
            if info["unplaced"]:
                print(f"      note: no room for a leader, listed in NOTES only: {len(info['unplaced'])} group(s)")
            if args.preview:
                render_preview(pdf)
        except Exception as exc:  # keep going; report at the end
            failed += 1
            print(f"FAIL  {f.name}: {exc}", file=sys.stderr)
    print(f"{len(files) - failed}/{len(files)} drawings written to {out}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
