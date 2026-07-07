import { QueryClient } from "@tanstack/react-query";

/** Shared TanStack Query client for localApi-backed hooks. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
