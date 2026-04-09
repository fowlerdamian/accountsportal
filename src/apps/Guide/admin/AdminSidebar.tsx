import { NavLink } from "@guide/components/NavLink";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@guide/contexts/AuthContext";
import { useSupportQuestions, useFeedback } from "@guide/hooks/use-supabase-query";
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
        <Link to="/dashboard" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{ width: "4px", height: "18px", borderRadius: "2px", background: "#f3ca0f", flexShrink: 0 }} />
          {!collapsed && (
            <span style={{ fontSize: "12px", fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "#ffffff" }}>
              Dashboard
            </span>
          )}
        </Link>
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
