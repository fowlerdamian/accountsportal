import { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@guide/components/ui/button";
import { Input } from "@guide/components/ui/input";
import { Label } from "@guide/components/ui/label";
import { Textarea } from "@guide/components/ui/textarea";
import { Badge } from "@guide/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@guide/components/ui/select";
import { useCategories, useInstructionSet, useInstructionSteps, usePublications, useBrands, useGuideVehicles } from "@guide/hooks/use-supabase-query";
import type { GuideVehicle } from "@guide/hooks/use-supabase-query";
import { supabase } from "@guide/integrations/supabase/client";
import { Check, ChevronLeft, ChevronRight, FileText, GripVertical, ImagePlus, Loader2, Pencil, Plus, Save, Trash2, Upload, X, Car } from "lucide-react";
import { DndContext, closestCenter, DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import PdfImportDialog from "@guide/components/admin/PdfImportDialog";
import ImageEditorModal from "@guide/components/admin/ImageEditorModal";
import type { ExtractionResult } from "@guide/lib/pdfImageExtractor";
import type { CategoryMatch } from "@guide/components/admin/PdfImportDialog";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

const wizardSteps = ["Product Details", "Tools Required", "Installation Steps", "Variants", "Review & Publish"];

interface StepDraft {
  id?: string;
  step_number: number;
  subtitle: string;
  description: string;
  order_index: number;
  image_url?: string | null;
  image_original_url?: string | null;
  image2_url?: string | null;
  image2_original_url?: string | null;
}

// --- Upload helpers ---
async function uploadToStorage(file: File, folder: string): Promise<string> {
  const ext = file.name.split('.').pop() || 'jpg';
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('guide-images').upload(path, file, { upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from('guide-images').getPublicUrl(path);
  return data.publicUrl;
}

// Module-level drag payload — avoids dataTransfer.getData limitations in dragover.
// Safe since only one drag happens at a time.
interface ImageDragPayload {
  url: string;
  originalUrl: string | null;
}
let _activeImageDrag: ImageDragPayload | null = null;

interface DropZoneProps {
  label: string;
  currentUrl?: string | null;
  onUpload: (url: string) => void;
  onClear?: () => void;
  onEdit?: () => void;
  folder: string;
  /** Set when this slot has an image that should be draggable to other slots */
  dragPayload?: ImageDragPayload;
  /** Called when another image slot's image is dropped onto this slot */
  onDropTransfer?: (url: string, originalUrl: string | null) => void;
}

function DropZone({ label, currentUrl, onUpload, onClear, onEdit, folder, dragPayload, onDropTransfer }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error("Only image files are supported");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File must be under 10 MB");
      return;
    }
    setUploading(true);
    try {
      const url = await uploadToStorage(file, folder);
      onUpload(url);
      toast.success("Image uploaded");
    } catch (err: any) {
      toast.error(err.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleTransferDrop = (e: React.DragEvent): boolean => {
    if (!_activeImageDrag || !onDropTransfer) return false;
    e.preventDefault();
    onDropTransfer(_activeImageDrag.url, _activeImageDrag.originalUrl);
    return true;
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    // File drop takes priority
    const file = e.dataTransfer.files?.[0];
    if (file) { handleFile(file); return; }
    // Inter-step image transfer
    handleTransferDrop(e);
  }, [folder, onDropTransfer]);

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  };

  if (currentUrl) {
    return (
      <div
        className={`relative border rounded-lg overflow-hidden group transition-[box-shadow] ${
          dragOver ? 'ring-2 ring-primary' : ''
        }`}
        onDragOver={(e) => {
          if (_activeImageDrag && onDropTransfer) { e.preventDefault(); setDragOver(true); }
          else if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragOver(true); }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) { e.preventDefault(); handleFile(file); return; }
          handleTransferDrop(e);
        }}
      >
        <img
          src={currentUrl}
          alt=""
          className={`w-full h-32 object-cover ${dragPayload ? 'cursor-grab active:cursor-grabbing' : ''}`}
          draggable={!!dragPayload}
          onDragStart={(e) => {
            if (!dragPayload) return;
            _activeImageDrag = dragPayload;
            e.dataTransfer.effectAllowed = 'copy';
          }}
          onDragEnd={() => { _activeImageDrag = null; setDragOver(false); }}
        />
        {dragOver && (
          <div className="absolute inset-0 bg-primary/20 flex items-center justify-center pointer-events-none">
            <Upload className="w-6 h-6 text-primary" />
          </div>
        )}
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="absolute bottom-1 left-1 bg-black/70 text-white rounded px-2 py-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1"
          >
            <Pencil className="w-3 h-3" /> Edit
          </button>
        )}
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    );
  }

  return (
    <>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onChange} />
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors cursor-pointer ${
          dragOver ? 'border-primary bg-primary/5' : 'hover:border-primary/50'
        }`}
      >
        {uploading ? (
          <Loader2 className="w-5 h-5 mx-auto animate-spin text-primary mb-1" />
        ) : (
          <ImagePlus className="w-5 h-5 mx-auto text-muted-foreground mb-1" />
        )}
        <p className="text-xs text-muted-foreground">{uploading ? 'Uploading…' : label}</p>
      </div>
    </>
  );
}

// --- Sortable Step ---
interface SortableStepProps {
  id: string;
  step: StepDraft;
  index: number;
  onUpdate: (index: number, field: string, value: string) => void;
  onUpdateImage: (index: number, field: 'image_url' | 'image2_url', value: string | null) => void;
  onTransferImage: (index: number, field: 'image_url' | 'image2_url', url: string, originalUrl: string | null) => void;
  onOpenEditor: (index: number, field: 'image_url' | 'image2_url') => void;
  onRemove: (index: number) => void;
  canRemove: boolean;
}

function SortableStep({ id, step, index, onUpdate, onUpdateImage, onTransferImage, onOpenEditor, onRemove, canRemove }: SortableStepProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className="border rounded-lg p-3 sm:p-4 space-y-3 group bg-card">
      <div className="flex items-start gap-2 sm:gap-3">
        <div className="flex items-center gap-1 sm:gap-2 pt-1">
          <button type="button" className="cursor-grab active:cursor-grabbing touch-none" {...attributes} {...listeners}>
            <GripVertical className="w-4 h-4 text-muted-foreground" />
          </button>
          <span className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs sm:text-sm font-bold shrink-0">{index + 1}</span>
        </div>
        <div className="flex-1 min-w-0 space-y-3">
          <Input value={step.subtitle} onChange={e => onUpdate(index, 'subtitle', e.target.value)} placeholder="Step subtitle" className="font-medium" />
          <Textarea value={step.description} onChange={e => onUpdate(index, 'description', e.target.value)} placeholder="Describe this step..." rows={3} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <DropZone
              label="Primary image"
              currentUrl={step.image_url}
              dragPayload={step.image_url ? { url: step.image_url, originalUrl: step.image_original_url ?? null } : undefined}
              onDropTransfer={(url, origUrl) => onTransferImage(index, 'image_url', url, origUrl)}
              onUpload={(url) => onUpdateImage(index, 'image_url', url)}
              onClear={() => onUpdateImage(index, 'image_url', null)}
              onEdit={step.image_url ? () => onOpenEditor(index, 'image_url') : undefined}
              folder="steps"
            />
            <DropZone
              label="Add second image"
              currentUrl={step.image2_url}
              dragPayload={step.image2_url ? { url: step.image2_url, originalUrl: step.image2_original_url ?? null } : undefined}
              onDropTransfer={(url, origUrl) => onTransferImage(index, 'image2_url', url, origUrl)}
              onUpload={(url) => onUpdateImage(index, 'image2_url', url)}
              onClear={() => onUpdateImage(index, 'image2_url', null)}
              onEdit={step.image2_url ? () => onOpenEditor(index, 'image2_url') : undefined}
              folder="steps"
            />
          </div>
        </div>
        {canRemove && (
          <Button variant="ghost" size="icon" className="text-destructive sm:opacity-0 sm:group-hover:opacity-100 shrink-0" onClick={() => onRemove(index)}>
            <Trash2 className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

// --- Main editor ---
export default function GuideEditor() {
  const { id: rawId } = useParams();
  const id = rawId === 'new' ? undefined : rawId;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isEditing = !!id;
  const { data: existingGuide, isLoading: loadingGuide } = useInstructionSet(id);
  const { data: existingSteps = [], isLoading: loadingSteps } = useInstructionSteps(id);
  const { data: categories = [] } = useCategories();
  const { data: brands = [] } = useBrands();
  const { data: publications = [] } = usePublications(id);
  const { data: existingVehicles = [], isLoading: loadingVehicles } = useGuideVehicles(id);

  const [currentStep, setCurrentStep] = useState(0);
  const [title, setTitle] = useState("");
  const [productCode, setProductCode] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [estimatedTime, setEstimatedTime] = useState("");
  const [description, setDescription] = useState("");
  const [productImageUrl, setProductImageUrl] = useState<string | null>(null);
  const [tools, setTools] = useState<string[]>([]);
  const [toolInput, setToolInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [pdfImportOpen, setPdfImportOpen] = useState(false);
  const [vehicles, setVehicles] = useState<{ make: string; model: string; year_from: string; year_to: string }[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorTarget, setEditorTarget] = useState<{ stepIndex: number; field: 'image_url' | 'image2_url'; variantId?: string | null } | null>(null);
  const [editorImageUrl, setEditorImageUrl] = useState("");
  const [editorOriginalUrl, setEditorOriginalUrl] = useState<string | null>(null);

  // Variants state
  interface VariantDraft {
    id?: string;
    variant_label: string;
    slug: string;
    steps: StepDraft[];
  }
  const [variants, setVariants] = useState<VariantDraft[]>([]);
  const [editingVariantIdx, setEditingVariantIdx] = useState<number | null>(null);
  const [newVariantLabel, setNewVariantLabel] = useState("");
  const [showAddVariant, setShowAddVariant] = useState(false);

  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleStepDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = guideSteps.findIndex((_, i) => `step-${i}` === active.id);
    const newIndex = guideSteps.findIndex((_, i) => `step-${i}` === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(guideSteps, oldIndex, newIndex).map((s, i) => ({
      ...s, step_number: i + 1, order_index: i + 1,
    }));
    setGuideSteps(reordered);
    toast.success(`Moved step to position ${newIndex + 1}`);
  };

  const handlePdfApply = (data: any, selected: Record<string, boolean>, extractedImages?: ExtractionResult, categoryMatchResult?: CategoryMatch) => {
    if (selected.title && data.title) setTitle(data.title);
    if (selected.product_code && data.product_code) setProductCode(data.product_code);
    if (selected.short_description && data.short_description) setDescription(data.short_description);
    if (selected.estimated_time && data.estimated_time) setEstimatedTime(data.estimated_time);
    if (selected.tools_required && data.tools_required?.length) setTools(data.tools_required);
    if (selected.category && categoryMatchResult?.matched_category_id) {
      setCategoryId(categoryMatchResult.matched_category_id);
    }
    if (selected.vehicles && data.vehicles?.length) {
      setVehicles(data.vehicles.map((v: any) => ({
        make: v.make || '',
        model: v.model || '',
        year_from: String(v.year_from || ''),
        year_to: v.year_to ? String(v.year_to) : '',
      })));
    }
    if (selected.steps && data.steps?.length) {
      const newSteps = data.steps.map((s: any, i: number) => ({
        step_number: i + 1,
        subtitle: s.subtitle || `Step ${i + 1}`,
        description: s.description || '',
        order_index: i + 1,
        // Auto-assign extracted images to matching steps
        image_url: extractedImages?.success && extractedImages.images[i]
          ? extractedImages.images[i].url
          : undefined,
      }));
      setGuideSteps(newSteps);
    } else if (extractedImages?.success && extractedImages.images.length > 0) {
      // If only images were selected (no steps), assign to existing steps
      setGuideSteps(prev => prev.map((step, i) => ({
        ...step,
        image_url: extractedImages.images[i]?.url ?? step.image_url,
      })));
    }
  };

  const [guideSteps, setGuideSteps] = useState<StepDraft[]>([
    { step_number: 1, subtitle: '', description: '', order_index: 1 }
  ]);

  // Initialize form ONLY after ALL queries have finished loading
  useEffect(() => {
    if (!isEditing || initialized) return;
    if (loadingGuide || loadingSteps || loadingVehicles) return;
    if (!existingGuide) return;

    setTitle(existingGuide.title);
    setProductCode(existingGuide.product_code);
    setCategoryId(existingGuide.category_id ?? "");
    setEstimatedTime(existingGuide.estimated_time ?? "");
    setDescription(existingGuide.short_description ?? "");
    setProductImageUrl(existingGuide.product_image_url ?? null);
    setTools(existingGuide.tools_required ?? []);

    if (existingSteps.length > 0) {
      setGuideSteps(existingSteps.map(s => ({
        id: s.id,
        step_number: s.step_number,
        subtitle: s.subtitle,
        description: s.description,
        order_index: s.order_index,
        image_url: s.image_url,
        image_original_url: s.image_original_url,
        image2_url: s.image2_url,
        image2_original_url: s.image2_original_url,
      })));
    }

    if (existingVehicles.length > 0) {
      setVehicles(existingVehicles.map(v => ({
        make: v.make,
        model: v.model,
        year_from: String(v.year_from),
        year_to: String(v.year_to),
      })));
    }

    // Load variants and their steps, then mark initialized
    if (id) {
      supabase.from("guide_variants").select("*").eq("instruction_set_id", id).then(({ data: variantRows }) => {
        if (variantRows && variantRows.length > 0) {
          Promise.all(variantRows.map(async (v: any) => {
            const { data: vSteps } = await supabase.from("instruction_steps")
              .select("*").eq("instruction_set_id", id).eq("variant_id", v.id).order("order_index");
            return {
              id: v.id,
              variant_label: v.variant_label,
              slug: v.slug,
              steps: (vSteps || []).map((s: any) => ({
                id: s.id, step_number: s.step_number, subtitle: s.subtitle,
                description: s.description, order_index: s.order_index,
                image_url: s.image_url, image_original_url: s.image_original_url,
                image2_url: s.image2_url, image2_original_url: s.image2_original_url,
              })),
            } as VariantDraft;
          })).then((variants) => {
            setVariants(variants);
            setInitialized(true);
          });
        } else {
          setInitialized(true);
        }
      });
    } else {
      setInitialized(true);
    }
  }, [isEditing, initialized, loadingGuide, loadingSteps, loadingVehicles, existingGuide, existingSteps, existingVehicles]);

  const generateSlug = () => Array.from(crypto.getRandomValues(new Uint8Array(6))).map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 10);

  const saveDraft = async (): Promise<boolean> => {
    if (!title || !productCode) {
      toast.error("Title and product code are required");
      return false;
    }
    setSaving(true);
    try {
      const slug = id ? (existingGuide as any)?.slug || generateSlug() : generateSlug();
      const guideData = {
        title,
        product_code: productCode,
        slug,
        category_id: categoryId || null,
        estimated_time: estimatedTime || null,
        short_description: description || null,
        tools_required: tools,
        product_image_url: productImageUrl,
      };

      let guideId = id;

      if (isEditing && id) {
        const { error } = await supabase.from("instruction_sets").update(guideData).eq("id", id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("instruction_sets").insert(guideData).select().single();
        if (error) throw error;
        guideId = data.id;
      }

      // Save steps
      if (guideId) {
        if (isEditing) {
          await supabase.from("instruction_steps").delete().eq("instruction_set_id", guideId);
        }
        const stepsToInsert = guideSteps
          .filter(s => s.subtitle || s.description)
          .map((s, i) => ({
            instruction_set_id: guideId!,
            step_number: i + 1,
            subtitle: s.subtitle || `Step ${i + 1}`,
            description: s.description || '',
            order_index: i + 1,
            image_url: s.image_url || null,
            image_original_url: s.image_original_url || null,
            image2_url: s.image2_url || null,
            image2_original_url: s.image2_original_url || null,
          }));
        if (stepsToInsert.length > 0) {
          const { error } = await supabase.from("instruction_steps").insert(stepsToInsert);
          if (error) throw error;
        }
      }

      // Save variants and their steps
      if (guideId) {
        // Delete old variants and their steps
        const { data: oldVariants } = await supabase.from("guide_variants").select("id").eq("instruction_set_id", guideId);
        if (oldVariants && oldVariants.length > 0) {
          const oldIds = oldVariants.map((v: any) => v.id);
          await supabase.from("instruction_steps").delete().in("variant_id", oldIds);
          await supabase.from("guide_variants").delete().eq("instruction_set_id", guideId);
        }
        // Insert new variants
        for (const variant of variants) {
          const variantSlug = variant.slug || generateSlug();
          const { data: vData, error: vErr } = await supabase.from("guide_variants").insert({
            instruction_set_id: guideId,
            variant_label: variant.variant_label,
            slug: variantSlug,
          }).select().single();
          if (vErr) throw vErr;
          // Insert variant steps
          const vSteps = variant.steps.filter(s => s.subtitle || s.description).map((s, i) => ({
            instruction_set_id: guideId!,
            variant_id: vData.id,
            step_number: i + 1,
            subtitle: s.subtitle || `Step ${i + 1}`,
            description: s.description || '',
            order_index: i + 1,
            image_url: s.image_url || null,
            image_original_url: s.image_original_url || null,
            image2_url: s.image2_url || null,
            image2_original_url: s.image2_original_url || null,
          }));
          if (vSteps.length > 0) {
            const { error: vsErr } = await supabase.from("instruction_steps").insert(vSteps);
            if (vsErr) throw vsErr;
          }
        }
      }

      // Save vehicles
      if (guideId) {
        const { error: delVehErr } = await (supabase.from("guide_vehicles" as any) as any).delete().eq("instruction_set_id", guideId);
        if (delVehErr) console.warn("Vehicle delete error:", delVehErr);
        const vehiclesToInsert = vehicles
          .filter(v => v.make && v.model && v.year_from)
          .map(v => ({
            instruction_set_id: guideId!,
            make: v.make,
            model: v.model,
            year_from: parseInt(v.year_from),
            year_to: v.year_to ? parseInt(v.year_to) : 0,
          }));
        if (vehiclesToInsert.length > 0) {
          const { error: insVehErr } = await (supabase.from("guide_vehicles" as any) as any).insert(vehiclesToInsert);
          if (insVehErr) throw insVehErr;
        }
      }

      queryClient.invalidateQueries({ queryKey: ["instruction_sets"] });
      queryClient.invalidateQueries({ queryKey: ["instruction_steps"] });
      queryClient.invalidateQueries({ queryKey: ["guide_vehicles"] });
      toast.success("Guide saved!");
      if (!isEditing && guideId) {
        navigate(`/guide/guides/${guideId}/edit`, { replace: true });
      }
      return true;
    } catch (err: any) {
      toast.error(err.message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const addTool = () => {
    if (toolInput.trim() && !tools.includes(toolInput.trim())) {
      setTools([...tools, toolInput.trim()]);
      setToolInput("");
    }
  };

  const addStep = () => {
    setGuideSteps([...guideSteps, {
      step_number: guideSteps.length + 1,
      subtitle: '',
      description: '',
      order_index: guideSteps.length + 1,
    }]);
  };

  const updateStep = (index: number, field: string, value: string) => {
    const updated = [...guideSteps];
    updated[index] = { ...updated[index], [field]: value };
    setGuideSteps(updated);
  };

  const transferStepImage = (index: number, field: 'image_url' | 'image2_url', url: string, originalUrl: string | null) => {
    const updated = [...guideSteps];
    const origField = field === 'image_url' ? 'image_original_url' : 'image2_original_url';
    updated[index] = { ...updated[index], [field]: url, [origField]: originalUrl ?? url };
    setGuideSteps(updated);
    toast.success("Image copied to this slot");
  };

  const updateStepImage = (index: number, field: 'image_url' | 'image2_url', value: string | null) => {
    const updated = [...guideSteps];
    // When first setting an image, also set the original
    const origField = field === 'image_url' ? 'image_original_url' : 'image2_original_url';
    if (value && !updated[index][origField]) {
      updated[index] = { ...updated[index], [field]: value, [origField]: value };
    } else {
      updated[index] = { ...updated[index], [field]: value };
    }
    if (!value) {
      updated[index] = { ...updated[index], [origField]: null };
    }
    setGuideSteps(updated);
  };

  const openEditor = (stepIndex: number, field: 'image_url' | 'image2_url') => {
    const step = guideSteps[stepIndex];
    const origField = field === 'image_url' ? 'image_original_url' : 'image2_original_url';
    const imageUrl = step[field];
    const originalUrl = step[origField];
    if (!imageUrl) return;
    setEditorTarget({ stepIndex, field });
    setEditorImageUrl(imageUrl);
    setEditorOriginalUrl(originalUrl || null);
    setEditorOpen(true);
  };

  const handleEditorSave = async (dataUrl: string) => {
    if (!editorTarget) return;
    setEditorOpen(false);
    // Upload edited image to storage
    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const file = new File([blob], `edited-${Date.now()}.jpg`, { type: 'image/jpeg' });
      const url = await uploadToStorage(file, 'steps');
      const updated = [...guideSteps];
      updated[editorTarget.stepIndex] = { ...updated[editorTarget.stepIndex], [editorTarget.field]: url };
      setGuideSteps(updated);
      toast.success("Image saved");
    } catch (err: any) {
      toast.error(err.message ?? "Failed to save edited image");
    }
  };

  const removeStep = (index: number) => {
    if (guideSteps.length <= 1) return;
    setGuideSteps(guideSteps.filter((_, i) => i !== index).map((s, i) => ({ ...s, step_number: i + 1, order_index: i + 1 })));
  };

  if (isEditing && (loadingGuide || loadingSteps || loadingVehicles)) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate('/guide/guides')} className="mb-2">
            <ChevronLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <h1 className="text-xl sm:text-2xl font-bold">{isEditing ? 'Edit Guide' : 'Create New Guide'}</h1>
        </div>
        <Button variant="outline" size="sm" onClick={saveDraft} disabled={saving} className="self-start sm:self-auto">
          {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
          Save
        </Button>
      </div>

      {/* Publication status */}
      {isEditing && publications.length > 0 && (
        <div className="flex gap-3 text-xs flex-wrap">
          {publications.map((pub: any) => (
            <Badge key={pub.id} className={pub.status === 'published' ? 'bg-success/10 text-success border-success/20' : 'bg-warning/10 text-warning border-warning/20'}>
              {pub.status === 'published' ? '●' : '○'} {pub.brands?.name} — {pub.status}
            </Badge>
          ))}
        </div>
      )}

      {/* Progress */}
      <div className="flex items-center gap-1 bg-card rounded-lg border p-2 sm:p-3 overflow-x-auto">
        {wizardSteps.map((step, i) => (
          <button
            key={step}
            onClick={() => setCurrentStep(i)}
            className={`flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 rounded text-xs sm:text-sm transition-colors whitespace-nowrap shrink-0 ${
              i === currentStep ? 'bg-primary text-primary-foreground font-medium' :
              i < currentStep ? 'text-success font-medium' : 'text-muted-foreground'
            }`}
          >
            <span className="w-5 h-5 rounded-full border flex items-center justify-center text-xs shrink-0">
              {i < currentStep ? <Check className="w-3 h-3" /> : i + 1}
            </span>
            <span className="hidden sm:inline">{step}</span>
          </button>
        ))}
      </div>

      {/* Step content */}
      <div className="bg-card rounded-lg border p-4 sm:p-6">
        {currentStep === 0 && (
          <div className="space-y-5">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Product Details</h2>
              <Button variant="outline" size="sm" onClick={() => setPdfImportOpen(true)}>
                <FileText className="w-4 h-4 mr-2" /> Import PDF
              </Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Product Title *</Label>
                <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Heavy Duty Bull Bar — Toyota Hilux 2021+" className="mt-1.5" />
              </div>
              <div>
                <Label>Product Code *</Label>
                <Input value={productCode} onChange={e => setProductCode(e.target.value)} placeholder="e.g. BB-TH21" className="mt-1.5" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Category</Label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger className="mt-1.5"><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent>
                    {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Estimated Completion Time</Label>
                <Input value={estimatedTime} onChange={e => setEstimatedTime(e.target.value)} placeholder="e.g. 2–3 hours" className="mt-1.5" />
              </div>
            </div>
            <div>
              <Label>Short Description</Label>
              <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Brief customer-facing description (300 chars max)" maxLength={300} className="mt-1.5" rows={3} />
              <p className="text-xs text-muted-foreground mt-1">{description.length}/300</p>
            </div>
            <div>
              <Label>Product Image</Label>
              <div className="mt-1.5">
                <DropZone
                  label="Drag and drop or click to upload"
                  currentUrl={productImageUrl}
                  onUpload={(url) => setProductImageUrl(url)}
                  onClear={() => setProductImageUrl(null)}
                  folder="products"
                />
              </div>
            </div>

            {/* Vehicle Fitment */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="flex items-center gap-1.5"><Car className="w-4 h-4" /> Vehicle Fitment</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">Which vehicles does this product suit?</p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => setVehicles([...vehicles, { make: '', model: '', year_from: '', year_to: '' }])}>
                  <Plus className="w-4 h-4 mr-1" /> Add Vehicle
                </Button>
              </div>
              {vehicles.map((v, i) => (
                <div key={i} className="flex flex-col sm:flex-row gap-2 items-start sm:items-end border rounded-lg p-3">
                  <div className="flex-1 w-full sm:w-auto">
                    <Label className="text-xs">Make</Label>
                    <Input value={v.make} onChange={e => { const u = [...vehicles]; u[i] = { ...u[i], make: e.target.value }; setVehicles(u); }} placeholder="e.g. Toyota" className="mt-1" />
                  </div>
                  <div className="flex-1 w-full sm:w-auto">
                    <Label className="text-xs">Model</Label>
                    <Input value={v.model} onChange={e => { const u = [...vehicles]; u[i] = { ...u[i], model: e.target.value }; setVehicles(u); }} placeholder="e.g. Hilux" className="mt-1" />
                  </div>
                  <div className="w-full sm:w-24">
                    <Label className="text-xs">From</Label>
                    <Input type="number" value={v.year_from} onChange={e => { const u = [...vehicles]; u[i] = { ...u[i], year_from: e.target.value }; setVehicles(u); }} placeholder="2015" className="mt-1" />
                  </div>
                  <div className="w-full sm:w-24">
                    <Label className="text-xs">To (blank = current)</Label>
                    <Input type="number" value={v.year_to} onChange={e => { const u = [...vehicles]; u[i] = { ...u[i], year_to: e.target.value }; setVehicles(u); }} placeholder="Current" className="mt-1" />
                  </div>
                  <Button type="button" variant="ghost" size="icon" className="shrink-0 h-9 w-9 text-destructive" onClick={() => setVehicles(vehicles.filter((_, j) => j !== i))}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
              {vehicles.length === 0 && <p className="text-sm text-muted-foreground">No vehicles added yet</p>}
            </div>
          </div>
        )}

        {currentStep === 1 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold">Tools Required</h2>
            <div className="flex gap-2">
              <Input
                value={toolInput}
                onChange={e => setToolInput(e.target.value)}
                placeholder="Add a tool (press Enter)"
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTool(); } }}
                className="flex-1"
              />
              <Button onClick={addTool} variant="outline">Add</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {tools.map((tool, i) => (
                <Badge key={i} variant="secondary" className="px-3 py-1.5 text-sm gap-2">
                  {tool}
                  <button onClick={() => setTools(tools.filter((_, j) => j !== i))}><X className="w-3 h-3" /></button>
                </Badge>
              ))}
              {tools.length === 0 && <p className="text-sm text-muted-foreground">No tools added yet</p>}
            </div>
          </div>
        )}

        {currentStep === 2 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Installation Steps</h2>
            <p className="text-xs text-muted-foreground">Drag steps by the handle to reorder them.</p>
            <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleStepDragEnd}>
              <SortableContext items={guideSteps.map((_, i) => `step-${i}`)} strategy={verticalListSortingStrategy}>
                {guideSteps.map((step, i) => (
                  <SortableStep
                    key={`step-${i}`}
                    id={`step-${i}`}
                    step={step}
                    index={i}
                    onUpdate={updateStep}
                    onUpdateImage={updateStepImage}
                    onTransferImage={transferStepImage}
                    onOpenEditor={openEditor}
                    onRemove={removeStep}
                    canRemove={guideSteps.length > 1}
                  />
                ))}
              </SortableContext>
            </DndContext>
            <Button variant="outline" onClick={addStep} className="w-full">
              <Plus className="w-4 h-4 mr-2" /> Add Step
            </Button>
          </div>
        )}

        {currentStep === 3 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold">Variants</h2>
            <p className="text-sm text-muted-foreground">
              Variants allow you to create alternative step sequences for different product configurations (e.g. different vehicle models).
            </p>

            {/* Standard variant (always present) */}
            <div className="border rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">Standard</p>
                  <p className="text-xs text-muted-foreground">Default — uses the {guideSteps.length} step{guideSteps.length !== 1 ? 's' : ''} from the Installation Steps tab</p>
                </div>
                <Badge>Default</Badge>
              </div>
            </div>

            {/* Existing variants */}
            {variants.map((variant, vIdx) => (
              <div key={vIdx} className="border rounded-lg overflow-hidden">
                <div
                  className="p-4 flex items-center justify-between cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => setEditingVariantIdx(editingVariantIdx === vIdx ? null : vIdx)}
                >
                  <div>
                    <p className="font-medium text-sm">{variant.variant_label}</p>
                    <p className="text-xs text-muted-foreground">{variant.steps.length} step{variant.steps.length !== 1 ? 's' : ''}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive h-8"
                      onClick={(e) => {
                        e.stopPropagation();
                        setVariants(variants.filter((_, i) => i !== vIdx));
                        if (editingVariantIdx === vIdx) setEditingVariantIdx(null);
                        toast.success("Variant removed");
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                    <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${editingVariantIdx === vIdx ? 'rotate-90' : ''}`} />
                  </div>
                </div>

                {/* Expanded variant step editor */}
                {editingVariantIdx === vIdx && (
                  <div className="border-t p-4 space-y-4 bg-muted/10">
                    <div className="flex items-center gap-3">
                      <Label className="text-xs shrink-0">Label</Label>
                      <Input
                        value={variant.variant_label}
                        onChange={(e) => {
                          const updated = [...variants];
                          updated[vIdx] = { ...updated[vIdx], variant_label: e.target.value };
                          setVariants(updated);
                        }}
                        className="h-8 text-sm"
                      />
                    </div>

                    {/* Variant steps */}
                    {variant.steps.map((step, sIdx) => (
                      <div key={sIdx} className="border rounded-lg p-3 space-y-2 bg-background">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-muted-foreground">Step {sIdx + 1}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-destructive"
                            onClick={() => {
                              if (variant.steps.length <= 1) return;
                              const updated = [...variants];
                              updated[vIdx] = {
                                ...updated[vIdx],
                                steps: variant.steps.filter((_, i) => i !== sIdx).map((s, i) => ({ ...s, step_number: i + 1, order_index: i + 1 })),
                              };
                              setVariants(updated);
                            }}
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                        <Input
                          placeholder="Step subtitle"
                          value={step.subtitle}
                          onChange={(e) => {
                            const updated = [...variants];
                            updated[vIdx].steps[sIdx] = { ...updated[vIdx].steps[sIdx], subtitle: e.target.value };
                            setVariants(updated);
                          }}
                          className="h-8 text-sm"
                        />
                        <Textarea
                          placeholder="Step description"
                          value={step.description}
                          onChange={(e) => {
                            const updated = [...variants];
                            updated[vIdx].steps[sIdx] = { ...updated[vIdx].steps[sIdx], description: e.target.value };
                            setVariants(updated);
                          }}
                          rows={3}
                          className="text-sm"
                        />
                      </div>
                    ))}

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const updated = [...variants];
                        updated[vIdx] = {
                          ...updated[vIdx],
                          steps: [...variant.steps, {
                            step_number: variant.steps.length + 1,
                            subtitle: '',
                            description: '',
                            order_index: variant.steps.length + 1,
                          }],
                        };
                        setVariants(updated);
                      }}
                    >
                      <Plus className="w-3.5 h-3.5 mr-1" /> Add Step
                    </Button>
                  </div>
                )}
              </div>
            ))}

            {/* Add variant panel */}
            {showAddVariant ? (
              <div className="border rounded-lg p-4 space-y-3">
                <Label className="text-sm">New Variant Label</Label>
                <Input
                  placeholder="e.g. Left-hand drive, Diesel model"
                  value={newVariantLabel}
                  onChange={(e) => setNewVariantLabel(e.target.value)}
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={!newVariantLabel.trim()}
                    onClick={() => {
                      setVariants([...variants, {
                        variant_label: newVariantLabel.trim(),
                        slug: generateSlug(),
                        steps: guideSteps.map((s, i) => ({
                          step_number: i + 1,
                          subtitle: s.subtitle,
                          description: s.description,
                          order_index: i + 1,
                          image_url: s.image_url,
                          image_original_url: s.image_original_url,
                          image2_url: s.image2_url,
                          image2_original_url: s.image2_original_url,
                        })),
                      }]);
                      setNewVariantLabel("");
                      setShowAddVariant(false);
                      toast.success("Variant added — steps copied from Standard");
                    }}
                  >
                    Create (copy steps)
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!newVariantLabel.trim()}
                    onClick={() => {
                      setVariants([...variants, {
                        variant_label: newVariantLabel.trim(),
                        slug: generateSlug(),
                        steps: [{ step_number: 1, subtitle: '', description: '', order_index: 1 }],
                      }]);
                      setNewVariantLabel("");
                      setShowAddVariant(false);
                      toast.success("Variant added — start fresh");
                    }}
                  >
                    Create (start fresh)
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => { setShowAddVariant(false); setNewVariantLabel(""); }}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="outline" onClick={() => setShowAddVariant(true)}>
                <Plus className="w-4 h-4 mr-2" /> Add Variant
              </Button>
            )}
          </div>
        )}

        {currentStep === 4 && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold">Review & Publish</h2>
            <div className="border rounded-lg p-4 space-y-2">
              {productImageUrl && (
                <img src={productImageUrl} alt="" className="w-full h-40 object-cover rounded mb-3" />
              )}
              <h3 className="font-semibold">{title || 'Untitled Guide'}</h3>
              <p className="text-sm text-muted-foreground">{description || 'No description'}</p>
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span>Code: {productCode || '—'}</span>
                <span>Time: {estimatedTime || '—'}</span>
                <span>Tools: {tools.length}</span>
                <span>Steps: {guideSteps.filter(s => s.subtitle).length}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {brands.map(brand => {
                const pub = publications.find((p: any) => p.brand_id === brand.id);
                return (
                  <div key={brand.id} className="border rounded-lg p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-sm">{brand.name}</h3>
                      {pub?.status === 'published' ? (
                        <Badge className="bg-success text-success-foreground">Published</Badge>
                      ) : (
                        <Badge variant="outline">Not Published</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground break-all">
                      {brand.domain}/{(existingGuide as any)?.slug || '...'}
                    </p>
                    <Button size="sm" className="w-full" disabled={saving} onClick={async () => {
                      await saveDraft();
                      if (!id) { toast.error("Save the guide first"); return; }
                      try {
                        if (pub) {
                          await supabase.from("guide_publications").update({ status: 'published', published_at: new Date().toISOString() }).eq("id", pub.id);
                        } else {
                          await supabase.from("guide_publications").insert({ instruction_set_id: id, brand_id: brand.id, status: 'published', published_at: new Date().toISOString() });
                        }
                        queryClient.invalidateQueries({ queryKey: ["publications"] });
                        toast.success(`Published to ${brand.name}!`);
                        navigate(`/guide/guides/${id}/share`);
                      } catch (err: any) {
                        toast.error(err.message);
                      }
                    }}>
                      {pub?.status === 'published' ? 'Update Live Version' : `Publish to ${brand.name}`}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-card rounded-lg border p-3 sm:p-4">
        <Button variant="outline" size="sm" onClick={saveDraft} disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
          Save
        </Button>
        <div className="flex gap-2 justify-end">
          {currentStep > 0 && (
            <Button variant="outline" size="sm" disabled={saving} onClick={async () => { await saveDraft(); setCurrentStep(currentStep - 1); }}>
              {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              <ChevronLeft className="w-4 h-4 mr-1" /> Back
            </Button>
          )}
          {currentStep < wizardSteps.length - 1 && (
            <Button size="sm" disabled={saving} onClick={async () => { await saveDraft(); setCurrentStep(currentStep + 1); }}>
              {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              Next <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          )}
        </div>
      </div>
      <PdfImportDialog open={pdfImportOpen} onOpenChange={setPdfImportOpen} onApply={handlePdfApply} />
      <ImageEditorModal
        open={editorOpen}
        imageUrl={editorImageUrl}
        originalUrl={editorOriginalUrl}
        brandColour={brands[0]?.primary_colour}
        onSave={handleEditorSave}
        onClose={() => setEditorOpen(false)}
      />
    </div>
  );
}
