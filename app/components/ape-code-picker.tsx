"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { APE_CODES } from "@/lib/ape-codes";
import { apeLabel, normalizeApe, searchKey } from "@/lib/ape";

const INDEX = APE_CODES.map(([code, label]) => ({
  code,
  label,
  key: searchKey(`${code} ${code.replace(".", "")} ${label}`),
}));

/** Liste déroulante des 732 codes APE de l'INSEE, filtrable par code ou par libellé. */
export function ApeCodePicker({ name, defaultValue }: { name: string; defaultValue: string | null }) {
  const [value, setValue] = useState(normalizeApe(defaultValue) ?? "");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo(() => {
    const words = searchKey(query).split(/\s+/).filter(Boolean);
    return words.length ? INDEX.filter((item) => words.every((w) => item.key.includes(w))) : INDEX;
  }, [query]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function openList() {
    setQuery("");
    const current = INDEX.findIndex((item) => item.code === value);
    setActive(current >= 0 ? current : 0);
    setOpen(true);
  }

  function choose(code: string) {
    setValue(code);
    setOpen(false);
  }

  const label = apeLabel(value);
  const display = value ? (label ? `${value} — ${label}` : `${value} (code hors nomenclature INSEE)`) : "";

  return (
    <div className="ape-picker">
      <input type="hidden" name={name} value={value} />
      <input
        className="input"
        value={open ? query : display}
        placeholder={open ? "Tapez un code (70.22Z) ou une activité (boulangerie…)" : "— Choisir un code APE —"}
        title={display}
        role="combobox"
        aria-expanded={open}
        onFocus={openList}
        onMouseDown={() => !open && openList()}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!open) openList();
            else setActive((i) => Math.min(i + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter" && open) {
            e.preventDefault();
            if (results[active]) choose(results[active].code);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {value && !open ? (
        <button type="button" className="ape-picker-clear" title="Effacer le code APE" onClick={() => setValue("")}>
          ×
        </button>
      ) : null}
      {open ? (
        <ul className="ape-picker-list" ref={listRef} role="listbox">
          {results.length === 0 ? <li className="ape-picker-empty">Aucun code APE ne correspond.</li> : null}
          {results.map((item, i) => (
            <li
              key={item.code}
              data-index={i}
              role="option"
              aria-selected={item.code === value}
              className={`${i === active ? "active" : ""} ${item.code === value ? "selected" : ""}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(item.code);
              }}
            >
              <strong>{item.code}</strong> {item.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
