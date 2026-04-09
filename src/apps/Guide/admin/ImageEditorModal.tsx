import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@guide/components/ui/button";
import { Slider } from "@guide/components/ui/slider";
import {
  Circle, MousePointer2, Undo2, Trash2, RotateCw, RotateCcw, FlipHorizontal2, FlipVertical2,
  MoveRight, Crop, RotateCcwIcon, Pen,
} from "lucide-react";
import * as fabric from "fabric";

// ─── Types ───
interface ImageEditorModalProps {
  open: boolean;
  imageUrl: string;
  originalUrl?: string | null;
  brandColour?: string;
  onSave: (editedDataUrl: string) => void;
  onClose: () => void;
}

type TabId = "annotate" | "crop" | "rotate";
type AnnotateTool = "circle" | "arrow" | "select";
type StrokeWeight = 2 | 3 | 5;

const COLOUR_SWATCHES = [
  { label: "Red", hex: "#ff1744" },
  { label: "Yellow", hex: "#FBBF24" },
  { label: "White", hex: "#FFFFFF" },
  { label: "Black", hex: "#111827" },
  { label: "Blue", hex: "#3B82F6" },
  { label: "Green", hex: "#10B981" },
];

const ASPECT_RATIOS: { label: string; value: number | null }[] = [
  { label: "Free", value: null },
  { label: "1:1", value: 1 },
  { label: "4:3", value: 4 / 3 },
  { label: "16:9", value: 16 / 9 },
  { label: "3:4", value: 3 / 4 },
];

