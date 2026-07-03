import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StellarWalletProvider } from "./stellar-wallet-provider";
import { ThemeProvider } from "./theme-provider";

interface RootProviderProps {
  children: ReactNode;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export default function RootProvider({ children }: RootProviderProps) {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        {/* Stellar in-app wallet — the active identity for the family treasury. */}
        <StellarWalletProvider>{children}</StellarWalletProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
