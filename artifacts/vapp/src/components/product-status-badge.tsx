import { Badge } from "@/components/ui/badge";

export function ProductStatusBadge({ status }: { status: string }) {
  let variant: "default" | "secondary" | "destructive" | "outline" = "outline";
  let colorClass = "";

  switch (status) {
    case "active":
      variant = "default";
      colorClass = "bg-primary text-primary-foreground hover:bg-primary/90";
      break;
    case "idea":
      variant = "secondary";
      colorClass =
        "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800";
      break;
    case "validation":
      variant = "secondary";
      colorClass =
        "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-800";
      break;
    case "paused":
      variant = "secondary";
      colorClass =
        "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700";
      break;
    case "retired":
      variant = "destructive";
      break;
  }

  return (
    <Badge
      variant={variant}
      className={`uppercase text-[10px] font-bold tracking-wider ${colorClass}`}
    >
      {status}
    </Badge>
  );
}
