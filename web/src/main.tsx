import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import { ApiError } from "./api/client";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 認證錯誤不重試——重試也不會變成有權限
      retry: (failureCount, error) =>
        !(error instanceof ApiError && (error.isAuthError || error.status === 403)) &&
        failureCount < 2,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
