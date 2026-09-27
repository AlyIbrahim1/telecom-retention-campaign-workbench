import eandLogo from "../../assets/brand/eand-logo.png";

export function SiteFooter() {
  return (
      <footer className="site-footer">
        <div className="site-footer-inner">
          <div className="footer-brand">
            <img className="brand-logo brand-logo-footer" src={eandLogo} alt="e& logo" width={56} height={52} />
            <div>
              <strong>Retention Campaign Workbench</strong>
              <p>Model-informed insight. Human-led decisions.</p>
            </div>
          </div>
          <ul className="footer-facts" aria-label="Workspace boundaries">
            <li>No email, SMS, or calls are sent from this workspace.</li>
            <li>Scores rank customers for review; they do not prove churn or savings.</li>
            <li>Local internship demonstration without authentication.</li>
          </ul>
        </div>
      </footer>
  );
}
