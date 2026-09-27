import type { ListQuery } from "../../../api/customers";
import { Icon } from "../../atoms/Icon";

type SortField = ListQuery["sort"];

export function SortButton({
  label,
  field,
  active,
  order,
  onSort,
}: {
  label: string;
  field: SortField;
  active: boolean;
  order: ListQuery["order"];
  onSort: (field: SortField) => void;
}) {
  return (
    <button
      type="button"
      className={`table-sort${active ? " table-sort-active" : ""}`}
      aria-label={`Sort by ${label}`}
      aria-pressed={active}
      onClick={() => onSort(field)}
    >
      {label}
      <Icon name={active ? (order === "asc" ? "sortUp" : "sortDown") : "sort"} size={14} />
    </button>
  );
}

export function ariaSort(active: boolean, order: ListQuery["order"]) {
  return active ? (order === "asc" ? "ascending" : "descending") : "none";
}
