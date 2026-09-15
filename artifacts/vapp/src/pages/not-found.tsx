import { Button } from "@/components/ui/button";
import { FileQuestion } from "lucide-react";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, setLocation] = useLocation();

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] text-center px-4 animate-in fade-in duration-500">
      <div className="bg-muted/30 p-6 rounded-full mb-6">
        <FileQuestion className="w-12 h-12 text-muted-foreground" />
      </div>
      <h1 className="text-3xl font-bold tracking-tight mb-2 text-foreground">
        Page not found
      </h1>
      <p className="text-muted-foreground max-w-md mx-auto mb-8">
        The page you are looking for doesn't exist or has been moved.
      </p>
      <Button onClick={() => setLocation("/")}>Return to Dashboard</Button>
    </div>
  );
}
