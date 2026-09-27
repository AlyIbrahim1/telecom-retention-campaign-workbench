import { Link, NavLink } from "react-router-dom";
import eandLogo from "../../assets/brand/eand-logo.png";
import { useAssistant } from "../../features/chat/AssistantContext";
import { Icon, type IconName } from "../atoms/Icon";

const navigation: Array<{ to: string; label: string; icon: IconName; end: boolean }> = [
  { to: "/", label: "Overview", icon: "grid", end: true },
  { to: "/customers", label: "Customers", icon: "users", end: false },
  { to: "/imports", label: "Imports", icon: "upload", end: false },
  { to: "/campaigns", label: "Campaigns", icon: "target", end: false },
];

export function SiteHeader() {
  const assistant = useAssistant();
  return (
      <header className="site-header">
        <div className="site-header-inner">
          <Link className="brand-lockup" to="/" aria-label="Retention Campaign Workbench overview">
            <img className="brand-logo" src={eandLogo} alt="" width={48} height={45} />
            <span className="brand-divider" aria-hidden="true" />
            <span className="brand-copy">
              <span className="brand-name">Retention Workbench</span>
              <span className="brand-kicker">AI &amp; Advanced Analytics</span>
            </span>
          </Link>
          <nav className="primary-nav" aria-label="Primary navigation">
            <ul>
              {navigation.map(({ to, label, icon, end }) => (
                <li key={to}>
                  <NavLink to={to} end={end}>
                    <Icon name={icon} size={18} />
                    <span>{label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <p className="header-context">
            <span className="header-context-dot" aria-hidden="true" />
            Local workspace
          </p>
          <button
            ref={assistant.toggleRef}
            type="button"
            className="assistant-toggle"
            aria-expanded={assistant.open}
            aria-controls="assistant-panel"
            onClick={() => (assistant.open ? assistant.closeAssistant() : assistant.openAssistant())}
          >
            <Icon name="chat" size={18} />
            <span>Assistant</span>
          </button>
        </div>
      </header>
  );
}
