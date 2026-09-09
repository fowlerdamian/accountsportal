import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@guide/components/ui/button";
import { Badge } from "@guide/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@guide/components/ui/tabs";
import { useInstructionSet, usePublications, useBrands } from "@guide/hooks/use-supabase-query";
import { ChevronDown, ChevronLeft, Copy, Download, ExternalLink, Loader2, Maximize2, Printer, X } from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import { useState, useRef, useCallback } from "react";
import { supabase } from "@guide/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LABEL_LOGOS, NO_LOGO, buildDymoLabelXml, dymoLabelFileContents, escapeXml, fetchLogoAsPngBase64, labelLogoName, labelLogoUrl, resolveLabelLogoKey } from "@guide/lib/dymoLabel";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@guide/components/ui/dropdown-menu";
import { printLabels } from "@portal/lib/labels/printLabels";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@guide/components/ui/alert-dialog";

export default function GuideShare() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: guide, isLoading } = useInstructionSet(id);
  const { data: publications = [] } = usePublications(id);
  const { data: brands = [] } = useBrands();
  const [copied, setCopied] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState<string | null>(null);
  // Logo chosen for the DYMO label, per brand tab (defaults to the brand's configured label logo).
  const [labelLogo, setLabelLogo] = useState<Record<string, string>>({});
  // Brand whose publication is pending a "revert to draft" confirmation.
  const [revertTarget, setRevertTarget] = useState<{ pubId: string; brandName: string } | null>(null);
  const [reverting, setReverting] = useState(false);
  // Brand key whose label is currently in the browser print flow.
  const [printing, setPrinting] = useState<string | null>(null);
  const qrRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const queryClient = useQueryClient();

  const setQrRef = useCallback((key: string) => (el: HTMLDivElement | null) => {
    qrRefs.current[key] = el;
  }, []);

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }
  if (!guide) return <div className="p-8 text-center text-muted-foreground">Guide not found</div>;

  const copyUrl = async (url: string, key: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch (err: any) {
      toast.error("Couldn't copy link", { description: err?.message ?? url });
    }
  };

  const downloadQRPng = (brandKey: string) => {
    const wrapper = qrRefs.current[brandKey];
    const canvas = wrapper?.querySelector('canvas');
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `${guide.product_code}-${brandKey}-qr.png`;
    a.click();
  };

  const downloadQRPdf = (brandKey: string, brandName: string, guideUrl: string) => {
    const wrapper = qrRefs.current[brandKey];
    const canvas = wrapper?.querySelector('canvas');
    if (!canvas) return;
    const qrDataUrl = canvas.toDataURL('image/png');
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`<!DOCTYPE html><html><head><title>QR - ${escapeXml(guide.title)}</title>
      <style>@page{size:A6 landscape;margin:10mm}body{font-family:Arial;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0}img{width:200px}h2{font-size:14px;margin:12px 0 4px}p{font-size:11px;color:#666;margin:2px 0}</style>
      </head><body><img src="${qrDataUrl}"/><h2>${escapeXml(guide.title)}</h2><p>${escapeXml(guide.product_code)}</p><p>${escapeXml(brandName)}</p><p style="font-size:9px;color:#999;margin-top:8px">${guideUrl}</p>
       <script>setTimeout(()=>{window.print();window.close()},500)</script></body></html>`);
  };

  const downloadDymoLabel = async (
    brand: { key: string; dymo_label_size?: string | null; label_logo?: string | null },
    guideUrl: string,
  ) => {
    try {
      const logoUrl = labelLogoUrl(resolveLabelLogoKey(labelLogo[brand.key] ?? brand.label_logo));
      // Re-encode the logo as PNG through a canvas so any source format works in DYMO Connect.
      const logoBase64 = logoUrl ? await fetchLogoAsPngBase64(logoUrl) : null;
      if (logoUrl && !logoBase64) toast.warning("Logo couldn't be loaded — label generated without it");
      const xml = buildDymoLabelXml({
        size: brand.dymo_label_size,
        url: guideUrl,
        productCode: guide.product_code || guide.slug,
        title: guide.title,
        logoBase64,
      });
      const blob = new Blob([dymoLabelFileContents(xml)], { type: "application/octet-stream" });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `${guide.product_code || guide.slug}-${brand.key}.dymo`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (err: any) {
      toast.error("Couldn't build the DYMO label", { description: err?.message });
    }
  };

  // Print straight to the LabelWriter queue through the browser print pipeline
  // (hidden iframe on /labels/print) — no DYMO Connect needed.
  const printLabel = async (brand: { key: string }) => {
    if (!id) return;
    setPrinting(brand.key);
    try {
      await printLabels({ ids: [id], brand: brand.key, logo: resolveLabelLogoKey(labelLogo[brand.key] ?? (brand as any).label_logo) });
    } catch (err: any) {
      toast.error("Couldn't print the label", { description: err?.message });
    } finally {
      setPrinting(null);
    }
  };

  const publishToBrand = async (brandId: string) => {
    if (!id) return;
    const pub = publications.find((p: any) => p.brand_id === brandId);
    try {
      // supabase-js resolves with { error } rather than throwing — check it.
      const { error } = pub
        ? await supabase.from("guide_publications").update({ status: 'published', published_at: new Date().toISOString() }).eq("id", pub.id)
        : await supabase.from("guide_publications").insert({ instruction_set_id: id, brand_id: brandId, status: 'published', published_at: new Date().toISOString() });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["publications"] });
      toast.success("Published!");
    } catch (err: any) { toast.error(err.message ?? "Publish failed"); }
  };

  const revertToDraft = async () => {
    if (!revertTarget) return;
    setReverting(true);
    try {
      const { error } = await supabase.from("guide_publications").update({ status: 'draft', published_at: null }).eq("id", revertTarget.pubId);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["publications"] });
      toast.success(`Reverted ${revertTarget.brandName} to draft`);
      setRevertTarget(null);
    } catch (err: any) {
      toast.error(err.message ?? "Revert failed");
    } finally {
      setReverting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
      <Button variant="ghost" size="sm" onClick={() => navigate('/guide')} className="mb-2">
        <ChevronLeft className="w-4 h-4 mr-1" /> Back to Guides
      </Button>
      <div>
        <h1 className="text-2xl font-bold">Share & QR Codes</h1>
        <p className="text-muted-foreground text-sm">{guide.title} — {guide.product_code}</p>
      </div>

      {brands.length > 0 && (
        <Tabs defaultValue={brands[0]?.key}>
          <TabsList className="w-full">
            {brands.map(b => (
              <TabsTrigger key={b.key} value={b.key} className="flex-1">{b.name}</TabsTrigger>
            ))}
          </TabsList>
          {brands.map(brand => {
            const pub = publications.find((p: any) => p.brand_id === brand.id);
            const url = `https://${brand.domain}/${guide.slug}`;
            const isPublished = pub?.status === 'published';
            const currentLogo = resolveLabelLogoKey(labelLogo[brand.key] ?? (brand as any).label_logo);
            return (
              <TabsContent key={brand.key} value={brand.key} className="space-y-6">
                <div className="bg-card rounded-lg border p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="font-semibold">{brand.name}</h2>
                    {isPublished ? (
                      <Badge className="bg-success text-success-foreground">Published {pub?.published_at ? `— ${new Date(pub.published_at).toLocaleDateString()}` : ''}</Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">Not Published</Badge>
                    )}
                  </div>
                  {isPublished ? (
                    <>
                      <div className="flex items-center gap-2 p-3 bg-muted rounded-lg mb-6">
                        <code className="text-sm flex-1 truncate">{url}</code>
                        <Button variant="ghost" size="sm" onClick={() => copyUrl(url, brand.key)}>
                          {copied === brand.key ? <span className="text-success text-xs">Copied!</span> : <Copy className="w-4 h-4" />}
                        </Button>
                        <Button variant="ghost" size="sm" asChild>
                          <a href={url} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-4 h-4" /></a>
                        </Button>
                      </div>
                      <div className="flex flex-col items-center gap-4">
                        <div className="p-6 bg-white border rounded-none aspect-square flex items-center justify-center">
                          <div ref={setQrRef(brand.key)}>
                            <QRCodeCanvas value={url} size={200} fgColor="#000000" level="M" />
                          </div>
                        </div>
                        <div className="flex gap-2 flex-wrap justify-center">
                          <Button variant="outline" size="sm" onClick={() => downloadQRPng(brand.key)}><Download className="w-4 h-4 mr-2" /> PNG</Button>
                          <Button variant="outline" size="sm" onClick={() => downloadQRPdf(brand.key, brand.name, url)}><Download className="w-4 h-4 mr-2" /> Print PDF</Button>
                          <div className="flex items-center">
                            <Button variant="outline" size="sm" onClick={() => printLabel(brand)} disabled={printing === brand.key}>
                              {printing === brand.key ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Printer className="w-4 h-4 mr-2" />} Print label
                            </Button>
                            <Button variant="outline" size="sm" className="ml-2" onClick={() => downloadDymoLabel(brand, url)}><Download className="w-4 h-4 mr-2" /> .dymo</Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="ml-1 px-2 text-xs text-muted-foreground" aria-label="Label logo">
                                  {labelLogoName(currentLogo)} <ChevronDown className="w-3 h-3 ml-1" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="start">
                                <DropdownMenuRadioGroup value={currentLogo} onValueChange={(v) => setLabelLogo(prev => ({ ...prev, [brand.key]: v }))}>
                                  {LABEL_LOGOS.map(l => <DropdownMenuRadioItem key={l.key} value={l.key}>{l.name}</DropdownMenuRadioItem>)}
                                  <DropdownMenuRadioItem value={NO_LOGO}>No logo</DropdownMenuRadioItem>
                                </DropdownMenuRadioGroup>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                          <Button variant="outline" size="sm" onClick={() => setFullscreen(brand.key)}><Maximize2 className="w-4 h-4 mr-2" /> Fullscreen</Button>
                        </div>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="mt-2"
                          onClick={() => { if (pub) setRevertTarget({ pubId: pub.id, brandName: brand.name }); }}
                        >
                          Revert to Draft
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-12 text-muted-foreground">
                      <p className="text-sm">Publish this guide to {brand.name} to generate a QR code.</p>
                      <Button className="mt-4" onClick={() => publishToBrand(brand.id)}>Publish to {brand.name}</Button>
                    </div>
                  )}
                </div>
              </TabsContent>
            );
          })}
        </Tabs>
      )}

      <AlertDialog open={!!revertTarget} onOpenChange={(v) => { if (!v && !reverting) setRevertTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revert {revertTarget?.brandName} to draft?</AlertDialogTitle>
            <AlertDialogDescription>
              This takes the guide offline on {revertTarget?.brandName}. Any QR codes or links already printed or shared for this brand will stop working until it is published again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reverting}>Cancel</AlertDialogCancel>
            {/* preventDefault keeps the dialog open until the update has actually succeeded */}
            <AlertDialogAction disabled={reverting} onClick={(e) => { e.preventDefault(); revertToDraft(); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {reverting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Revert to Draft"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {fullscreen && (
        <div className="fixed inset-0 z-50 bg-background/95 flex items-center justify-center" onClick={() => setFullscreen(null)}>
          <button className="absolute top-4 right-4 p-2" onClick={() => setFullscreen(null)}><X className="w-6 h-6" /></button>
          <div className="text-center space-y-4">
            <QRCodeCanvas value={`https://${brands.find(b => b.key === fullscreen)?.domain}/${guide.slug}`} size={400} fgColor="#000000" level="M" />
            <p className="text-sm text-muted-foreground">{guide.title}</p>
          </div>
        </div>
      )}
    </div>
  );
}
