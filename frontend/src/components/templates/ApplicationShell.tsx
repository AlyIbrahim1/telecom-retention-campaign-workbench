import { useEffect, useRef } from "react";
import { Outlet, useLocation } from "react-router-dom";

import { AssistantProvider, useAssistant } from "../../features/chat/AssistantContext";
import { AssistantPanel } from "../organisms/AssistantPanel";
import { SiteHeader } from "../organisms/SiteHeader";
import { SiteFooter } from "../organisms/SiteFooter";

export function ApplicationShell() {
  return (
    <AssistantProvider>
      <ShellLayout />
    </AssistantProvider>
  );
}

function ShellLayout() {
  const location = useLocation();
  const assistant = useAssistant();
  const mainRef = useRef<HTMLElement>(null);
  const previousPath = useRef(location.pathname);

  // Move focus to the main region on client-side navigation so keyboard and
  // screen-reader users start at the new page rather than the old nav item.
  useEffect(() => {
    if (previousPath.current === location.pathname) return;
    previousPath.current = location.pathname;
    mainRef.current?.focus({ preventScroll: true });
    if (!navigator.userAgent.includes("jsdom")) window.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <div className={`app-shell${assistant.open ? " assistant-open" : ""}`}>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <SiteHeader />
      <div className="shell-body">
      <div className="shell-content">
      <main id="main-content" ref={mainRef} tabIndex={-1}>
        <div className="main-inner">
          <Outlet />
        </div>
      </main>
      <SiteFooter />
      </div>
      {assistant.open && <div className="assistant-backdrop" aria-hidden="true" onClick={assistant.closeAssistant} />}
      <AssistantPanel />
      </div>
    </div>
  );
}
