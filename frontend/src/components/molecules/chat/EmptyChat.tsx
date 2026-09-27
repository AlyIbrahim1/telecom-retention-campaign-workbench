import { Icon } from "../../atoms/Icon";

const SUGGESTIONS = [
  "Explain this customer's score",
  "What does campaign priority mean?",
  "Suggest a retention idea",
];

export function EmptyChat({ onSuggestion, disabled }: { onSuggestion: (suggestion: string) => void; disabled: boolean }) {
  return (
    <div className="chat-empty">
      <p className="eyebrow">Start with a question</p>
      <h3>Make the next customer decision clearer.</h3>
      <p>Try a suggested question or write your own. Answers keep stored facts, model output, calculated priority, and AI suggestions separate.</p>
      <div className="chat-suggestions" aria-label="Suggested questions">
        {SUGGESTIONS.map((suggestion) => <button key={suggestion} type="button" className="suggestion-chip" disabled={disabled} onClick={() => onSuggestion(suggestion)}><Icon name="spark" size={16} />{suggestion}</button>)}
      </div>
    </div>
  );
}
