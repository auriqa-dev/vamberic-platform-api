import { useAuth } from "@/auth/provider";
import * as React from "react";
import { useLocation } from "wouter";
import { Menu } from "lucide-react";
import { PortfolioNavigation } from "./portfolio-panels";
import logoImg from "@/assets/vamberic-lion.png";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
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

      <PortfolioNavigation location={location} />
      <p className="p-4 border-t border-sidebar-border text-xs text-sidebar-foreground/60">
        Portfolio oversight
      </p>
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
              aria-label="Open navigation"
              className="md:hidden text-foreground"
              onClick={() => setIsMobileMenuOpen(true)}
            >
              <Menu className="w-5 h-5" />
            </Button>

            <span className="text-sm text-muted-foreground">
              Vamberic portfolio
            </span>
          </div>

          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={() => void auth.signOut()}>
              Sign out
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
