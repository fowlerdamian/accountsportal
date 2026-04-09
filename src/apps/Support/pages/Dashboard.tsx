import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Search } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { CaseCard } from '@/components/CaseCard';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import type { Case, CaseType, ErrorOrigin } from '@/lib/types';
import { useNavigate } from 'react-router-dom';

type FilterTab = 'active' | 'closed' | 'all';
type StatusFilter = 'open' | 'actioned' | 'in_hand' | 'closed' | null;
type SortOption = 'newest' | 'oldest' | 'urgent';

const tabs: { key: FilterTab; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'closed', label: 'Closed' },
  { key: 'all', label: 'All' },
];

type TypeFilterKey = CaseType | 'order_entry_error' | 'warehouse_error' | 'all';

const typeFilters: { key: TypeFilterKey; label: string }[] = [
  { key: 'all', label: 'All types' },
  { key: 'warranty_claim', label: 'Warranty' },
  { key: 'order_entry_error', label: 'Order entry error' },
  { key: 'warehouse_error', label: 'Warehouse error' },
  { key: 'freight_issue', label: 'Freight issue' },
  { key: 'complaint', label: 'Complaint' },
  { key: 'general', label: 'General' },
];

const sortOptions: { key: SortOption; label: string }[] = [
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
  { key: 'urgent', label: 'Most urgent' },
];

function StatPill({ label, count, colorClass, active, onClick }: { label: string; count: number; colorClass: string; active?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: '#0a0a0a',
        border: active ? '1px solid rgba(243,202,15,0.5)' : '1px solid #1e1e1e',
        borderRadius: '8px',
        padding: '16px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        textAlign: 'left',
        cursor: 'pointer',
        transition: 'border-color 150ms',
        boxShadow: active ? '0 0 0 1px rgba(243,202,15,0.25)' : 'none',
      }}
    >
      <span className={cn('font-mono text-2xl font-medium leading-none', colorClass)}>{count}</span>
      <span
        style={{
          fontSize: '10px',
          fontFamily: '"JetBrains Mono", monospace',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: '#a0a0a0',
        }}
      >
        {label}
      </span>
    </button>
  );
}

// Persist filters in localStorage
function usePersistedState<T>(key: string, defaultValue: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : defaultValue;
    } catch { return defaultValue; }
  });
  useEffect(() => { localStorage.setItem(key, JSON.stringify(value)); }, [key, value]);
  return [value, setValue];
}

