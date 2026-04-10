import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@guide/components/ui/button";
import { Badge } from "@guide/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@guide/components/ui/tabs";
import { useInstructionSet, usePublications, useBrands } from "@guide/hooks/use-supabase-query";
import { ChevronLeft, Copy, Download, ExternalLink, Loader2, Maximize2, Printer, X } from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import { useState, useRef, useCallback } from "react";
import { supabase } from "@guide/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export default function GuideShare() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: guide, isLoading } = useInstructionSet(id);
  const { data: publications = [] } = usePublications(id);
  const { data: brands = [] } = useBrands();
  const [copied, setCopied] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState<string | null>(null);
  const qrRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const queryClient = useQueryClient();

  const setQrRef = useCallback((key: string) => (el: HTMLDivElement | null) => {
    qrRefs.current[key] = el;
  }, []);

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }
  if (!guide) return <div className="p-8 text-center text-muted-foreground">Guide not found</div>;

  const copyUrl = (url: string, key: string) => {
    navigator.clipboard.writeText(url);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
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
    printWindow.document.write(`<!DOCTYPE html><html><head><title>QR - ${guide.title}</title>
      <style>@page{size:A6 landscape;margin:10mm}body{font-family:Arial;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0}img{width:200px}h2{font-size:14px;margin:12px 0 4px}p{font-size:11px;color:#666;margin:2px 0}</style>
      </head><body><img src="${qrDataUrl}"/><h2>${guide.title}</h2><p>${guide.product_code}</p><p>${brandName}</p><p style="font-size:9px;color:#999;margin-top:8px">${guideUrl}</p>
       <script>setTimeout(()=>{window.print();window.close()},500)</script></body></html>`);
  };

  const escapeXml = (value: string) => value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");

  const fetchImageAsBase64 = async (url: string): Promise<string | null> => {
    try {
      const resp = await fetch(url);
      if (!resp.ok) return null;
      const blob = await resp.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          const base64 = result.split(',')[1] || '';
          resolve(base64);
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  };

  const getQrBase64 = (brandKey: string): string | null => {
    const wrapper = qrRefs.current[brandKey];
    const canvas = wrapper?.querySelector('canvas');
    if (!canvas) return null;
    const dataUrl = canvas.toDataURL('image/png');
    return dataUrl.split(',')[1] || null;
  };

  const downloadDymoLabel = async (_brandKey: string, brand: any, guideUrl: string) => {
    const qrBase64 = getQrBase64(_brandKey);
    if (!qrBase64) {
      toast.error("QR code not ready — try again");
      return;
    }

    const logoBase64 = brand.logo_url ? await fetchImageAsBase64(brand.logo_url) : null;
    const productCode = escapeXml(guide.product_code || '');
    const productTitle = escapeXml((guide.title || '').slice(0, 50));

    const logoBlock = logoBase64 ? `
    <ImageObject>
      <n>IImageObject0</n>
      <Brushes>
        <BackgroundBrush>
          <SolidColorBrush>
            <Color A="0" R="0" G="0" B="0"></Color>
          </SolidColorBrush>
        </BackgroundBrush>
        <BorderBrush>
          <SolidColorBrush>
            <Color A="1" R="0" G="0" B="0"></Color>
          </SolidColorBrush>
        </BorderBrush>
        <StrokeBrush>
          <SolidColorBrush>
            <Color A="1" R="0" G="0" B="0"></Color>
          </SolidColorBrush>
        </StrokeBrush>
        <FillBrush>
          <SolidColorBrush>
            <Color A="0" R="0" G="0" B="0"></Color>
          </SolidColorBrush>
        </FillBrush>
      </Brushes>
      <Rotation>Rotation0</Rotation>
      <OutlineThickness>1</OutlineThickness>
      <IsOutlined>False</IsOutlined>
      <BorderStyle>SolidLine</BorderStyle>
      <Margin>
        <DYMOThickness Left="0" Top="0" Right="0" Bottom="0" />
      </Margin>
      <Data>${logoBase64}</Data>
      <ScaleMode>Uniform</ScaleMode>
      <HorizontalAlignment>Center</HorizontalAlignment>
      <VerticalAlignment>Middle</VerticalAlignment>
      <ObjectLayout>
        <DYMOPoint>
          <X>0.23</X>
          <Y>0.06</Y>
        </DYMOPoint>
        <Size>
          <Width>1</Width>
          <Height>0.4</Height>
        </Size>
      </ObjectLayout>
    </ImageObject>` : '';

    const xml = `<?xml version="1.0" encoding="utf-8"?>
<DesktopLabel Version="1">
  <DYMOLabel Version="4">
    <Description>DYMO Label</Description>
    <Orientation>Landscape</Orientation>
    <LabelName>LargeAddressS0722400</LabelName>
    <InitialLength>0</InitialLength>
    <BorderStyle>SolidLine</BorderStyle>
    <DYMORect>
      <DYMOPoint>
        <X>0.23</X>
        <Y>0.06</Y>
      </DYMOPoint>
      <Size>
        <Width>3.21</Width>
        <Height>1.29</Height>
      </Size>
    </DYMORect>
    <BorderColor>
      <SolidColorBrush>
        <Color A="1" R="0" G="0" B="0"></Color>
      </SolidColorBrush>
    </BorderColor>
    <BorderThickness>1</BorderThickness>
    <Show_Border>False</Show_Border>
    <HasFixedLength>False</HasFixedLength>
    <FixedLengthValue>0</FixedLengthValue>
    <DynamicLayoutManager>
      <RotationBehavior>ClearObjects</RotationBehavior>
      <LabelObjects>
    <TextObject>
      <n>ITextObject2</n>
      <Brushes>
        <BackgroundBrush>
          <SolidColorBrush>
            <Color A="0" R="0" G="0" B="0"></Color>
          </SolidColorBrush>
        </BackgroundBrush>
        <BorderBrush>
          <SolidColorBrush>
            <Color A="1" R="0" G="0" B="0"></Color>
          </SolidColorBrush>
        </BorderBrush>
        <StrokeBrush>
          <SolidColorBrush>
            <Color A="1" R="0" G="0" B="0"></Color>
          </SolidColorBrush>
        </StrokeBrush>
        <FillBrush>
          <SolidColorBrush>
            <Color A="0" R="0" G="0" B="0"></Color>
          </SolidColorBrush>
        </FillBrush>
      </Brushes>
      <Rotation>Rotation0</Rotation>
      <OutlineThickness>1</OutlineThickness>
      <IsOutlined>False</IsOutlined>
      <BorderStyle>SolidLine</BorderStyle>
      <Margin>
        <DYMOThickness Left="0" Top="0" Right="0" Bottom="0" />
      </Margin>
      <HorizontalAlignment>Right</HorizontalAlignment>
      <VerticalAlignment>Middle</VerticalAlignment>
      <FitMode>AlwaysFit</FitMode>
      <IsVertical>False</IsVertical>
      <FormattedText>
        <FitMode>AlwaysFit</FitMode>
        <HorizontalAlignment>Right</HorizontalAlignment>
        <VerticalAlignment>Middle</VerticalAlignment>
        <IsVertical>False</IsVertical>
        <LineTextSpan>
          <TextSpan>
            <Text>SCAN HERE FOR\r\nINSTRUCTIONS</Text>
            <FontInfo>
              <FontName>Arial</FontName>
              <FontSize>14</FontSize>
              <IsBold>True</IsBold>
              <IsItalic>False</IsItalic>
              <IsUnderline>False</IsUnderline>
              <FontBrush>
                <SolidColorBrush>
                  <Color A="1" R="0" G="0" B="0"></Color>
                </SolidColorBrush>
              </FontBrush>
            </FontInfo>
          </TextSpan>
        </LineTextSpan>
      </FormattedText>
      <ObjectLayout>
        <DYMOPoint>
          <X>0.23</X>
          <Y>0.06</Y>
        </DYMOPoint>
        <Size>
          <Width>1.58</Width>
          <Height>0.54</Height>
        </Size>
      </ObjectLayout>
    </TextObject>
    <TextObject>
      <n>TextObject1</n>
      <Brushes>
        <BackgroundBrush>
          <SolidColorBrush>
            <Color A="0" R="0" G="0" B="0"></Color>
          </SolidColorBrush>
        </BackgroundBrush>
        <BorderBrush>
          <SolidColorBrush>
            <Color A="1" R="0" G="0" B="0"></Color>
          </SolidColorBrush>
        </BorderBrush>
        <StrokeBrush>
          <SolidColorBrush>
            <Color A="1" R="0" G="0" B="0"></Color>
          </SolidColorBrush>
        </StrokeBrush>
        <FillBrush>
          <SolidColorBrush>
            <Color A="0" R="0" G="0" B="0"></Color>
          </SolidColorBrush>
        </FillBrush>
      </Brushes>
      <Rotation>Rotation0</Rotation>
      <OutlineThickness>1</OutlineThickness>
      <IsOutlined>False</IsOutlined>
      <BorderStyle>SolidLine</BorderStyle>
      <Margin>
        <DYMOThickness Left="0" Top="0" Right="0" Bottom="0" />
      </Margin>
      <HorizontalAlignment>Right</HorizontalAlignment>
      <VerticalAlignment>Middle</VerticalAlignment>
      <FitMode>AlwaysFit</FitMode>
      <IsVertical>False</IsVertical>
      <FormattedText>
        <FitMode>AlwaysFit</FitMode>
        <HorizontalAlignment>Right</HorizontalAlignment>
        <VerticalAlignment>Middle</VerticalAlignment>
        <IsVertical>False</IsVertical>
        <LineTextSpan>
          <TextSpan>
            <Text>${productCode}</Text>
            <FontInfo>
              <FontName>Courier New</FontName>
              <FontSize>8</FontSize>
              <IsBold>False</IsBold>
              <IsItalic>False</IsItalic>
              <IsUnderline>False</IsUnderline>
              <FontBrush>
                <SolidColorBrush>
                  <Color A="1" R="0" G="0" B="0"></Color>
                </SolidColorBrush>
              </FontBrush>
            </FontInfo>
          </TextSpan>
        </LineTextSpan>
      </FormattedText>
      <ObjectLayout>
        <DYMOPoint>
          <X>0.22333345</X>
          <Y>0.9266666</Y>
        </DYMOPoint>
        <Size>
          <Width>1.58</Width>
          <Height>0.4</Height>
        </Size>
      </ObjectLayout>
    </TextObject>${logoBlock}
    <QRCodeObject>
      <n>QRCodeObject0</n>
      <Brushes>
        <BackgroundBrush>
          <SolidColorBrush>
            <Color A="1" R="1" G="1" B="1"></Color>
          </SolidColorBrush>
        </BackgroundBrush>
        <BorderBrush>
          <SolidColorBrush>
            <Color A="1" R="0" G="0" B="0"></Color>
          </SolidColorBrush>
        </BorderBrush>
        <StrokeBrush>
          <SolidColorBrush>
            <Color A="1" R="0" G="0" B="0"></Color>
          </SolidColorBrush>
        </StrokeBrush>
        <FillBrush>
          <SolidColorBrush>
            <Color A="1" R="0" G="0" B="0"></Color>
          </SolidColorBrush>
        </FillBrush>
      </Brushes>
      <Rotation>Rotation0</Rotation>
      <OutlineThickness>1</OutlineThickness>
      <IsOutlined>False</IsOutlined>
      <BorderStyle>SolidLine</BorderStyle>
      <Margin>
        <DYMOThickness Left="0" Top="0" Right="0" Bottom="0" />
      </Margin>
      <ErrorCorrectionLevel>Medium</ErrorCorrectionLevel>
      <DataString>URL:${escapeXml(guideUrl)}</DataString>
      <EQRCodeType>QRCodeWebPage</EQRCodeType>
      <WebAddressDataHolder>
        <MultiDataString>
          <DataString></DataString>
          <DataString></DataString>
          <DataString></DataString>
          <DataString></DataString>
          <DataString>${escapeXml(guideUrl)}</DataString>
        </MultiDataString>
      </WebAddressDataHolder>
      <ObjectLayout>
        <DYMOPoint>
          <X>1.97</X>
          <Y>0.06</Y>
        </DYMOPoint>
        <Size>
          <Width>1.47</Width>
          <Height>1.29</Height>
        </Size>
      </ObjectLayout>
    </QRCodeObject>
      </LabelObjects>
    </DynamicLayoutManager>
  </DYMOLabel>
  <LabelApplication>Blank</LabelApplication>
  <DataTable>
    <Columns></Columns>
    <Rows></Rows>
  </DataTable>
</DesktopLabel>`;

    const blob = new Blob([('\uFEFF' + xml).replace(/\n/g, '\r\n')], { type: 'application/octet-stream' });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `${guide.product_code}.dymo`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  };

  const publishToBrand = async (brandId: string) => {
    if (!id) return;
    const pub = publications.find((p: any) => p.brand_id === brandId);
    try {
      if (pub) {
        await supabase.from("guide_publications").update({ status: 'published', published_at: new Date().toISOString() }).eq("id", pub.id);
      } else {
        await supabase.from("guide_publications").insert({ instruction_set_id: id, brand_id: brandId, status: 'published', published_at: new Date().toISOString() });
      }
      queryClient.invalidateQueries({ queryKey: ["publications"] });
      toast.success("Published!");
    } catch (err: any) { toast.error(err.message); }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
      <Button variant="ghost" size="sm" onClick={() => navigate('/guide/guides')} className="mb-2">
        <ChevronLeft className="w-4 h-4 mr-1" /> Back to Guides
      </Button>
      <div>
        <h1 className="text-2xl font-bold">Share & QR Codes</h1>
        <p className="text-muted-foreground text-sm">{guide.title} — {guide.product_code}</p>
      </div>

      {brands.length > 0 && (
        <Tabs defaultValue={brands.find(b => b.key === 'trailbait')?.key || brands[0]?.key}>
          <TabsList className="w-full">
            {brands.map(b => (
              <TabsTrigger key={b.key} value={b.key} className="flex-1">{b.name}</TabsTrigger>
            ))}
          </TabsList>
          {brands.map(brand => {
            const pub = publications.find((p: any) => p.brand_id === brand.id);
            const url = `https://${brand.domain}/guide/view/${guide.slug}`;
            const isPublished = pub?.status === 'published';
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
                          <Button variant="outline" size="sm" onClick={() => downloadDymoLabel(brand.key, brand, url)}><Printer className="w-4 h-4 mr-2" /> Download .dymo</Button>
                          <Button variant="outline" size="sm" onClick={() => setFullscreen(brand.key)}><Maximize2 className="w-4 h-4 mr-2" /> Fullscreen</Button>
                        </div>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="mt-2"
                          onClick={async () => {
                            if (!pub) return;
                            try {
                              await supabase.from("guide_publications").update({ status: 'draft', published_at: null }).eq("id", pub.id);
                              queryClient.invalidateQueries({ queryKey: ["publications"] });
                              toast.success(`Reverted ${brand.name} to draft`);
                            } catch (err: any) {
                              toast.error(err.message);
                            }
                          }}
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

      {fullscreen && (
        <div className="fixed inset-0 z-50 bg-background/95 flex items-center justify-center" onClick={() => setFullscreen(null)}>
          <button className="absolute top-4 right-4 p-2" onClick={() => setFullscreen(null)}><X className="w-6 h-6" /></button>
          <div className="text-center space-y-4">
            <QRCodeCanvas value={`https://${brands.find(b => b.key === fullscreen)?.domain}/guide/view/${guide.slug}`} size={400} fgColor="#000000" level="M" />
            <p className="text-sm text-muted-foreground">{guide.title}</p>
          </div>
        </div>
      )}
    </div>
  );
}
