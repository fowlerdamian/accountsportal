import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * PDF image extraction edge function.
 *
 * The full PyMuPDF + OpenCV pipeline requires a Python microservice.
 * This function proxies to that service if PDF_IMAGE_SERVICE_URL is set,
 * otherwise returns a fallback prompting manual image upload.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const serviceUrl = Deno.env.get("PDF_IMAGE_SERVICE_URL");

    if (!serviceUrl) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Image extraction service is not configured",
          fallback: true,
          method: null,
          count: 0,
          images: [],
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Forward the multipart form data to the Python service
    const formData = await req.formData();
    const pdfFile = formData.get("pdf");

    if (!pdfFile || !(pdfFile instanceof File)) {
      return new Response(
        JSON.stringify({ success: false, error: "Body can not be decoded as form data", fallback: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const proxyForm = new FormData();
    proxyForm.append("pdf", pdfFile, "upload.pdf");
    if (formData.get("jobId")) {
      proxyForm.append("jobId", formData.get("jobId") as string);
    }

    const serviceRes = await fetch(`${serviceUrl}/extract`, {
      method: "POST",
      body: proxyForm,
    });

    if (!serviceRes.ok) {
      const errText = await serviceRes.text();
      return new Response(
        JSON.stringify({
          success: false,
          error: `Image service error: ${serviceRes.status}`,
          detail: errText.substring(0, 300),
          fallback: true,
          method: null,
          count: 0,
          images: [],
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await serviceRes.json();
    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        success: false,
        error: err.message ?? "Image extraction failed",
        fallback: true,
        method: null,
        count: 0,
        images: [],
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
