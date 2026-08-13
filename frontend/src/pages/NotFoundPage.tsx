import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <section className="system-state" aria-labelledby="not-found-title">
      <p className="eyebrow">404</p>
      <h1 id="not-found-title">Page not found</h1>
      <p>The address does not match a page in this local workspace.</p>
      <Link className="button-link" to="/">
        Return to overview
      </Link>
    </section>
  );
}
