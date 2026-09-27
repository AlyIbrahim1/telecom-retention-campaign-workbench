import { Link } from "react-router-dom";
import { Icon } from "../../atoms/Icon";
import { StateScreen } from "../StateScreen";

export function ImportErrorState({ title, message, retry, back = true }: { title: string; message: string; retry?: () => void; back?: boolean }) {
  return (
    <StateScreen
      icon="alert"
      alert
      eyebrow="Data operations"
      title={title}
      titleId="import-error-title"
      crumbs={[{ label: "Overview", to: "/" }, { label: "Imports", to: "/imports" }, { label: title }]}
      message={<p>{message}</p>}
      actions={
        <>
          {retry && <button type="button" onClick={retry}><Icon name="refresh" size={18} />Try again</button>}
          {back && <Link className="button-link button-secondary" to="/imports"><Icon name="arrowLeft" size={18} />Back to imports</Link>}
        </>
      }
    />
  );
}
