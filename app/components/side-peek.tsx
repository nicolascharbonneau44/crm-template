"use client";

import { useEffect, useState } from "react";

const WIDTH_KEY = "crm-side-peek-width";
const MIN_WIDTH = 380;
const DEFAULT_WIDTH = 560;

function readWidth() {
  try {
    const saved = Number(window.localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(saved) && saved >= MIN_WIDTH ? saved : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

export function SidePeek({
  open,
  title,
  onClose,
  children,
  actions,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [resizing, setResizing] = useState(false);

  useEffect(() => {
    setWidth(readWidth());
  }, []);

  function startResize(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    setResizing(true);
    let latest = width;
    const move = (e: PointerEvent) => {
      latest = Math.round(Math.min(window.innerWidth * 0.95, Math.max(MIN_WIDTH, window.innerWidth - e.clientX)));
      setWidth(latest);
    };
    const stop = () => {
      setResizing(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      try {
        window.localStorage.setItem(WIDTH_KEY, String(latest));
      } catch {
        // stockage indisponible : la largeur n'est simplement pas mémorisée
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }

  if (!open) return null;
  return (
    <>
      <div className="side-peek-overlay" onClick={onClose} />
      <aside
        className={`side-peek ${resizing ? "resizing" : ""}`}
        role="dialog"
        aria-modal="true"
        style={{ width: `min(${width}px, 100vw)` }}
      >
        <div
          className="side-peek-resize"
          onPointerDown={startResize}
          onDoubleClick={() => {
            setWidth(DEFAULT_WIDTH);
            try {
              window.localStorage.removeItem(WIDTH_KEY);
            } catch {
              // ignoré
            }
          }}
          role="separator"
          aria-orientation="vertical"
          aria-label="Élargir ou réduire le panneau (double-clic : taille par défaut)"
          title="Glisser pour élargir · double-clic : taille par défaut"
        />
        <header className="side-peek-header">
          <div>
            <h2>{title}</h2>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {actions}
            <button className="btn ghost small" type="button" onClick={onClose} aria-label="Fermer">
              ✕
            </button>
          </div>
        </header>
        <div className="side-peek-body">{children}</div>
      </aside>
    </>
  );
}
