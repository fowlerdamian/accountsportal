# step2drawing

Batch-convert a folder of STEP files into **one A3 PDF drawing per part** — no CAD software.
Geometry comes from [build123d](https://github.com/gumyr/build123d) (OpenCascade hidden-line removal);
the sheet is drawn with reportlab.

Each drawing has:

- **Third angle projection** — front view, top view above it, right view to its right, isometric in the top-right.
- **Hidden lines dashed** on the orthographic views (the isometric shows visible edges only).
- **Auto-scale** to the largest ISO 5455 scale that fits (2:1, 1:1, 1:2, 1:5, 1:10 …). If the isometric
  won't fit at the drawing scale it gets its own, shown under the view and in the notes.
- **Overall envelope dimensions** on every view (width/height on front, width/depth on top, depth/height on right).
  Small spans put arrows (and text if needed) outside the extension lines.
- **Hole callouts** (`4× Ø6.5`) from cylindrical faces, with centre marks, placed on the view that shows the
  holes end-on. Leaders route around dimensions, labels and other views. Holes on an inclined axis are
  listed in the NOTES instead.
- **Title block** — AGA logo, part name (the file name), scale, units mm, date, drawn by, rev, third-angle symbol.

## Install

Python 3.10+ (tested on 3.14, Windows).

```powershell
cd C:\Users\Damian\Projects\step-drawings
py -3.14 -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
```

## Use

```powershell
.venv\Scripts\python step2drawing.py <folder-of-step-files> [options]
```

| Option | Default | |
|---|---|---|
| `-o, --out DIR` | `<input>\drawings` | where PDFs go |
| `--drawn-by NAME` | `DRAWN_BY` env var, else your Windows user name | title block |
| `--rev REV` | `A` | title block |
| `--date DATE` | today (`YYYY-MM-DD`) | title block |
| `--logo FILE` | `assets\aga-logo.png` | title block logo |
| `-r, --recursive` | off | include sub-folders |
| `--preview` | off | also write `<part>.png` next to each PDF for a quick look |

Picks up `.step` / `.stp` in any case. A file that fails to read is reported and skipped; the run carries on
and exits with code 1 so scripts can tell.

## Sample run

`samples/make_samples.py` builds four test parts in `samples/step/`:

| Part | What it tests |
|---|---|
| `mounting-plate` | 4× corner holes + centre bore, rounded corners, a 6 mm thickness (tight dims) |
| `L-bracket` | holes on two axes (top + front views), internal fillet that must **not** count as a hole |
| `flanged_bush` | 6× bolt-circle holes, bore, bosses that must not count as holes |
| `long-rail` | 800 mm part → auto-scales to 1:5, 9 holes |

```text
> .venv\Scripts\python samples\make_samples.py
> .venv\Scripts\python step2drawing.py samples\step -o samples\drawings --drawn-by "D. Fowler" --preview
OK    flanged_bush.step -> flanged_bush.pdf  scale 1:1  envelope 90 x 90 x 42  holes: 1x dia 30, 6x dia 9
OK    L-bracket.step -> L-bracket.pdf  scale 1:1  envelope 100 x 60 x 70  holes: 2x dia 8.5, 3x dia 6.5
OK    long-rail.step -> long-rail.pdf  scale 1:5  envelope 800 x 40 x 20  holes: 9x dia 8.5
OK    mounting-plate.step -> mounting-plate.pdf  scale 1:1  envelope 120 x 80 x 6  holes: 1x dia 22, 4x dia 6.5
4/4 drawings written to samples\drawings
```

Sample parts and drawings live in `~/Projects/step-drawings/samples/`.


## How it works

1. `import_step` → build123d shape; envelope = bounding box.
2. Scale = largest preferred scale where front + right fit across and top + front fit vertically.
3. `project_to_viewport` (orthographic HLR) for each view → visible + hidden edges; curves are sampled at
   ~0.4 mm on paper.
4. Holes = **concave** cylindrical faces (normal points at the axis), merged per axis (split half-faces count once),
   kept only if they cover ≥ 50 % of a full circle. That threshold is what rejects internal fillets.
   Bosses and outer diameters are convex, so they're ignored.
5. Callouts are placed last. Each tries 12 leader angles × increasing lengths from every hole in the
   group and keeps the shortest one that clears everything already on the sheet.

## Limits

- Dimensions are the **overall envelope** only, plus hole Ø and qty. There are no feature locations, tolerances,
  thread data, counterbore/countersink symbols, or THRU/depth.
- Views follow the STEP file's own axes: front looks along +Y, top looks down −Z. If a part was modelled
  lying on its side, its "front" will be too.
- Assemblies (multiple solids) are drawn as one part.
- Tangent edges (e.g. where a fillet meets a flat) are drawn as visible lines, which is what OpenCascade's HLR returns.

## Staff portal: R&D → Drawings

The portal tab `/projects/drawings` queues STEP uploads in `public.step_drawing_jobs` and the private
`step-drawings` bucket (`step/<id>/…` in, `out/<id>/<part>.pdf|.png` out). `worker.py` claims queued jobs,
runs `make_drawing`, uploads the PDF + PNG and marks the job done or error.

- Runs on the R&D PC: Task Scheduler `AGA-STEP-Drawings-Worker` (at logon + every 5 min, IgnoreNew)
  → `tools\step-drawings-worker-scheduled.ps1` → `%USERPROFILE%\Projects\step-drawings\.venv\Scripts\python.exe`.
- Service-role key: DPAPI file `tools\.sldprt-key.bin` (shared with the SLDPRT thumbnails task).
- Log: `tools\logs\step-drawings-worker.log`. Jobs stuck in `running` for 15 min are requeued.
- If the PC is off, jobs wait; the tab shows a banner after 2 minutes.
