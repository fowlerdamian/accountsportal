import { useState, useRef } from "react";
import { Button } from "@guide/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@guide/components/ui/dialog";
import { Checkbox } from "@guide/components/ui/checkbox";
import { Alert, AlertDescription } from "@guide/components/ui/alert";
import { FileText, Loader2, Upload, AlertTriangle, ImageIcon, Tag } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@guide/integrations/supabase/client";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { extractImagesFromPdf, type ExtractionResult } from "@guide/lib/pdfImageExtractor";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export interface ParsedData {
  title?: string;
  product_name?: string;
  vehicle_make?: string;
  vehicle_model?: string;
  vehicle_year?: string;
  product_code?: string;
  short_description?: string;
  tools_required?: string[];
  estimated_time?: string;
  vehicles?: Array<{
    make: string;
    model: string;
    year_from: number;
    year_to: number | null;
  }>;
  steps?: Array<{
    step_number: number;
    subtitle: string;
    description: string;
    has_image?: boolean;
  }>;
}

export interface CategoryMatch {
  matched_category: string | null;
  matched_category_id: string | null;
  confidence: "high" | "medium" | "low";
}

interface PdfImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (data: ParsedData, selected: Record<string, boolean>, extractedImages?: ExtractionResult, categoryMatch?: CategoryMatch) => void;
}