// ─── Component ───
export default function ImageEditorModal({ open, imageUrl, originalUrl, brandColour, onSave, onClose }: ImageEditorModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<fabric.Canvas | null>(null);
  const bgImageRef = useRef<fabric.FabricImage | null>(null);

  const [tab, setTab] = useState<TabId>("annotate");
  const [tool, setTool] = useState<AnnotateTool>("circle");
  const [activeColour, setActiveColour] = useState(brandColour || "#F59E0B");
  const [strokeWeight, setStrokeWeight] = useState<StrokeWeight>(3);
  const [history, setHistory] = useState<fabric.FabricObject[][]>([]);
  const [rotation, setRotation] = useState(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);

  // Crop state
  const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [cropAspect, setCropAspect] = useState<number | null>(null);
  const cropRectRef = useRef<fabric.Rect | null>(null);
  const dimRectsRef = useRef<fabric.Rect[]>([]);

  const [isDrawing, setIsDrawing] = useState(false);
  const drawStartRef = useRef<{ x: number; y: number } | null>(null);
  const tempObjectRef = useRef<fabric.FabricObject | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const srcUrl = originalUrl || imageUrl;

  // ─── Init canvas ───
  useEffect(() => {
    if (!open || !canvasRef.current) return;

    const container = canvasRef.current.parentElement!;
    const cw = container.clientWidth;
    const ch = container.clientHeight;

    const canvas = new fabric.Canvas(canvasRef.current, {
      width: cw,
      height: ch,
      backgroundColor: "#111",
      selection: false,
    });
    fabricRef.current = canvas;

    // Load image
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const fImg = new fabric.FabricImage(img);
      const scale = Math.min(cw / img.width, ch / img.height, 1) * 0.9;
      fImg.set({
        scaleX: scale,
        scaleY: scale,
        left: (cw - img.width * scale) / 2,
        top: (ch - img.height * scale) / 2,
        selectable: false,
        evented: false,
        hasControls: false,
        originX: "left",
        originY: "top",
      });
      canvas.add(fImg);
      canvas.sendObjectToBack(fImg);
      bgImageRef.current = fImg;
      canvas.renderAll();
    };
    img.src = srcUrl;

    return () => {
      canvas.dispose();
      fabricRef.current = null;
      bgImageRef.current = null;
      cropRectRef.current = null;
      dimRectsRef.current = [];
    };
  }, [open, srcUrl]);

  // ─── Drawing handlers ───
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || tab !== "annotate") return;

    canvas.selection = tool === "select";
    canvas.defaultCursor = tool === "select" ? "default" : "crosshair";

    // Make objects selectable only in select mode
    canvas.getObjects().forEach((obj) => {
      if (obj === bgImageRef.current) return;
      if (obj === cropRectRef.current) return;
      if (dimRectsRef.current.includes(obj as fabric.Rect)) return;
      obj.set({ selectable: tool === "select", evented: tool === "select" });
    });
    canvas.renderAll();

    const onMouseDown = (opt: any) => {
      if (tool === "select") return;
      const pointer = canvas.getScenePoint(opt.e);
      drawStartRef.current = { x: pointer.x, y: pointer.y };
      setIsDrawing(true);
    };

    const onMouseMove = (opt: any) => {
      if (!isDrawing || tool === "select" || !drawStartRef.current) return;
      const pointer = canvas.getScenePoint(opt.e);
      const start = drawStartRef.current;

      // Remove temp
      if (tempObjectRef.current) {
        canvas.remove(tempObjectRef.current);
        tempObjectRef.current = null;
      }

      if (tool === "circle") {
        const rx = Math.abs(pointer.x - start.x) / 2;
        const ry = Math.abs(pointer.y - start.y) / 2;
        const ellipse = new fabric.Ellipse({
          rx, ry,
          left: Math.min(start.x, pointer.x),
          top: Math.min(start.y, pointer.y),
          fill: "transparent",
          stroke: activeColour,
          strokeWidth: strokeWeight,
          selectable: false,
          evented: false,
        });
        canvas.add(ellipse);
        tempObjectRef.current = ellipse;
      } else if (tool === "arrow") {
        const group = createArrow(start, pointer, activeColour, strokeWeight);
        canvas.add(group);
        tempObjectRef.current = group;
      }
      canvas.renderAll();
    };

    const onMouseUp = () => {
      if (!isDrawing || tool === "select") {
        setIsDrawing(false);
        return;
      }
      if (tempObjectRef.current) {
        tempObjectRef.current.set({ selectable: false, evented: false });
        // Push to history
        setHistory((prev) => [...prev.slice(-19), canvas.getObjects().filter((o) => o !== bgImageRef.current)]);
        tempObjectRef.current = null;
      }
      drawStartRef.current = null;
      setIsDrawing(false);
    };

    canvas.on("mouse:down", onMouseDown);
    canvas.on("mouse:move", onMouseMove);
    canvas.on("mouse:up", onMouseUp);

    return () => {
      canvas.off("mouse:down", onMouseDown);
      canvas.off("mouse:move", onMouseMove);
      canvas.off("mouse:up", onMouseUp);
    };
  }, [tab, tool, activeColour, strokeWeight, isDrawing]);

  // ─── Delete key ───
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        const canvas = fabricRef.current;
        if (!canvas) return;
        const active = canvas.getActiveObject();
        if (active && active !== bgImageRef.current) {
          canvas.remove(active);
          canvas.renderAll();
        }
      }
    };
    if (open) window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  // ─── Rotation / Flip ───
  useEffect(() => {
    const bg = bgImageRef.current;
    if (!bg) return;
    bg.set({ angle: rotation, flipX: flipH, flipY: flipV });
    bg.setCoords();
    fabricRef.current?.renderAll();
  }, [rotation, flipH, flipV]);

  // ─── Arrow helper ───
  function createArrow(start: { x: number; y: number }, end: { x: number; y: number }, colour: string, sw: number) {
    const angle = Math.atan2(end.y - start.y, end.x - start.x) * (180 / Math.PI);
    const arrowHead = new fabric.Triangle({
      width: sw * 4,
      height: sw * 5,
      fill: colour,
      left: end.x,
      top: end.y,
      angle: angle + 90,
      originX: "center",
      originY: "center",
    });
    const line = new fabric.Line([start.x, start.y, end.x, end.y], {
      stroke: colour,
      strokeWidth: sw,
    });
    const group = new fabric.Group([line, arrowHead], { selectable: true });
    return group;
  }

  // ─── Undo ───
  const handleUndo = () => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const objects = canvas.getObjects().filter((o) => o !== bgImageRef.current && !dimRectsRef.current.includes(o as fabric.Rect) && o !== cropRectRef.current);
    if (objects.length === 0) return;
    const last = objects[objects.length - 1];
    canvas.remove(last);
    canvas.renderAll();
  };

  // ─── Clear all ───
  const handleClearAll = () => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const objects = canvas.getObjects().filter((o) => o !== bgImageRef.current && !dimRectsRef.current.includes(o as fabric.Rect) && o !== cropRectRef.current);
    objects.forEach((o) => canvas.remove(o));
    canvas.renderAll();
    setConfirmClear(false);
  };

  // ─── Colour change applies to selected ───
  const applyColourToSelected = (colour: string) => {
    setActiveColour(colour);
    const canvas = fabricRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (active && active !== bgImageRef.current) {
      if (active instanceof fabric.Ellipse) {
        active.set({ stroke: colour });
      } else if (active instanceof fabric.Group) {
        active.getObjects().forEach((child) => {
          if (child instanceof fabric.Line) child.set({ stroke: colour });
          if (child instanceof fabric.Triangle) child.set({ fill: colour });
        });
      }
      canvas.renderAll();
    }
  };

  // ─── Stroke weight change applies to selected ───
  const applyStrokeWeight = (sw: StrokeWeight) => {
    setStrokeWeight(sw);
    const canvas = fabricRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (active && active !== bgImageRef.current) {
      if (active instanceof fabric.Ellipse) {
        active.set({ strokeWidth: sw });
      } else if (active instanceof fabric.Group) {
        active.getObjects().forEach((child) => {
          if (child instanceof fabric.Line) child.set({ strokeWidth: sw });
          if (child instanceof fabric.Triangle) child.set({ width: sw * 4, height: sw * 5 });
        });
      }
      canvas.renderAll();
    }
  };

  // ─── Save ───
  const handleSave = () => {
    const canvas = fabricRef.current;
    const bg = bgImageRef.current;
    if (!canvas || !bg) return;

    // Remove crop overlay objects temporarily
    dimRectsRef.current.forEach((r) => canvas.remove(r));
    if (cropRectRef.current) canvas.remove(cropRectRef.current);

    // Create export canvas
    const exportCanvas = document.createElement("canvas");
    const origW = (bg as any)._element?.naturalWidth || (bg as any)._element?.width || 800;
    const origH = (bg as any)._element?.naturalHeight || (bg as any)._element?.height || 600;

    // Calculate bounds based on bg position in canvas
    const bgLeft = bg.left || 0;
    const bgTop = bg.top || 0;
    const bgScaleX = bg.scaleX || 1;
    const bgScaleY = bg.scaleY || 1;

    // Scale factor from canvas coords to original image pixels
    const scaleFactorX = origW / (origW * bgScaleX);
    const scaleFactorY = origH / (origH * bgScaleY);

    exportCanvas.width = origW;
    exportCanvas.height = origH;
    const ctx = exportCanvas.getContext("2d")!;

    // Apply rotation and flip
    ctx.save();
    ctx.translate(origW / 2, origH / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    if (flipH) ctx.scale(-1, 1);
    if (flipV) ctx.scale(1, -1);
    ctx.drawImage((bg as any)._element, -origW / 2, -origH / 2, origW, origH);
    ctx.restore();

    // Draw annotations scaled to original image size
    const annotations = canvas.getObjects().filter(
      (o) => o !== bg && !dimRectsRef.current.includes(o as fabric.Rect) && o !== cropRectRef.current
    );
    if (annotations.length > 0) {
      // Use fabric's toDataURL for annotations on a temp canvas at the canvas resolution
      // then draw that on top scaled
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = canvas.width!;
      tempCanvas.height = canvas.height!;
      const tempCtx = tempCanvas.getContext("2d")!;

      // Render each annotation
      annotations.forEach((obj) => {
        const objCanvas = (obj as any).toCanvasElement?.();
        if (objCanvas) {
          const objBounds = obj.getBoundingRect();
          tempCtx.drawImage(objCanvas, objBounds.left, objBounds.top, objBounds.width, objBounds.height);
        }
      });

      // Scale annotations from canvas space to image space
      const annotScaleX = origW / (origW * bgScaleX);
      const annotScaleY = origH / (origH * bgScaleY);
      ctx.drawImage(
        tempCanvas,
        bgLeft, bgTop, origW * bgScaleX, origH * bgScaleY,
        0, 0, origW, origH
      );
    }

    // Apply crop if set
    if (cropRect) {
      const cropCanvas = document.createElement("canvas");
      // Convert crop coords from canvas space to image space
      const cx = ((cropRect.x - bgLeft) / bgScaleX);
      const cy = ((cropRect.y - bgTop) / bgScaleY);
      const cw = cropRect.w / bgScaleX;
      const ch = cropRect.h / bgScaleY;
      cropCanvas.width = cw;
      cropCanvas.height = ch;
      const cropCtx = cropCanvas.getContext("2d")!;
      cropCtx.drawImage(exportCanvas, cx, cy, cw, ch, 0, 0, cw, ch);
      onSave(cropCanvas.toDataURL("image/jpeg", 0.92));
    } else {
      onSave(exportCanvas.toDataURL("image/jpeg", 0.92));
    }
  };

  if (!open) return null;

  const swatches = [
    { label: "Brand", hex: brandColour || "#F59E0B" },
    ...COLOUR_SWATCHES,
  ];

  return (
    <div className="fixed inset-0 z-[100] bg-[#111] flex flex-col">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 pt-3 pb-1">
        {(["annotate", "crop", "rotate"] as TabId[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors ${
              tab === t ? "text-white border-b-2" : "text-white/50 hover:text-white/80"
            }`}
            style={tab === t ? { borderColor: brandColour || "#F59E0B" } : {}}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 bg-[#1a1a1a] border-y border-white/10 flex-wrap min-h-[48px]">
        {tab === "annotate" && (
          <>
            <ToolBtn active={tool === "circle"} onClick={() => setTool("circle")} title="Circle">
              <Circle className="w-4 h-4" />
            </ToolBtn>
            <ToolBtn active={tool === "arrow"} onClick={() => setTool("arrow")} title="Arrow">
              <MoveRight className="w-4 h-4" />
            </ToolBtn>
            <ToolBtn active={tool === "select"} onClick={() => setTool("select")} title="Select">
              <MousePointer2 className="w-4 h-4" />
            </ToolBtn>
            <div className="w-px h-6 bg-white/20 mx-1" />
            {/* Colour swatches */}
            {swatches.map((s) => (
              <button
                key={s.hex}
                title={s.label}
                onClick={() => applyColourToSelected(s.hex)}
                className="w-[22px] h-[22px] rounded-full shrink-0 transition-all"
                style={{
                  backgroundColor: s.hex,
                  border: activeColour === s.hex ? "2px solid white" : "2px solid transparent",
                  outline: s.hex === "#FFFFFF" && activeColour !== s.hex ? "1px solid #666" : "none",
                }}
              />
            ))}
            {/* Custom colour */}
            <label
              className="w-[22px] h-[22px] rounded-full shrink-0 cursor-pointer border border-white/40 overflow-hidden"
              style={{ backgroundColor: activeColour }}
              title="Custom colour"
            >
              <input
                type="color"
                value={activeColour}
                onChange={(e) => applyColourToSelected(e.target.value)}
                className="opacity-0 w-0 h-0"
              />
            </label>
            <div className="w-px h-6 bg-white/20 mx-1" />
            {/* Stroke weight */}
            {([2, 3, 5] as StrokeWeight[]).map((sw) => (
              <button
                key={sw}
                onClick={() => applyStrokeWeight(sw)}
                className={`px-2 py-1 text-xs rounded ${
                  strokeWeight === sw ? "bg-white/20 text-white" : "text-white/50 hover:text-white"
                }`}
              >
                {sw === 2 ? "Thin" : sw === 3 ? "Med" : "Thick"}
              </button>
            ))}
            <div className="w-px h-6 bg-white/20 mx-1" />
            <ToolBtn onClick={handleUndo} title="Undo">
              <Undo2 className="w-4 h-4" />
            </ToolBtn>
            {!confirmClear ? (
              <ToolBtn onClick={() => setConfirmClear(true)} title="Clear all">
                <Trash2 className="w-4 h-4" />
              </ToolBtn>
            ) : (
              <span className="text-xs text-white/70">
                Clear all?{" "}
                <button className="text-red-400 underline" onClick={handleClearAll}>Yes</button>{" / "}
                <button className="text-white/60 underline" onClick={() => setConfirmClear(false)}>No</button>
              </span>
            )}
          </>
        )}

        {tab === "crop" && (
          <>
            {ASPECT_RATIOS.map((ar) => (
              <button
                key={ar.label}
                onClick={() => setCropAspect(ar.value)}
                className={`px-3 py-1 text-xs rounded ${
                  cropAspect === ar.value ? "bg-white/20 text-white" : "text-white/50 hover:text-white"
                }`}
              >
                {ar.label}
              </button>
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="text-white/60 hover:text-white text-xs"
              onClick={() => setCropRect(null)}
            >
              Reset Crop
            </Button>
          </>
        )}

        {tab === "rotate" && (
          <>
            <ToolBtn onClick={() => setRotation((r) => (r + 90) % 360)} title="Rotate 90° CW">
              <RotateCw className="w-4 h-4" />
            </ToolBtn>
            <ToolBtn onClick={() => setRotation((r) => (r - 90 + 360) % 360)} title="Rotate 90° CCW">
              <RotateCcw className="w-4 h-4" />
            </ToolBtn>
            <ToolBtn onClick={() => setFlipH((f) => !f)} title="Flip Horizontal" active={flipH}>
              <FlipHorizontal2 className="w-4 h-4" />
            </ToolBtn>
            <ToolBtn onClick={() => setFlipV((f) => !f)} title="Flip Vertical" active={flipV}>
              <FlipVertical2 className="w-4 h-4" />
            </ToolBtn>
            <div className="w-px h-6 bg-white/20 mx-1" />
            <div className="flex items-center gap-2 min-w-[200px]">
              <Slider
                min={-180}
                max={180}
                step={1}
                value={[rotation > 180 ? rotation - 360 : rotation]}
                onValueChange={([v]) => {
                  // Snap to 0 within 2°
                  const snapped = Math.abs(v) <= 2 ? 0 : v;
                  setRotation(snapped < 0 ? snapped + 360 : snapped);
                }}
                className="flex-1"
              />
              <span className="text-xs text-white/60 w-10 text-right">
                {rotation > 180 ? rotation - 360 : rotation}°
              </span>
            </div>
          </>
        )}
      </div>

      {/* Canvas */}
      <div className="flex-1 relative overflow-hidden">
        <canvas ref={canvasRef} />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#1a1a1a] border-t border-white/10">
        <Button variant="ghost" className="text-white/60 hover:text-white" onClick={onClose}>
          Cancel
        </Button>
        <p className="text-xs text-white/40 hidden sm:block">
          Your original photo is always preserved. Re-opening this editor reloads the original.
        </p>
        <Button
          className="bg-amber-500 hover:bg-amber-600 text-white"
          onClick={handleSave}
        >
          Save Image
        </Button>
      </div>
    </div>
  );
}

// ─── Toolbar button ───
function ToolBtn({ children, active, onClick, title }: { children: React.ReactNode; active?: boolean; onClick: () => void; title: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-2 rounded transition-colors ${active ? "bg-white/20 text-white" : "text-white/50 hover:text-white hover:bg-white/10"}`}
    >
      {children}
    </button>
  );
}
