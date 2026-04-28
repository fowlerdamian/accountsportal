import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { cn } from "../../../apps/Guide/lib/utils";
import { CHANNEL_LABEL, CHANNEL_COLOR, CHANNELS, type Channel } from "../lib/constants";
import {
  Users, Kanban, BarChart3, ArrowLeft, Phone,
} from "lucide-react";

interface Props { channel: string }

const NAV_ITEMS = [
  { label: "Leads",    path: "leads",    icon: Users },
  { label: "Calls",    path: "calls",    icon: Phone },
  { label: "Pipeline", path: "pipeline", icon: Kanban },
  { label: "Reports",  path: "reports",  icon: BarChart3 },
];

export default function ChannelLayout({ channel }: Props) {
  const ch      = channel as Channel;
  const colors  = CHANNEL_COLOR[ch];
  const navigate = useNavigate();
  const location = useLocation();

  const base = `/sales-support/${ch}`;

  return (
    <div className="flex flex-col">
      {/* Channel header — two rows on mobile, one row on desktop */}
      <div className={cn("sticky top-0 z-10 border-b border-border/50 bg-card/50 px-3 sm:px-6 py-2", colors.border)}>
        {/* Row 1: back + channel tabs */}
        <div className="flex items-center gap-2 sm:gap-4">
          <button
            onClick={() => navigate("/sales-support")}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Dashboard</span>
          </button>

          <div className="hidden sm:block h-4 w-px bg-border" />

          {/* Channel tabs */}
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
            {CHANNELS.map((c) => {
              const cc = CHANNEL_COLOR[c];
              const active = c === ch;
              return (
                <button
                  key={c}
                  onClick={() => navigate(`/sales-support/${c}/leads`)}
                  className={cn(
                    "px-2.5 sm:px-3 py-1 rounded text-xs font-medium transition-all whitespace-nowrap",
                    active
                      ? cn(cc.bg, cc.text, "border", cc.border)
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                  )}
                >
                  {CHANNEL_LABEL[c]}
                </button>
              );
            })}
          </div>

          <div className="hidden sm:block h-4 w-px bg-border" />

          {/* Sub-nav — inline on desktop, hidden here on mobile (shown in row 2) */}
          <nav className="hidden sm:flex items-center gap-1">
            {NAV_ITEMS.map(({ label, path, icon: Icon }) => {
              const href     = `${base}/${path}`;
              const isActive = location.pathname.startsWith(href);
              return (
                <NavLink
                  key={path}
                  to={href}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-all",
                    isActive
                      ? "bg-foreground/10 text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </NavLink>
              );
            })}
          </nav>
        </div>

        {/* Row 2: sub-nav on mobile only */}
        <div className="flex sm:hidden items-center gap-1 mt-1.5 border-t border-border/30 pt-1.5">
          {NAV_ITEMS.map(({ label, path, icon: Icon }) => {
            const href     = `${base}/${path}`;
            const isActive = location.pathname.startsWith(href);
            return (
              <NavLink
                key={path}
                to={href}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all flex-1 justify-center",
                  isActive
                    ? "bg-foreground/10 text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </NavLink>
            );
          })}
        </div>
      </div>

      {/* Page content */}
      <div className="p-3 sm:p-6">
        <div className="max-w-7xl mx-auto">
          <Outlet context={{ channel: ch }} />
        </div>
      </div>
    </div>
  );
}
