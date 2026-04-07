import { useState, useEffect, useRef, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Loader2, Plus, Trash2, Check, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';


interface PickItem {
  sku: string;
  name: string;
  qty: number;
}

interface SkuSuggestion {
  SKU: string;
  Name: string;
}

interface Props {
  caseId: string;
  cin7SaleId: string;
  caseNumber?: string;
}

function useSkuSearch(sku: string) {
  return useQuery({
    queryKey: ['cin7-sku-search', sku],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('cin7-product-search', {
        body: { sku },
      });
      if (error) throw error;
      return (data?.products || []) as SkuSuggestion[];
    },
    enabled: sku.trim().length >= 2,
    staleTime: 60_000,
  });
}

function SkuInput({ value, onChange, onProductSelect }: {
  value: string;
  onChange: (v: string) => void;
  onProductSelect: (sku: string, name: string) => void;
}) {
  const [debouncedSku, setDebouncedSku] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const wrapperRef = useRef<HTMLDivElement>(null);

  const { data: suggestions, isFetching } = useSkuSearch(debouncedSku);

  const handleChange = useCallback((v: string) => {
    onChange(v);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setDebouncedSku(v);
      setShowDropdown(true);
    }, 350);
  }, [onChange]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return (
    <div ref={wrapperRef} className="relative w-28">
      <input
        value={value}
        onChange={e => handleChange(e.target.value)}
        onFocus={() => { if (suggestions?.length) setShowDropdown(true); }}
        placeholder="SKU"
        className="w-full bg-background border border-input text-sm px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground transition-colors"
      />
      {isFetching && (
        <Loader2 className="absolute right-1.5 top-2.5 h-3 w-3 animate-spin text-muted-foreground" />
      )}
      {showDropdown && suggestions && suggestions.length > 0 && (
        <div className="absolute z-50 top-full left-0 mt-0.5 w-72 bg-popover border border-border shadow-md max-h-48 overflow-y-auto">
          {suggestions.map((s, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => {
                onProductSelect(s.SKU, s.Name);
                setShowDropdown(false);
              }}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent transition-colors flex gap-2"
            >
              <span className="font-mono text-muted-foreground shrink-0">{s.SKU}</span>
              <span className="truncate">{s.Name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ManualPickForm({ caseId, cin7SaleId, caseNumber }: Props) {
  const { teamMember } = useAuth();
  const queryClient = useQueryClient();

  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [postcode, setPostcode] = useState('');
  const [country, setCountry] = useState('');
  const [items, setItems] = useState<PickItem[]>([{ sku: '', name: '', qty: 1 }]);
  const [notes, setNotes] = useState('');
  const [editing, setEditing] = useState(false);
  const [existingId, setExistingId] = useState<string | null>(null);
  const cin7Applied = useRef(false);

  // Load existing pick request for this case
  const { data: existingPick, isLoading: loadingExisting } = useQuery({
    queryKey: ['manual-pick', caseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('manual_pick_requests')
        .select('*')
        .eq('case_id', caseId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Load Cin7 order detail for pre-populating new forms
  const { data: orderDetail, isLoading: loadingOrder } = useQuery({
    queryKey: ['cin7-order-detail-pick', cin7SaleId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('cin7-get-order-detail', {
        body: { saleId: cin7SaleId },
      });
      if (error) throw error;
      return data;
    },
    enabled: !!cin7SaleId && !existingPick,
  });

  // Populate from existing saved pick request
  useEffect(() => {
    if (existingPick) {
      setExistingId(existingPick.id);
      setCustomerName(existingPick.customer_name || '');
      setPhone((existingPick as any).phone || '');
      setLine1(existingPick.address_line1 || '');
      setLine2(existingPick.address_line2 || '');
      setCity(existingPick.city || '');
      setState(existingPick.state || '');
      setPostcode(existingPick.postcode || '');
      setCountry(existingPick.country || '');
      setNotes(existingPick.notes || '');
      const savedItems = existingPick.items as unknown as PickItem[];
      if (Array.isArray(savedItems) && savedItems.length > 0) {
        setItems(savedItems);
      }
    }
  }, [existingPick]);

  // Pre-populate from Cin7 only once for new forms (no existing pick)
  useEffect(() => {
    if (!existingPick && orderDetail?.found && !cin7Applied.current) {
      cin7Applied.current = true;
      setCustomerName(orderDetail.Customer || '');
      if (orderDetail.ShippingAddress) {
        const addr = orderDetail.ShippingAddress;
        setLine1(addr.Line1 || '');
        setLine2(addr.Line2 || '');
        setCity(addr.City || '');
        setState(addr.State || '');
        setPostcode(addr.Postcode || '');
        setCountry(addr.Country || '');
      }
    }
  }, [orderDetail, existingPick]);

  const addItem = () => setItems([...items, { sku: '', name: '', qty: 1 }]);
  const removeItem = (i: number) => setItems(items.filter((_, idx) => idx !== i));
  const updateItem = (i: number, field: keyof PickItem, value: string | number) => {
    setItems(items.map((item, idx) => idx === i ? { ...item, [field]: value } : item));
  };

  const hasItems = items.some(i => i.name.trim() !== '');

  const saveMutation = useMutation({
    mutationFn: async () => {
      const validItems = items.filter(i => i.name.trim() !== '');
      const payload = {
        case_id: caseId,
        customer_name: customerName,
        phone: phone || null,
        address_line1: line1,
        address_line2: line2 || null,
        city,
        state,
        postcode,
        country,
        items: validItems as any,
        notes: notes || null,
        created_by_name: teamMember?.name || 'Staff',
      };

      if (existingId) {
        // Update existing record
        const { error } = await supabase
          .from('manual_pick_requests')
          .update(payload)
          .eq('id', existingId);
        if (error) throw error;

        await supabase.from('case_updates').insert({
          case_id: caseId,
          author_type: 'system',
          author_name: teamMember?.name || 'System',
          message: `Pick slip updated — ${validItems.length} item${validItems.length !== 1 ? 's' : ''} for ${customerName}`,
        });
      } else {
        // Insert new record
        const { data: inserted, error } = await supabase
          .from('manual_pick_requests')
          .insert(payload)
          .select('id')
          .single();
        if (error) throw error;
        setExistingId(inserted.id);

        await supabase.from('case_updates').insert({
          case_id: caseId,
          author_type: 'system',
          author_name: teamMember?.name || 'System',
          message: `Manual pick slip created — ${validItems.length} item${validItems.length !== 1 ? 's' : ''} for ${customerName}`,
        });

        // Auto-create warehouse task so it appears on the warehouse dashboard
        const itemSummary = validItems.map(i => `${i.qty}× ${i.sku || i.name}`).join(', ');
        await supabase.from('action_items').insert({
          case_id: caseId,
          description: `Replacement order: ${itemSummary} → ${customerName}`,
          assigned_to_name: 'Warehouse',
          assigned_to_email: 'warehouse@automotivegroup.com.au',
          created_by_name: teamMember?.name || 'Staff',
          priority: 'normal',
          is_warehouse_task: true,
          is_replacement_pick: true,
        } as any);
      }
    },
    onSuccess: () => {
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ['manual-pick', caseId] });
      queryClient.invalidateQueries({ queryKey: ['warehouse-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['warehouse-tasks-count'] });
      toast.success(existingId ? 'Pick slip updated' : 'Pick slip saved & sent to warehouse');
    },
    onError: (err: Error) => {
      console.error('Manual pick save failed:', err);
      toast.error('Failed to save pick slip');
    },
  });

  if (loadingExisting || loadingOrder) {
    return (
      <div className="flex items-center gap-2 py-4">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Loading…</span>
      </div>
    );
  }

  // Saved state — show summary with Edit button
  if (existingId && !editing) {
    const savedItems = items.filter(i => i.name.trim() !== '');
    return (
      <div className="py-4">
        <div className="flex items-center gap-2 mb-3">
          <Check className="h-4 w-4 text-status-resolved" />
          <span className="text-sm text-foreground">Pick slip saved — sent to warehouse</span>
          <span className="text-xs text-muted-foreground">
            — {savedItems.length} item{savedItems.length !== 1 ? 's' : ''} for {customerName}
          </span>
        </div>

        {/* Quick summary */}
        <div className="mb-3 text-xs text-muted-foreground space-y-0.5">
          <div>{[line1, city, state, postcode].filter(Boolean).join(', ')}</div>
          {savedItems.map((item, i) => (
            <div key={i}>{item.qty}× {item.sku ? `${item.sku} — ` : ''}{item.name}</div>
          ))}
          {notes && <div className="italic mt-1">Note: {notes}</div>}
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-xs border border-border text-muted-foreground hover:text-foreground transition-colors"
          >
            <Pencil className="h-3.5 w-3.5" /> Edit
          </button>
        </div>
      </div>
    );
  }

  // Edit / New form
  return (
    <div>
      {/* Ship To */}
      <div className="mb-4">
        <label className="text-[11px] text-muted-foreground uppercase tracking-wide block mb-1.5">Ship to</label>
        <input
          value={customerName}
          onChange={e => setCustomerName(e.target.value)}
          placeholder="Customer name"
          className="w-full bg-background border border-input text-sm px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground transition-colors mb-2"
        />
        <input
          value={phone}
          onChange={e => setPhone(e.target.value)}
          placeholder="Phone number"
          className="w-full bg-background border border-input text-sm px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground transition-colors mb-2"
        />
        <input
          value={line1}
          onChange={e => setLine1(e.target.value)}
          placeholder="Address line 1"
          className="w-full bg-background border border-input text-sm px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground transition-colors mb-2"
        />
        <input
          value={line2}
          onChange={e => setLine2(e.target.value)}
          placeholder="Address line 2 (optional)"
          className="w-full bg-background border border-input text-sm px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground transition-colors mb-2"
        />
        <div className="grid grid-cols-4 gap-2">
          <input
            value={city}
            onChange={e => setCity(e.target.value)}
            placeholder="City"
            className="bg-background border border-input text-sm px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground transition-colors"
          />
          <input
            value={state}
            onChange={e => setState(e.target.value)}
            placeholder="State"
            className="bg-background border border-input text-sm px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground transition-colors"
          />
          <input
            value={postcode}
            onChange={e => setPostcode(e.target.value)}
            placeholder="Postcode"
            className="bg-background border border-input text-sm px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground transition-colors"
          />
          <input
            value={country}
            onChange={e => setCountry(e.target.value)}
            placeholder="Country"
            className="bg-background border border-input text-sm px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground transition-colors"
          />
        </div>
      </div>

      {/* Items */}
      <div className="mb-4">
        <label className="text-[11px] text-muted-foreground uppercase tracking-wide block mb-1.5">Items to send</label>
        <div className="space-y-2">
          {items.map((item, i) => (
            <div key={i} className="flex gap-2 items-start">
              <input
                value={item.qty}
                onChange={e => updateItem(i, 'qty', parseInt(e.target.value) || 1)}
                type="number"
                min={1}
                className="w-16 bg-background border border-input text-sm px-2 py-2 text-foreground focus:outline-none focus:border-foreground transition-colors text-center"
              />
              <SkuInput
                value={item.sku}
                onChange={v => updateItem(i, 'sku', v)}
                onProductSelect={(sku, name) => {
                  setItems(items.map((it, idx) => idx === i ? { ...it, sku, name } : it));
                }}
              />
              <input
                value={item.name}
                onChange={e => updateItem(i, 'name', e.target.value)}
                placeholder="Item name / description"
                className="flex-1 bg-background border border-input text-sm px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground transition-colors"
              />
              {items.length > 1 && (
                <button onClick={() => removeItem(i)} className="p-2 text-muted-foreground hover:text-status-urgent transition-colors">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
        <button onClick={addItem} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-2 transition-colors">
          <Plus className="h-3.5 w-3.5" /> Add item
        </button>
      </div>

      {/* Notes */}
      <div className="mb-4">
        <label className="text-[11px] text-muted-foreground uppercase tracking-wide block mb-1.5">Notes (optional)</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={2}
          placeholder="Special instructions for warehouse"
          className="w-full bg-background border border-input text-sm px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground transition-colors resize-none"
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || !hasItems || !customerName.trim()}
          className={cn(
            'inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-foreground text-background transition-opacity',
            (saveMutation.isPending || !hasItems || !customerName.trim()) && 'opacity-40 cursor-not-allowed'
          )}
        >
          {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {existingId ? 'Save changes' : 'Save & send to warehouse'}
        </button>
        {existingId && (
          <button
            onClick={() => setEditing(false)}
            className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
