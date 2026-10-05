import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import PublicQuoteView from "../../../src/pages/PublicQuoteView";
import "../../../src/index.css";

createRoot(document.getElementById("root")).render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <PublicQuoteView />
    <Toaster />
  </QueryClientProvider>,
);
