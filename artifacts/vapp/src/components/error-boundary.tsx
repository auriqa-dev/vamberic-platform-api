import { AlertTriangle } from "lucide-react";
import { Component, type ReactNode } from "react";
import { Button } from "./ui/button";

interface Props {
  children?: ReactNode;
  resetKey?: any;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidUpdate(prevProps: Props) {
    if (this.props.resetKey !== prevProps.resetKey) {
      this.setState({ hasError: false, error: null });
    }
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[50vh] w-full flex-col items-center justify-center p-6 text-center">
          <div className="flex max-w-md flex-col items-center space-y-4 rounded-xl border border-destructive/20 bg-destructive/5 p-8">
            <div className="rounded-full bg-destructive/10 p-3 text-destructive">
              <AlertTriangle className="h-8 w-8" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-semibold tracking-tight text-foreground">
                Something went wrong
              </h2>
              <p className="text-sm text-muted-foreground">
                An unexpected error occurred while rendering this page.
              </p>
              {this.state.error && (
                <div className="mt-4 max-h-[200px] overflow-auto rounded bg-background p-4 text-left text-xs font-mono text-muted-foreground">
                  {this.state.error.message}
                </div>
              )}
            </div>
            <Button
              variant="outline"
              onClick={() => this.setState({ hasError: false, error: null })}
              className="mt-4"
            >
              Try again
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