export default function Dashboard() {
  const [activeTab, setActiveTab] = usePersistedState<FilterTab>('sh-tab', 'active');
  const [typeFilter, setTypeFilter] = usePersistedState<TypeFilterKey>('sh-type', 'all');
  const [sortBy, setSortBy] = usePersistedState<SortOption>('sh-sort', 'newest');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const { teamMember } = useAuth();
  const navigate = useNavigate();

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Focus search on /
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (e.key === '/' && !inInput) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const { data: cases = [], isLoading } = useQuery({
    queryKey: ['cases'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cases')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as unknown as Case[];
    },
  });

  const openCount = cases.filter(c => c.status === 'open').length;
  const actionedCount = cases.filter(c => c.status === 'actioned').length;
  const inHandCount = cases.filter(c => c.status === 'in_hand').length;
  const closedCount = cases.filter(c => c.status === 'closed').length;

  const filteredCases = useMemo(() => {
    let result = cases;

    // Status filter (from stat pills) takes priority
    if (statusFilter) {
      result = result.filter(c => c.status === statusFilter);
    } else {
      // Tab filter
      switch (activeTab) {
        case 'active':
          result = result.filter(c => ['open', 'actioned', 'in_hand'].includes(c.status));
          break;
        case 'closed':
          result = result.filter(c => c.status === 'closed');
          break;
      }
    }

    // Type filter
    if (typeFilter === 'order_entry_error') {
      result = result.filter(c => c.type === 'order_error' && c.error_origin === 'order_entry');
    } else if (typeFilter === 'warehouse_error') {
      result = result.filter(c => c.type === 'order_error' && c.error_origin === 'warehouse');
    } else if (typeFilter !== 'all') {
      result = result.filter(c => c.type === typeFilter);
    }

    // Search
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      result = result.filter(c =>
        c.case_number?.toLowerCase().includes(q) ||
        c.order_number?.toLowerCase().includes(q) ||
        c.title?.toLowerCase().includes(q) ||
        c.product_name?.toLowerCase().includes(q)
      );
    }

    // Sort
    switch (sortBy) {
      case 'oldest':
        result = [...result].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        break;
      case 'urgent':
        result = [...result].sort((a, b) => {
          if (a.priority === 'urgent' && b.priority !== 'urgent') return -1;
          if (b.priority === 'urgent' && a.priority !== 'urgent') return 1;
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });
        break;
      default:
        result = [...result].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }

    return result;
  }, [cases, activeTab, typeFilter, debouncedSearch, sortBy, statusFilter]);

  const toggleStatusFilter = (status: StatusFilter) => {
    setStatusFilter(prev => prev === status ? null : status);
  };

  return (
    <div>
      {/* Page heading — portal pattern */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 600, color: '#ffffff', margin: 0, letterSpacing: '-0.01em' }}>
          Cases
        </h1>
        <p style={{ fontSize: '13px', color: '#a0a0a0', margin: '4px 0 0', fontFamily: '"JetBrains Mono", monospace' }}>
          {teamMember?.name ? `Welcome back, ${teamMember.name.split(' ')[0]}` : 'Support Hub'}
        </p>
      </div>

      {/* Stats — portal KPI card pattern */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 mb-6">
        <StatPill label="New" count={openCount} colorClass="text-[#ffffff]" active={statusFilter === 'open'} onClick={() => toggleStatusFilter('open')} />
        <StatPill label="Actioned" count={actionedCount} colorClass="text-[#3B9EFF]" active={statusFilter === 'actioned'} onClick={() => toggleStatusFilter('actioned')} />
        <StatPill label="In hand" count={inHandCount} colorClass="text-[#f3ca0f]" active={statusFilter === 'in_hand'} onClick={() => toggleStatusFilter('in_hand')} />
        <StatPill label="Closed" count={closedCount} colorClass="text-[#60a57e]" active={statusFilter === 'closed'} onClick={() => toggleStatusFilter('closed')} />
      </div>

      {/* Filter tabs — amber active underline */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #222222', marginBottom: '16px' }}>
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => { setActiveTab(tab.key); setStatusFilter(null); }}
            style={{
              padding: '8px 16px',
              fontSize: '12px',
              fontWeight: 500,
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab.key && !statusFilter ? '2px solid #f3ca0f' : '2px solid transparent',
              marginBottom: '-1px',
              color: activeTab === tab.key && !statusFilter ? '#f3ca0f' : '#555',
              cursor: 'pointer',
              transition: 'color 120ms, border-color 120ms',
              fontFamily: 'inherit',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search — portal input style */}
      <div style={{ position: 'relative', marginBottom: '12px' }}>
        <Search style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', width: '14px', height: '14px', color: '#444' }} />
        <input
          ref={searchRef}
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search cases..."
          style={{
            width: '100%',
            background: '#0a0a0a',
            border: '1px solid #222222',
            borderRadius: '4px',
            fontSize: '13px',
            padding: '8px 44px 8px 36px',
            color: '#ffffff',
            outline: 'none',
            boxSizing: 'border-box',
            fontFamily: 'inherit',
          }}
          onFocus={e => { e.currentTarget.style.borderColor = 'rgba(243,202,15,0.4)'; }}
          onBlur={e => { e.currentTarget.style.borderColor = '#222222'; }}
        />
        <span
          style={{
            position: 'absolute',
            right: '12px',
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: '10px',
            fontFamily: '"JetBrains Mono", monospace',
            color: '#444',
            border: '1px solid #222222',
            padding: '1px 5px',
            borderRadius: '2px',
          }}
        >
          /
        </span>
      </div>

      {/* Inline filters — amber active */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', marginBottom: '20px' }}>
        {typeFilters.map(f => (
          <button
            key={f.key}
            onClick={() => setTypeFilter(f.key)}
            style={{
              padding: '3px 10px',
              fontSize: '11px',
              background: typeFilter === f.key ? 'rgba(243,202,15,0.12)' : 'transparent',
              border: typeFilter === f.key ? '1px solid rgba(243,202,15,0.4)' : '1px solid #222222',
              borderRadius: '3px',
              color: typeFilter === f.key ? '#f3ca0f' : '#555',
              cursor: 'pointer',
              transition: 'all 120ms',
              fontFamily: 'inherit',
            }}
          >
            {f.label}
          </button>
        ))}

        <span style={{ fontSize: '10px', fontFamily: '"JetBrains Mono", monospace', color: '#444', marginLeft: 'auto', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Sort:</span>
        {sortOptions.map(s => (
          <button
            key={s.key}
            onClick={() => setSortBy(s.key)}
            style={{
              padding: '3px 10px',
              fontSize: '11px',
              background: sortBy === s.key ? 'rgba(243,202,15,0.12)' : 'transparent',
              border: sortBy === s.key ? '1px solid rgba(243,202,15,0.4)' : '1px solid #222222',
              borderRadius: '3px',
              color: sortBy === s.key ? '#f3ca0f' : '#555',
              cursor: 'pointer',
              transition: 'all 120ms',
              fontFamily: 'inherit',
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Case list */}
      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-card border border-border h-36 animate-pulse" />
          ))}
        </div>
      ) : filteredCases.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-sm">
            {activeTab === 'active'
              ? 'Everything is under control — no active cases right now.'
              : 'No cases match your filters'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filteredCases.map((c, i) => (
            <CaseCard key={c.id} caseData={c} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
