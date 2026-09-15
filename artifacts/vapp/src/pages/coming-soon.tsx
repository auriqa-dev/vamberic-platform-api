import { useLocation } from "wouter";
import { Construction } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ComingSoon({ title }: { title: string }) {
  const [, setLocation] = useLocation();

  return (
    <div className="flex flex-col items-center justify-center h-[70vh] animate-in fade-in duration-500">
      <div className="bg-card p-8 rounded-2xl border border-border shadow-sm text-center max-w-md w-full">
        <div className="w-16 h-16 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto mb-6">
          <Construction className="w-8 h-8" />
        </div>
        <h1 className="text-2xl font-bold text-foreground mb-2">{title}</h1>
        <p className="text-muted-foreground mb-8 leading-relaxed">
          This module is currently under construction. Check back soon for
          updates.
        </p>
        <Button
          onClick={() => setLocation("/")}
          variant="outline"
          className="w-full"
        >
          Return to Dashboard
        </Button>
      </div>
    </div>
  );
}
