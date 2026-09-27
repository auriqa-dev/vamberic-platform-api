import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
  Redirect,
} from "wouter";
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
import {
  PeopleList,
  PersonDetail,
  OrganisationsList,
  OrganisationDetail,
  OpportunitiesList,
  OpportunityDetail,
} from "@/pages/crm";

import { queryClient } from "./lib/query-client";

function Router() {
  return (
    <AppLayout>
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/" component={Dashboard} />

          <Route path="/products" component={ProductsList} />
          <Route path="/products/:id" component={ProductDetail} />

          <Route path="/people" component={PeopleList} />
          <Route path="/people/:id" component={PersonDetail} />
          <Route path="/organisations" component={OrganisationsList} />
          <Route path="/organisations/:id" component={OrganisationDetail} />
          <Route path="/opportunities" component={OpportunitiesList} />
          <Route path="/opportunities/:id" component={OpportunityDetail} />
          {/* Preserve old bookmarks without advertising unimplemented operations. */}
          {["/campaigns", "/subscriptions", "/events", "/settings"].map(
            (path) => (
              <Route key={path} path={path}>
                <Redirect to="/" />
              </Route>
            ),
          )}

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
