import { NavLink, Outlet } from "react-router-dom";

const navigation = [
  { to: "/", label: "Overview", end: true },
  { to: "/customers", label: "Customers", end: false },
  { to: "/imports", label: "Imports", end: false },
  { to: "/campaigns", label: "Campaigns", end: false },
  { to: "/chat", label: "Chat", end: false },
];

export function ApplicationShell() {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <div className="pilot-banner" role="note">
        <span aria-hidden="true">●</span>
        PILOT — SAMPLE OR APPROVED TEST DATA ONLY
      </div>
      <header className="site-header">
        <div className="brand-lockup" aria-label="Retention Campaign Workbench">
          <span className="brand-kicker">Retention</span>
          <span className="brand-name">Campaign Workbench</span>
        </div>
        <p className="header-context">Local decision-support workspace</p>
      </header>
      <nav className="primary-nav" aria-label="Primary navigation">
        <div className="nav-inner">
          {navigation.map(({ to, label, end }) => (
            <NavLink key={to} to={to} end={end}>
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
      <main id="main-content" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="site-footer">
        <p>Model-assisted pilot · No automatic customer outreach</p>
      </footer>
    </div>
  );
}
