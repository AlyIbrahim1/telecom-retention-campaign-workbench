import { Link, NavLink, Outlet } from "react-router-dom";

const navigation = [
  { to: "/", label: "Overview", index: "01", end: true },
  { to: "/customers", label: "Customers", index: "02", end: false },
  { to: "/imports", label: "Imports", index: "03", end: false },
  { to: "/campaigns", label: "Campaigns", index: "04", end: false },
  { to: "/chat", label: "Assistant", index: "05", end: false },
];

export function ApplicationShell() {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="site-header">
        <div className="masthead-inner">
          <Link className="brand-lockup" to="/" aria-label="Retention Campaign Workbench overview">
            <span className="product-mark" aria-hidden="true"><span>R</span></span>
            <span className="brand-copy">
              <span className="brand-kicker">Retention intelligence</span>
              <span className="brand-name">Campaign Workbench</span>
            </span>
          </Link>
          <nav className="primary-nav" aria-label="Primary navigation">
            {navigation.map(({ to, label, index, end }) => (
              <NavLink key={to} to={to} end={end}>
                <span className="nav-index" aria-hidden="true">{index}</span>
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>
          <p className="header-context"><span aria-hidden="true" />Decision operations</p>
        </div>
      </header>
      <main id="main-content" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="site-footer">
        <div>
          <strong>Retention Campaign Workbench</strong>
          <p>Model-informed insight. Human-led decisions.</p>
        </div>
        <p className="footer-meta">Customer retention operations</p>
      </footer>
    </div>
  );
}