export default function PdfImportDialog({ open, onOpenChange, onApply }: PdfImportDialogProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<"upload" | "processing" | "confirm">("upload");
  const [parsed, setParsed] = useState<ParsedData | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [imageResult, setImageResult] = useState<ExtractionResult | null>(null);
  const [categoryMatch, setCategoryMatch] = useState<CategoryMatch | null>(null);
  const [progressText, setProgressText] = useState("");
  const [deselectedImages, setDeselectedImages] = useState<Set<number>>(new Set());

  const reset = () => {
    setStage("upload");
    setParsed(null);
    setSelected({});
    setError(null);
    setImageResult(null);
    setCategoryMatch(null);
    setProgressText("");
    setDeselectedImages(new Set());
  };

  const handleFile = async (file: File) => {
    if (file.type !== "application/pdf") {
      toast.error("Please select a PDF file");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error("File must be under 20 MB");
      return;
    }

    setStage("processing");
    setError(null);
    setProgressText("Reading PDF…");

    try {
      const arrayBuffer = await file.arrayBuffer();

      // Run text extraction and image extraction in parallel with a global timeout
      const textPromise = extractText(arrayBuffer.slice(0));
      const imagePromise = extractImages(arrayBuffer.slice(0));

      setProgressText("Extracting text and images in parallel…");

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("PDF processing timed out after 2 minutes. Please try a smaller file or try again.")), 120_000)
      );

      const [textResult, imgResult] = await Promise.race([
        Promise.allSettled([textPromise, imagePromise]),
        timeoutPromise.then(() => { throw new Error("timeout"); }),
      ]) as [PromiseSettledResult<ParsedData>, PromiseSettledResult<ExtractionResult>];

      // Handle text result
      if (textResult.status === "fulfilled" && textResult.value) {
        const data = textResult.value;
        setParsed(data);
        const sel: Record<string, boolean> = {};
        if (data.title) sel.title = true;
        if (data.product_code) sel.product_code = true;
        if (data.short_description) sel.short_description = true;
        if (data.estimated_time) sel.estimated_time = true;
        if (data.tools_required?.length) sel.tools_required = true;
        if (data.steps?.length) sel.steps = true;
        if (data.vehicles?.length) sel.vehicles = true;

        // Handle image result
        if (imgResult.status === "fulfilled") {
          const ir = imgResult.value;
          setImageResult(ir);
          if (ir.success && ir.count > 0) {
            sel.images = true;
          }
        }

        setSelected(sel);
        setStage("confirm");

        // Fire category matching in background (non-blocking)
        matchCategory(data.title, data.short_description).then((match) => {
          if (match && match.matched_category && (match.confidence === "high" || match.confidence === "medium")) {
            setCategoryMatch(match);
            setSelected(prev => ({ ...prev, category: true }));
          }
        }).catch(() => { /* silent fail */ });
      } else {
        const errMsg = textResult.status === "rejected"
          ? textResult.reason?.message
          : "Failed to parse PDF text";
        throw new Error(errMsg);
      }
    } catch (err: any) {
      setError(err.message ?? "Failed to process PDF");
      setStage("upload");
      toast.error("PDF processing failed");
    }
  };

  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
  const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

  const invokeFunction = async (name: string, body: any): Promise<any> => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${SUPABASE_ANON}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error ?? `Edge function error ${res.status}`);
    if (data?.error) throw new Error(data.error);
    return data;
  };

  const extractText = async (buffer: ArrayBuffer): Promise<ParsedData> => {
    setProgressText("Extracting text with AI…");
    const visionCopy = buffer.slice(0);
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    let fullText = "";
    for (let i = 1; i <= Math.min(pdf.numPages, 50); i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map((item: any) => item.str).join(" ");
      fullText += `\n--- Page ${i} ---\n${pageText}`;
    }

    const letterCount = (fullText.match(/[a-zA-Z]/g) || []).length;
    const useVision = fullText.trim().length < 200 || letterCount < 80;

    let invokeBody: Record<string, string>;
    if (useVision) {
      const bytes = new Uint8Array(visionCopy);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      invokeBody = { pdfBase64: btoa(binary) };
    } else {
      invokeBody = { text: fullText };
    }

    return invokeFunction("parse-pdf-text", invokeBody);
  };

  const extractImages = async (buffer: ArrayBuffer): Promise<ExtractionResult> => {
    setProgressText((prev) => prev.includes("text") ? "Extracting text and images…" : "Extracting images…");
    return extractImagesFromPdf(buffer);
  };

  const matchCategory = async (title?: string, shortDescription?: string): Promise<CategoryMatch | null> => {
    try {
      // Fetch categories from database
      const { data: categories } = await supabase
        .from("categories")
        .select("id, name");

      if (!categories || categories.length === 0) return null;

      const data = await invokeFunction("match-category", {
        title: title || "",
        short_description: shortDescription || "",
        categories: categories.map(c => ({ id: c.id, name: c.name })),
      }).catch(() => null);

      if (!data) return null;

      // Find the category ID for the matched name
      if (data.matched_category) {
        const matched = categories.find(c => c.name === data.matched_category);
        return {
          matched_category: data.matched_category,
          matched_category_id: matched?.id ?? null,
          confidence: data.confidence,
        };
      }

      return { matched_category: null, matched_category_id: null, confidence: data.confidence };
    } catch {
      return null;
    }
  };

  const toggle = (key: string) => {
    setSelected((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleApply = () => {
    if (!parsed) return;
    // Filter out deselected images
    let filteredImageResult = imageResult ?? undefined;
    if (selected.images && filteredImageResult?.images) {
      const filtered = filteredImageResult.images.filter(img => !deselectedImages.has(img.step));
      filteredImageResult = { ...filteredImageResult, images: filtered, count: filtered.length };
      if (filtered.length === 0) filteredImageResult = undefined;
    }
    onApply(
      parsed,
      selected,
      selected.images ? filteredImageResult : undefined,
      selected.category ? (categoryMatch ?? undefined) : undefined
    );
    onOpenChange(false);
    reset();
    toast.success("PDF data imported!");
  };

  const handleClose = (val: boolean) => {
    if (!val) reset();
    onOpenChange(val);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" /> Import from PDF
          </DialogTitle>
        </DialogHeader>

        {stage === "upload" && (
          <div className="space-y-4">
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = "";
              }}
            />
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const f = e.dataTransfer.files?.[0];
                if (f) handleFile(f);
              }}
              className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
            >
              <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm font-medium">Drop a PDF here or click to browse</p>
              <p className="text-xs text-muted-foreground mt-1">Max 20 MB, up to 50 pages processed</p>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        {stage === "processing" && (
          <div className="flex flex-col items-center py-10 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">{progressText || "Processing PDF…"}</p>
            <p className="text-xs text-muted-foreground">This may take 10–30 seconds</p>
          </div>
        )}

        {stage === "confirm" && parsed && (
          <div className="space-y-3 max-h-[400px] overflow-y-auto">
            <p className="text-sm text-muted-foreground">Select which fields to import:</p>

            {parsed.title && (
              <FieldCheckbox label="Product Title" preview={parsed.title} checked={selected.title} onToggle={() => toggle("title")} />
            )}
            {parsed.product_code && (
              <FieldCheckbox label="Product Code" preview={parsed.product_code} checked={selected.product_code} onToggle={() => toggle("product_code")} />
            )}
            {parsed.short_description && (
              <FieldCheckbox label="Short Description" preview={parsed.short_description} checked={selected.short_description} onToggle={() => toggle("short_description")} lineClamp />
            )}
            {parsed.estimated_time && (
              <FieldCheckbox label="Estimated Time" preview={parsed.estimated_time} checked={selected.estimated_time} onToggle={() => toggle("estimated_time")} />
            )}
            {parsed.tools_required && parsed.tools_required.length > 0 && (
              <FieldCheckbox
                label={`Tools Required (${parsed.tools_required.length})`}
                preview={parsed.tools_required.join(", ")}
                checked={selected.tools_required}
                onToggle={() => toggle("tools_required")}
              />
            )}
            {parsed.steps && parsed.steps.length > 0 && (
              <FieldCheckbox
                label={`Installation Steps (${parsed.steps.length})`}
                preview={parsed.steps.slice(0, 3).map((s) => s.subtitle).join(" → ") + (parsed.steps.length > 3 ? " → …" : "")}
                checked={selected.steps}
                onToggle={() => toggle("steps")}
              />
            )}
            {parsed.vehicles && parsed.vehicles.length > 0 && (
              <FieldCheckbox
                label={`Vehicle Fitment (${parsed.vehicles.length})`}
                preview={parsed.vehicles.map((v) => `${v.make} ${v.model} ${v.year_from}–${v.year_to ?? 'Current'}`).join(", ")}
                checked={selected.vehicles}
                onToggle={() => toggle("vehicles")}
              />
            )}

            {/* Category match result */}
            {categoryMatch && categoryMatch.matched_category && (
              <label className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-muted/50">
                <Checkbox checked={selected.category ?? false} onCheckedChange={() => toggle("category")} className="mt-0.5" />
                <div>
                  <p className="text-sm font-medium flex items-center gap-1.5">
                    <Tag className="w-4 h-4" /> Category
                  </p>
                  <p className="text-xs text-muted-foreground">{categoryMatch.matched_category}</p>
                </div>
              </label>
            )}

            {/* Image extraction result */}
            {imageResult && imageResult.success && imageResult.count > 0 && (
              <div className="p-3 border rounded-lg space-y-2">
                <label className="flex items-start gap-3 cursor-pointer hover:bg-muted/50 rounded p-1 -m-1">
                  <Checkbox checked={selected.images ?? false} onCheckedChange={() => toggle("images")} className="mt-0.5" />
                  <p className="text-sm font-medium flex items-center gap-1.5">
                    <ImageIcon className="w-4 h-4" /> Extracted Images ({imageResult.count - deselectedImages.size} of {imageResult.count} selected)
                  </p>
                </label>
                {selected.images && (
                  <div className="flex gap-2 flex-wrap ml-7">
                    {imageResult.images.map((img) => {
                      const excluded = deselectedImages.has(img.step);
                      return (
                        <button
                          key={img.step}
                          type="button"
                          onClick={() => {
                            setDeselectedImages(prev => {
                              const next = new Set(prev);
                              if (next.has(img.step)) next.delete(img.step); else next.add(img.step);
                              return next;
                            });
                          }}
                          className={`relative group rounded border overflow-hidden transition-opacity ${excluded ? 'opacity-40 border-destructive/50' : 'border-border'}`}
                          title={excluded ? `Include Step ${img.step} image` : `Exclude Step ${img.step} image`}
                        >
                          <img src={img.url} alt={`Step ${img.step}`} className="w-16 h-16 object-cover" />
                          <span className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[10px] text-center py-0.5">
                            Step {img.step}
                          </span>
                          {excluded && (
                            <span className="absolute inset-0 flex items-center justify-center bg-black/30 text-white text-lg font-bold">✕</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
                <p className="text-xs text-muted-foreground ml-7">
                  Click an image to exclude it from import
                </p>
              </div>
            )}

            {imageResult && imageResult.fallback && (
              <Alert className="border-warning/30 bg-warning/5">
                <AlertTriangle className="w-4 h-4 text-warning" />
                <AlertDescription className="text-xs">
                  {imageResult.error?.includes("not configured")
                    ? "Image extraction service is not yet configured. Your step text has been imported — please upload photos for each step manually using the image upload zone on each step card."
                    : "Images couldn't be extracted automatically. Your step text has been imported — please upload photos for each step manually using the image upload zone on each step card."}
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {stage === "confirm" && (
          <DialogFooter>
            <Button variant="outline" onClick={reset}>Cancel</Button>
            <Button onClick={handleApply} disabled={!Object.values(selected).some(Boolean)}>
              Apply Selected
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Small sub-component for field checkboxes
function FieldCheckbox({ label, preview, checked, onToggle, lineClamp }: {
  label: string;
  preview: string;
  checked?: boolean;
  onToggle: () => void;
  lineClamp?: boolean;
}) {
  return (
    <label className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-muted/50">
      <Checkbox checked={checked ?? false} onCheckedChange={onToggle} className="mt-0.5" />
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className={`text-xs text-muted-foreground ${lineClamp ? "line-clamp-2" : "truncate"}`}>{preview}</p>
      </div>
    </label>
  );
}
