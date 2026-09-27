import { Link } from "react-router-dom";

import { Icon, StateScreen } from "../components/index";

export function NotFoundPage() {
  return (
    <StateScreen
      icon="search"
      eyebrow="404"
      title="Page not found"
      titleId="not-found-title"
      message={<p>We could not find that page. It may have moved, or the link may be incomplete. Return to the overview or choose a section from the navigation.</p>}
      actions={
        <>
          <Link className="button-link" to="/">
            Return to overview
          </Link>
          <Link className="button-link button-secondary" to="/customers">
            <Icon name="users" size={18} />
            Customers
          </Link>
        </>
      }
    />
  );
}
