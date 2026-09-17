import { Route, Switch, useLocation, Router as WouterRouter } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary } from "@/components/error-boundary";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AppLayout } from "@/components/layout";

// Pages
import Dashboard from "@/pages/dashboard";
import ProductsList from "@/pages/products/list";
import ProductDetail from "@/pages/products/detail";
import ComingSoon from "@/pages/coming-soon";

import { queryClient } from "./lib/query-client";

function Router() {
  return (
    <AppLayout>
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/" component={Dashboard} />

          <Route path="/products" component={ProductsList} />
          <Route path="/products/:id" component={ProductDetail} />

          <Route path="/people">
            <ComingSoon title="People" />
          </Route>
          <Route path="/organisations">
            <ComingSoon title="Organisations" />
          </Route>
          <Route path="/opportunities">
            <ComingSoon title="Opportunities" />
          </Route>
          <Route path="/campaigns">
            <ComingSoon title="Campaigns" />
          </Route>
          <Route path="/subscriptions">
            <ComingSoon title="Subscriptions" />
          </Route>
          <Route path="/events">
            <ComingSoon title="Events" />
          </Route>
          <Route path="/settings">
            <ComingSoon title="Settings" />
          </Route>

          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    </AppLayout>
  );
}

function RoutedErrorBoundary({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
