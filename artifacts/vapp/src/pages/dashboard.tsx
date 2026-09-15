import { useGetDashboardSummary } from "@workspace/api-client-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Package,
  Users,
  Building2,
  Target,
  CheckCircle2,
  Archive,
  Activity,
  ListTodo,
} from "lucide-react";

export default function Dashboard() {
  const { data: summary, isLoading, isError } = useGetDashboardSummary();

  if (isError) {
    return (
      <div className="p-6 text-center text-destructive">
        Failed to load dashboard summary. Please try again.
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Operational Overview
        </h1>
        <p className="text-muted-foreground mt-2">
          Real-time metrics for Vamberic operations.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {/* Products */}
        <MetricCard
          title="Total Products"
          value={summary?.totalProducts}
          isLoading={isLoading}
          icon={Package}
        />
        <MetricCard
          title="Active Products"
          value={summary?.activeProducts}
          isLoading={isLoading}
          icon={CheckCircle2}
          trend="good"
        />
        <MetricCard
          title="Inactive/Draft"
          value={summary?.draftOrInactiveProducts}
          isLoading={isLoading}
          icon={Archive}
          trend="neutral"
        />

        {/* CRM */}
        <MetricCard
          title="Organisations"
          value={summary?.totalOrganisations}
          isLoading={isLoading}
          icon={Building2}
        />
        <MetricCard
          title="People"
          value={summary?.totalPeople}
          isLoading={isLoading}
          icon={Users}
        />
        <MetricCard
          title="Opportunities"
          value={summary?.totalOpportunities}
          isLoading={isLoading}
          icon={Target}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
        <Card className="border-border/50 shadow-sm h-full min-h-[300px] flex flex-col">
          <CardHeader className="pb-3 border-b border-border/40">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-primary" />
                  Recent Activity
                </CardTitle>
                <CardDescription>
                  Latest changes across the platform
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-muted/10">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4 text-muted-foreground">
              <Activity className="w-6 h-6 opacity-50" />
            </div>
            <h3 className="font-semibold text-foreground mb-1">
              Activity Log Coming Soon
            </h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              We're building a unified timeline to track product updates, CRM
              changes, and system events. This module is currently in
              development.
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/50 shadow-sm h-full min-h-[300px] flex flex-col">
          <CardHeader className="pb-3 border-b border-border/40">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                  <ListTodo className="w-4 h-4 text-primary" />
                  Next Actions
                </CardTitle>
                <CardDescription>
                  Priority tasks requiring attention
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-muted/10">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4 text-muted-foreground">
              <ListTodo className="w-6 h-6 opacity-50" />
            </div>
            <h3 className="font-semibold text-foreground mb-1">
              Task Management Incoming
            </h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Action items, opportunity follow-ups, and approval requests will
              surface here once the workflow engine is integrated.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({
  title,
  value,
  isLoading,
  icon: Icon,
  trend = "neutral",
}: {
  title: string;
  value?: number;
  isLoading: boolean;
  icon: any;
  trend?: "good" | "bad" | "neutral";
}) {
  return (
    <Card className="overflow-hidden border-border/50 bg-card/50 backdrop-blur supports-[backdrop-filter]:bg-card/50">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground/50" />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-8 w-20" />
        ) : (
          <div className="text-3xl font-bold font-mono text-foreground">
            {value?.toLocaleString() ?? 0}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
