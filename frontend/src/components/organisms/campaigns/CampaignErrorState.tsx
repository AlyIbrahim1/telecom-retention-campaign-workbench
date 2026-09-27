import { Link } from "react-router-dom";
import { Icon } from "../../atoms/Icon";
import { StateScreen } from "../StateScreen";

export function CampaignErrorState({ title, message, retry, back = true }: { title: string; message: string; retry?: () => void; back?: boolean }) {
  return (
    <StateScreen
      icon="alert"
      alert
      eyebrow="Campaign workbench"
      title={title}
      titleId="campaign-error-title"
      crumbs={[{ label: "Overview", to: "/" }, { label: "Campaigns", to: "/campaigns" }, { label: title }]}
      message={<p>{message}</p>}
      actions={<>
        {retry && <button type="button" onClick={retry}><Icon name="refresh" size={18} />Try again</button>}
        {back && <Link className="button-link button-secondary" to="/campaigns"><Icon name="arrowLeft" size={18} />Back to campaigns</Link>}
      </>}
    />
  );
}
