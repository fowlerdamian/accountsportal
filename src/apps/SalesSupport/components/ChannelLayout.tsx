import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { cn } from "../../../apps/Guide/lib/utils";
import { CHANNEL_LABEL, CHANNEL_COLOR, CHANNELS, type Channel } from "../lib/constants";
import {
  Users, Kanban, BarChart3, ArrowLeft,
} from "lucide-react";

interface Props { channel: string }

const NAV_ITEMS = [
  { label: "Leads",    path: "leads",    icon: Users },
  { label: "Pipeline", path: "pipeline", icon: Kanban },
  { label: "Reports",  path: "reports",  icon: BarChart3 },
];

export default function ChannelLayout({ channel }: Props) {
  const ch      = channel as Channel;
  const colors  = CHANNEL_COLOR[ch];
  const navigate = useNavigate();
  const location = useLocation();

  // Base path for this channel
  const base = `/sales-support/${ch}`;

  return (
    <div className="flex flex-col">
      {/* Channel header — sticky within the SalesSupport scroll container */}
      <div className={cn("sticky top-0 z-10 border-b border-border/50 bg-card/50 px-6 py-3", colors.border)}>
        <div className="flex items-center gap-4">
          {/* Back to dashboard */}
          <button
            onClick={() => navigate("/sales-support")}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Dashboard
          </button>

          <div className="h-4 w-px bg-border" />

          {/* Channel tabs */}
          <div className="flex items-center gap-1">
            {CHANNELS.map((c) => {
              const cc = CHANNEL_COLOR[c];
              const active = c === ch;
              return (
                <button
                  key={c}
                  onClick={() => navigate(`/sales-support/${c}/leads`)}
                  className={cn(
                    "px-3 py-1 rounded text-xs font-medium transition-all",
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

          <div className="h-4 w-px bg-border" />

          {/* Sub-nav */}
          <nav className="flex items-center gap-1">
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
                      ? cn("bg-foreground/10 text-foreground")
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
      </div>

      {/* Page content */}
      <div className="p-6">
        <div className="max-w-7xl mx-auto">
          <Outlet context={{ channel: ch }} />
        </div>
      </div>
    </div>
  );
}
