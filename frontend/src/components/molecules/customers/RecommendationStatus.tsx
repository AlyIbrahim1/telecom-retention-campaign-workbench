import { Badge } from "../../atoms/Badge";

export function RecommendationStatus({ recommended }: { recommended: boolean | null | undefined }) {
  if (recommended === null || recommended === undefined) {
    return <Badge tone="neutral" icon="–">Not scored</Badge>;
  }
  return recommended ? (
    <Badge tone="brand" icon="●">Recommended for review</Badge>
  ) : (
    <Badge tone="neutral" icon="○">Below review threshold</Badge>
  );
}
