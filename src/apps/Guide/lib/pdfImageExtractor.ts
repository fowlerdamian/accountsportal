/**
 * PDF image extraction.
 *
 * Server-side: Calls the extract-pdf-images Edge Function which proxies to a
 * Fly.io Python microservice running PyMuPDF + OpenCV.
 *   - Path A: Direct embedded image extraction (structured PDFs)
 *   - Path B: OpenCV contour detection for flattened PDFs (Canva, Illustrator)
 *
 * If the service is not configured, returns a fallback result prompting
 * the user to upload images manually.
 */

import { supabase } from "@guide/integrations/supabase/client";

export interface ExtractedImage {
  step: number;
  url: string;
  page: number;
  method: "direct" | "cv2" | "render";
}

export interface ExtractionResult {
  success: boolean;
  method: string | null;
  count: number;
  images: ExtractedImage[];
  error?: string;
  fallback?: boolean;
}

export async function extractImagesFromPdf(
  arrayBuffer: ArrayBuffer,
  jobId?: string
): Promise<ExtractionResult> {
  const id = jobId ?? crypto.randomUUID();

  try {
    // Build multipart form with the PDF file
    const blob = new Blob([arrayBuffer], { type: "application/pdf" });
    const formData = new FormData();
    formData.append("pdf", blob, "upload.pdf");
    formData.append("jobId", id);

    const { data, error } = await supabase.functions.invoke("extract-pdf-images", {
      body: formData,
    });

    if (error) {
      console.error("Edge function error:", error);
      return {
        success: false,
        method: null,
        count: 0,
        images: [],
        error: error.message ?? "Image extraction service unavailable",
        fallback: true,
      };
    }

    // The Edge Function always returns 200 with success/fallback fields
    if (data?.success && data?.images?.length > 0) {
      return {
        success: true,
        method: data.method,
        count: data.count,
        images: data.images,
      };
    }

    return {
      success: false,
      method: null,
      count: 0,
      images: [],
      error: data?.error ?? "No images could be extracted from this PDF",
      fallback: true,
    };
  } catch (err: any) {
    console.error("PDF image extraction failed:", err);
    return {
      success: false,
      method: null,
      count: 0,
      images: [],
      error: err.message ?? "Image extraction failed",
      fallback: true,
    };
  }
}
