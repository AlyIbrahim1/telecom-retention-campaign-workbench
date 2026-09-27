import { Link } from "react-router-dom";
import { Icon } from "../../atoms/Icon";
import { StateScreen } from "../StateScreen";

export function ErrorState({
  title,
  message,
  onRetry,
  backToCustomers = true,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
  backToCustomers?: boolean;
}) {
  return (
    <StateScreen
      icon="alert"
      alert
      eyebrow="Customer records"
      title={title}
      titleId="customer-error-title"
      crumbs={[{ label: "Overview", to: "/" }, { label: "Customers", to: "/customers" }, { label: title }]}
      message={<p>{message}</p>}
      actions={
        <>
          {onRetry && <button type="button" onClick={onRetry}><Icon name="refresh" size={18} />Try again</button>}
          {backToCustomers && <Link className="button-link button-secondary" to="/customers"><Icon name="arrowLeft" size={18} />Back to customers</Link>}
        </>
      }
    />
  );
}
