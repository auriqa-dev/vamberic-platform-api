import * as React from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Package,
  Users,
  Building2,
  Target,
  Megaphone,
  CreditCard,
  Calendar,
  Settings,
  Menu,
  X,
  Bell,
  Search,
} from "lucide-react";
import logoImg from "@/assets/vamberic-lion.png";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Products", href: "/products", icon: Package },
  { name: "People", href: "/people", icon: Users },
  { name: "Organisations", href: "/organisations", icon: Building2 },
  { name: "Opportunities", href: "/opportunities", icon: Target },
  { name: "Campaigns", href: "/campaigns", icon: Megaphone },
  { name: "Subscriptions", href: "/subscriptions", icon: CreditCard },
  { name: "Events", href: "/events", icon: Calendar },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);

  // Close mobile menu on route change
  React.useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location]);

  const SidebarContent = () => (
    <>
      <div className="h-16 flex items-center px-6 border-b border-sidebar-border gap-3 flex-shrink-0">
        <img
          src={logoImg}
          alt="Vamberic Logo"
          className="w-8 h-8 object-contain"
        />
        <span className="font-sans font-bold text-lg text-sidebar-foreground tracking-tight">
          Vamberic
        </span>
      </div>

      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
        {navigation.map((item) => {
          const isActive =
            location === item.href ||
            (item.href !== "/" && location.startsWith(item.href));
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
              )}
            >
              <item.icon
                className={cn(
                  "w-4 h-4",
                  isActive
                    ? "text-sidebar-primary"
                    : "text-sidebar-foreground/50",
                )}
              />
              {item.name}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-sidebar-border flex-shrink-0">
        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
            location.startsWith("/settings")
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
          )}
        >
          <Settings className="w-4 h-4 text-sidebar-foreground/50" />
          Settings
        </Link>
      </div>
    </>
  );

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-64 bg-sidebar border-r border-sidebar-border flex-col flex-shrink-0">
        <SidebarContent />
      </aside>

      {/* Mobile Sidebar Overlay */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Mobile Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 bg-sidebar flex flex-col transition-transform duration-300 ease-in-out md:hidden",
          isMobileMenuOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <SidebarContent />
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Top Header Bar */}
        <header className="h-16 border-b border-border bg-card flex items-center justify-between px-4 lg:px-8 flex-shrink-0">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden text-foreground"
              onClick={() => setIsMobileMenuOpen(true)}
            >
              <Menu className="w-5 h-5" />
            </Button>

            <div className="hidden sm:flex items-center text-sm text-muted-foreground bg-muted/50 rounded-md px-3 py-1.5 border border-border/50">
              <Search className="w-4 h-4 mr-2 opacity-50" />
              <span className="opacity-70">Press ⌘K to search...</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground relative"
            >
              <Bell className="w-5 h-5" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-primary rounded-full ring-2 ring-card" />
            </Button>

            <div className="w-8 h-8 rounded-full bg-sidebar-primary text-sidebar-primary-foreground flex items-center justify-center font-bold text-sm ml-2">
              VA
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="container mx-auto max-w-6xl p-4 lg:p-8">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
