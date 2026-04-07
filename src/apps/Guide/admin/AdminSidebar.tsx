import { NavLink } from "@guide/components/NavLink";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@guide/contexts/AuthContext";
import { useSupportQuestions, useFeedback } from "@guide/hooks/use-supabase-query";
import { useOverdueTaskCount } from "@guide/hooks/use-hub-queries";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter, useSidebar,
} from "@guide/components/ui/sidebar";
import { LayoutDashboard, BookOpen, BarChart3, MessageCircle, Star, Settings, LogOut } from "lucide-react";
import { Badge } from "@guide/components/ui/badge";

export function AdminSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { signOut, userRole } = useAuth();
  const navigate = useNavigate();
  const { data: supportQuestions = [] } = useSupportQuestions();
  const { data: feedbackItems = [] } = useFeedback();
  const overdueTaskCount = useOverdueTaskCount();

  const openSupport = supportQuestions.filter((q: any) => !q.resolved).length;
  const openFlags = feedbackItems.filter((f: any) => !f.resolved && f.type === 'flag').length;

  const handleSignOut = async () => {
    await signOut();
    navigate("/login");
  };

  const mainNav = [
    { title: "Dashboard", url: "/guide", icon: LayoutDashboard, badge: 0 },
    { title: "All Guides", url: "/guide/guides", icon: BookOpen, badge: 0 },
    { title: "Reports", url: "/guide/reports", icon: BarChart3, badge: 0 },
    { title: "Support", url: "/guide/support", icon: MessageCircle, badge: openSupport },
    { title: "Feedback", url: "/guide/feedback", icon: Star, badge: openFlags },
  ];

  const manageNav = [
    { title: "Settings", url: "/guide/settings", icon: Settings },
  ];

  return (
    <Sidebar collapsible="icon" className="border-r-0">
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-sidebar-primary flex items-center justify-center">
            <BookOpen className="w-4 h-4 text-sidebar-primary-foreground" />
          </div>
          {!collapsed && <span className="text-lg font-bold text-sidebar-foreground">Guide</span>}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/50 uppercase text-xs tracking-wider">
            {!collapsed && "Main"}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNav.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === "/guide"}
                      className="hover:bg-sidebar-accent text-sidebar-foreground/80"
                      activeClassName="bg-sidebar-accent text-sidebar-foreground font-medium"
                    >
                      <item.icon className="mr-2 h-4 w-4 shrink-0" />
                      {!collapsed && (
                        <span className="flex-1 flex items-center justify-between">
                          {item.title}
                          {item.badge > 0 && (
                            <Badge variant="destructive" className="ml-2 h-5 min-w-[20px] text-[10px] px-1.5">{item.badge}</Badge>
                          )}
                        </span>
                      )}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/50 uppercase text-xs tracking-wider">
            {!collapsed && "Manage"}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {manageNav.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      className="hover:bg-sidebar-accent text-sidebar-foreground/80"
                      activeClassName="bg-sidebar-accent text-sidebar-foreground font-medium"
                    >
                      <item.icon className="mr-2 h-4 w-4 shrink-0" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* ── Contractor Hub ── */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/50 uppercase text-xs tracking-wider">
            {!collapsed && "Modules"}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink
                    to="/hub"
                    className="hover:bg-sidebar-accent text-sidebar-foreground/80"
                    activeClassName="bg-sidebar-accent text-sidebar-foreground font-medium"
                  >
                    <Users className="mr-2 h-4 w-4 shrink-0" />
                    {!collapsed && (
                      <span className="flex-1 flex items-center justify-between">
                        <span className="uppercase text-[11px] tracking-wide font-semibold">
                          Contractor Hub
                        </span>
                        {overdueTaskCount > 0 && (
                          <Badge
                            variant="destructive"
                            className="ml-2 h-5 min-w-[20px] text-[10px] px-1.5"
                          >
                            {overdueTaskCount}
                          </Badge>
                        )}
                      </span>
                    )}
                    {/* Collapsed: show red dot if overdue tasks exist */}
                    {collapsed && overdueTaskCount > 0 && (
                      <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-destructive" />
                    )}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-4">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <button onClick={handleSignOut} className="hover:bg-sidebar-accent text-sidebar-foreground/60 w-full">
                <LogOut className="mr-2 h-4 w-4 shrink-0" />
                {!collapsed && <span>Sign Out</span>}
              </button>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
