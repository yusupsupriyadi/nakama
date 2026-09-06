import { Outlet, useLocation } from "react-router-dom";
import { AppSidebar } from "@/components/AppSidebar";
import { CommandPalette } from "@/components/CommandPalette";
import { MobileNavDrawer } from "@/components/MobileNavDrawer";
import { ProfileRail } from "@/components/ProfileRail";
import { RouteBoundary } from "@/components/RouteBoundary";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ActiveChatProfileProvider } from "@/context/active-chat-profile-context";
import { useAppContext } from "@/context/use-app-context";
import { findNavItem, PAGE_PATHS, pageIdFromPath } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { AgentWorkTabs } from "@/pages/automations/agent-work-tabs";

/** Pages that draw their own header content into the actions slot. */
const SELF_TITLED_PAGES = new Set(["profiles", "soul"]);
/** Pages that own their scrolling instead of scrolling the main column. */
const FULL_HEIGHT_PAGES = new Set(["automations", "chat", "files", "tasks"]);

export function Layout() {
  const location = useLocation();
  const page = pageIdFromPath(location.pathname) ?? "chat";
  const { error } = useAppContext();
  const activeNav = findNavItem(page);
  const selfTitled = SELF_TITLED_PAGES.has(page);
  const playground = location.pathname.startsWith(
    `${PAGE_PATHS.soul}/playground/`
  );
  const fullHeight = FULL_HEIGHT_PAGES.has(page) || playground;
  const padded = !(
    fullHeight || location.pathname.startsWith(`${PAGE_PATHS.profiles}/skills/`)
  );

  return (
    <TooltipProvider delay={0}>
      <ActiveChatProfileProvider>
        <div className="flex h-svh overflow-hidden bg-background pl-[env(safe-area-inset-left)]">
          {/* The rail and sidebar cost a fixed 296px, so on a phone they live
              in MobileNavDrawer instead of the layout. */}
          <div className="hidden h-full sm:flex">
            <ProfileRail />
            <AppSidebar />
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pr-[env(safe-area-inset-right)]">
            <header
              className={cn(
                "app-shell-header gap-2 bg-card px-3 sm:gap-4 sm:px-6",
                // Chat gives its whole column to the conversation on desktop;
                // on a phone the bar is the only way to reach navigation.
                page === "chat" && "sm:hidden"
              )}
            >
              <MobileNavDrawer className="sm:hidden" />

              {page === "automations" ? (
                <AgentWorkTabs />
              ) : selfTitled ? null : (
                <h1 className="type-brand min-w-0 truncate">
                  {activeNav?.label}
                </h1>
              )}

              <div
                className={cn(
                  "flex h-full min-w-0 shrink-0 items-stretch gap-2",
                  !selfTitled && "ml-auto"
                )}
                data-page-header-actions
              />
            </header>

            {error ? (
              <div className="shrink-0 border-red-200 border-b bg-red-50 px-4 py-3 text-red-800 text-sm sm:px-6 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
                {error}
              </div>
            ) : null}

            <main
              className={cn(
                "min-h-0 flex-1",
                fullHeight
                  ? "flex flex-col overflow-hidden"
                  : "overflow-y-auto overflow-x-hidden",
                padded && "p-4 sm:p-6"
              )}
            >
              <RouteBoundary resetKey={location.pathname}>
                <Outlet />
              </RouteBoundary>
            </main>
          </div>
        </div>

        <CommandPalette />
      </ActiveChatProfileProvider>
    </TooltipProvider>
  );
}
