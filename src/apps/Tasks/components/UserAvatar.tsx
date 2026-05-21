import { cn } from "@guide/lib/utils";

// Mirrors ContractorAvatar from @hub/components/ContractorAvatar — same
// deterministic palette and sizing. Lives in @tasks because the assignee
// here is an auth.users / profile, not a contractor.

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

const SIZE_CLASSES = {
  xs: "w-5 h-5 text-[9px]",
  sm: "w-7 h-7 text-[11px]",
  md: "w-8 h-8 text-xs",
  lg: "w-10 h-10 text-sm",
};

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

interface UserAvatarProps {
  name:        string;
  size?:       keyof typeof SIZE_CLASSES;
  className?:  string;
}

export function UserAvatar({ name, size = "md", className }: UserAvatarProps) {
  const colour    = PALETTE[hashName(name) % PALETTE.length];
  const initials  = getInitials(name || "?");
  const sizeClass = SIZE_CLASSES[size];

  return (
    <div
      title={name}
      className={cn(
        "rounded-full flex items-center justify-center font-semibold shrink-0",
        sizeClass, colour.bg, colour.text, className,
      )}
    >
      {initials}
    </div>
  );
}
