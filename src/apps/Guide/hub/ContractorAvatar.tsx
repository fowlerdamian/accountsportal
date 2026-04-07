import { cn } from "@guide/lib/utils";

// Deterministic dark-palette colours — consistent across sessions
const PALETTE = [
  { bg: "bg-blue-900/70",    text: "text-blue-200"    },
  { bg: "bg-emerald-900/70", text: "text-emerald-200" },
  { bg: "bg-amber-900/70",   text: "text-amber-200"   },
  { bg: "bg-rose-900/70",    text: "text-rose-200"    },
  { bg: "bg-violet-900/70",  text: "text-violet-200"  },
  { bg: "bg-cyan-900/70",    text: "text-cyan-200"    },
  { bg: "bg-orange-900/70",  text: "text-orange-200"  },
  { bg: "bg-lime-900/70",    text: "text-lime-200"    },
];

function hashName(name: string): number {
  return name.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
}

function getInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .substring(0, 2);
}

interface ContractorAvatarProps {
  name:        string;
  avatarUrl?:  string | null;
  size?:       "xs" | "sm" | "md" | "lg";
  className?:  string;
}

const SIZE_CLASSES = {
  xs: "w-5 h-5 text-[9px]",
  sm: "w-7 h-7 text-[11px]",
  md: "w-8 h-8 text-xs",
  lg: "w-10 h-10 text-sm",
};

export function ContractorAvatar({
  name,
  avatarUrl,
  size = "md",
  className,
}: ContractorAvatarProps) {
  const colour   = PALETTE[hashName(name) % PALETTE.length];
  const initials = getInitials(name);
  const sizeClass = SIZE_CLASSES[size];

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className={cn("rounded-full object-cover shrink-0", sizeClass, className)}
      />
    );
  }

  return (
    <div
      className={cn(
        "rounded-full flex items-center justify-center font-semibold shrink-0",
        sizeClass,
        colour.bg,
        colour.text,
        className,
      )}
      title={name}
    >
      {initials}
    </div>
  );
}

// Stack of avatars (e.g. project card)
interface ContractorAvatarGroupProps {
  contractors: { id: string; name: string; avatar_url?: string | null }[];
  max?:        number;
  size?:       "xs" | "sm" | "md";
}

export function ContractorAvatarGroup({
  contractors,
  max = 4,
  size = "sm",
}: ContractorAvatarGroupProps) {
  const visible  = contractors.slice(0, max);
  const overflow = contractors.length - max;

  return (
    <div className="flex -space-x-1.5">
      {visible.map((c) => (
        <ContractorAvatar
          key={c.id}
          name={c.name}
          avatarUrl={c.avatar_url}
          size={size}
          className="ring-1 ring-background"
        />
      ))}
      {overflow > 0 && (
        <div
          className={cn(
            "rounded-full flex items-center justify-center font-semibold shrink-0 ring-1 ring-background",
            SIZE_CLASSES[size],
            "bg-muted text-muted-foreground text-[10px]",
          )}
        >
          +{overflow}
        </div>
      )}
    </div>
  );
}
