import type { ChatEvidence, ChatMessage } from "../../../api/chat";

export function ChatMessageView({ message }: { message: ChatMessage }) {
  return (
    <article className={`chat-message chat-message-${message.role}`} aria-label={`${message.role === "user" ? "You" : message.role === "assistant" ? "Assistant" : "System"} message`}>
      <div className="chat-message-meta"><strong>{message.role === "user" ? "You" : message.role === "assistant" ? "Assistant" : "Workspace"}</strong>{message.created_at ? <time dateTime={message.created_at}>{new Date(message.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time> : null}</div>
      <p>{message.content}</p>
      {message.evidence.length > 0 && <div className="chat-evidence" aria-label="Answer sources">{message.evidence.map((item, index) => <EvidenceBlock key={`${item.kind}-${index}`} evidence={item} />)}</div>}
    </article>
  );
}

function EvidenceBlock({ evidence }: { evidence: ChatEvidence }) {
  return <section className={`evidence-block evidence-${evidence.kind}`}><strong>{evidence.label}</strong><p>{evidence.content}</p></section>;
}
