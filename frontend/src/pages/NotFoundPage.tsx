import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <section className="system-state" aria-labelledby="not-found-title">
      <p className="eyebrow">404</p>
      <h1 id="not-found-title">Page not found</h1>
      <p>We could not find that page. Return to the overview or choose a section from the navigation.</p>
      <Link className="button-link" to="/">
        Return to overview
      </Link>
    </section>
  );
}
