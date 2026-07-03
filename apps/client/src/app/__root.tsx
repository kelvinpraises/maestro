import { createRootRoute, Outlet, useLocation } from "@tanstack/react-router";
import RootProvider from "@/providers";
import { Toaster } from "@/components/molecules/sonner";
import { AuthGuard } from "@/components/organisms/auth-guard";
import { BottomNav } from "@/components/molecules/bottom-nav";
import "@/styles/globals.css";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  const location = useLocation();
  const isHomePage = location.pathname === "/";
  const isFullscreenRoute =
    location.pathname.startsWith("/join") ||
    location.pathname.startsWith("/claim-link");

  if (isHomePage || isFullscreenRoute) {
    // Kid-facing entry points (family invite, reward claim link) render on their
    // own, without the app shell chrome.
    return (
      <RootProvider>
        <Outlet />
        <Toaster />
      </RootProvider>
    );
  }

  // Maestro mobile shell: a centered phone-width column on the pale-lavender
  // dot-grid canvas, with the playful bottom nav.
  return (
    <RootProvider>
      <AuthGuard>
        <div className="bg-maestro-canvas min-h-dvh w-full">
          <div className="relative mx-auto flex min-h-dvh w-full max-w-md flex-col">
            <main className="flex-1 px-5 pb-32 pt-6">
              <Outlet />
            </main>
            <BottomNav />
          </div>
        </div>
      </AuthGuard>
      <Toaster />
      {/* <TanStackRouterDevtools /> */}
    </RootProvider>
  );
}
