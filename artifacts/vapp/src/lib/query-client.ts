import { QueryClient } from "@tanstack/react-query";
import { AuthenticationRequiredError } from "@workspace/api-client-react";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) =>
        !(error instanceof AuthenticationRequiredError) && failureCount < 3,
    },
  },
});
