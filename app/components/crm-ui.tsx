"use client";

import { useState } from "react";

/** Menu déroulant coloré selon la valeur choisie (catégorie, état, statut…). */
export function TintedSelect({
  name,
  defaultValue,
  options,
  colorOf,
  onChange,
  style,
}: {
  name?: string;
  defaultValue: string;
  options: { value: string; label: string }[];
  colorOf: (value: string) => string | undefined;
  onChange?: (value: string) => void;
  style?: React.CSSProperties;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <select
      className={`select ${colorOf(value) ?? ""}`}
      name={name}
      value={value}
      style={style}
      onChange={(e) => {
        setValue(e.target.value);
        onChange?.(e.target.value);
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Pastille cochable : verte si l'action est faite, orange si elle reste à faire. */
export function DoneToggle({ done, onToggle }: { done: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`done-toggle ${done ? "done" : ""}`}
      aria-pressed={done}
      title={done ? "Fait — cliquer pour remettre à faire" : "À faire — cliquer pour marquer comme fait"}
      aria-label={done ? "Marquer comme à faire" : "Marquer comme fait"}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      ✓
    </button>
  );
}
