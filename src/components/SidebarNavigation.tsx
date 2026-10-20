"use client";
import { useEffect, useId, useState } from "react";
import MenuIcon from "./MenuIcon";
const defaults = [
  { id: "overview", label: "Overview", pages: ["Dashboard", "Manage data"] },
  {
    id: "people",
    label: "People",
    pages: ["People", "Forms", "Imports", "Photos", "Locations"],
  },
  {
    id: "cards",
    label: "Cards & printing",
    pages: ["Templates", "Cards", "Jobs", "Exports"],
  },
  {
    id: "admin",
    label: "Administration",
    pages: ["Organization", "Privacy", "Recycle bin", "Audit", "System"],
  },
  { id: "start", label: "Getting started", pages: ["Setup"] },
];
type Section = (typeof defaults)[number];
function normalize(raw: unknown): Section[] {
  if (!Array.isArray(raw)) return structuredClone(defaults);
  const result: Section[] = [];
  for (const entry of raw) {
    const original = defaults.find((s) => s.id === entry?.id);
    if (!original || result.some((s) => s.id === original.id)) continue;
    const pages = Array.isArray(entry.pages)
      ? entry.pages.filter(
          (p: unknown) => typeof p === "string" && original.pages.includes(p),
        )
      : [];
    result.push({
      ...original,
      pages: [...new Set<string>([...pages, ...original.pages])],
    });
  }
  return [
    ...result,
    ...structuredClone(
      defaults.filter((s) => !result.some((r) => r.id === s.id)),
    ),
  ];
}
export default function SidebarNavigation({
  user,
  active,
  canAdmin,
  superAdmin,
  onSelect,
}: {
  user: string;
  active: string;
  canAdmin: boolean;
  superAdmin: boolean;
  onSelect: (page: string) => void;
}) {
  const [sections, setSections] = useState<Section[]>(() =>
      structuredClone(defaults),
    ),
    [editing, setEditing] = useState(false),
    [open, setOpen] = useState(false),
    [message, setMessage] = useState(""),
    [query, setQuery] = useState("");
  const navId = useId(),
    key = `idcard.navigation.${user}`;
  useEffect(() => {
    try {
      setSections(normalize(JSON.parse(localStorage.getItem(key) || "null")));
    } catch {
      setSections(structuredClone(defaults));
    }
  }, [key]);
  const allowed = (page: string) =>
    page === "System"
      ? superAdmin
      : ["Audit", "Privacy", "Forms", "Recycle bin"].includes(page)
        ? canAdmin
        : true;
  function save(next: Section[]) {
    setSections(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
      setMessage("Menu order saved on this device.");
    } catch {
      setMessage(
        "Menu arranged for this session. Browser storage is unavailable.",
      );
    }
  }
  function move(sectionId: string, page: string | null, direction: number) {
    const next = structuredClone(sections),
      sectionIndex = next.findIndex((s) => s.id === sectionId);
    if (page === null) {
      const target = sectionIndex + direction;
      if (target < 0 || target >= next.length) return;
      [next[sectionIndex], next[target]] = [next[target], next[sectionIndex]];
    } else {
      const pages = next[sectionIndex].pages,
        index = pages.indexOf(page),
        visible = pages.filter(allowed),
        targetPage = visible[visible.indexOf(page) + direction];
      if (!targetPage) return;
      const target = pages.indexOf(targetPage);
      [pages[index], pages[target]] = [pages[target], pages[index]];
    }
    save(next);
  }
  return (
    <div
      className={`sidebar-navigation${editing ? " is-editing" : ""}`}
      data-mobile-open={open}
    >
      <div className="navigation-tools">
        <button
          type="button"
          className="mobile-menu-toggle"
          aria-expanded={open}
          aria-controls={navId}
          onClick={() => {
            setOpen(!open);
            setEditing(false);
          }}
        >
          {open ? "Close menu" : "Open menu"}
        </button>
        <button
          type="button"
          aria-pressed={editing}
          onClick={() => {
            setEditing(!editing);
            setOpen(true);
            setMessage("");
          }}
        >
          {editing ? "Done arranging" : "Arrange menu"}
        </button>
        {editing && (
          <button
            type="button"
            onClick={() => {
              save(structuredClone(defaults));
              setMessage("Default menu order restored.");
            }}
          >
            Reset menu
          </button>
        )}
      </div>
      {!editing && (
        <label className="navigation-search">
          Find a menu
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search menus…"
            aria-controls={navId}
          />
        </label>
      )}
      {editing && (
        <p className="navigation-help">
          Use the arrows to move sections or pages. Your order is saved on this
          device.
        </p>
      )}
      <nav id={navId} aria-label="Main navigation">
        {sections.map((section, index) => {
          const pages = section.pages.filter(
            (page) =>
              allowed(page) &&
              (editing ||
                page.toLowerCase().includes(query.trim().toLowerCase())),
          );
          if (!pages.length) return null;
          return (
            <section
              className="nav-section"
              key={section.id}
              aria-label={section.label}
            >
              <div className="nav-section-heading">
                <h2>{section.label}</h2>
                {editing && (
                  <div className="reorder-controls">
                    <button
                      type="button"
                      aria-label={`Move ${section.label} section up`}
                      disabled={index === 0}
                      onClick={() => move(section.id, null, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${section.label} section down`}
                      disabled={index === sections.length - 1}
                      onClick={() => move(section.id, null, 1)}
                    >
                      ↓
                    </button>
                  </div>
                )}
              </div>
              {pages.map((page, pageIndex) => (
                <div className="nav-row" key={page}>
                  <button
                    type="button"
                    aria-label={page}
                    aria-current={active === page ? "page" : undefined}
                    className={active === page ? "nav active" : "nav"}
                    onClick={() => {
                      onSelect(page);
                      setOpen(false);
                      setEditing(false);
                      setQuery("");
                    }}
                  >
                    <MenuIcon name={page} />
                    <span className="nav-label">{page}</span>
                    {active === page && <b aria-hidden="true">•</b>}
                  </button>
                  {editing && (
                    <div className="reorder-controls">
                      <button
                        type="button"
                        aria-label={`Move ${page} up`}
                        disabled={pageIndex === 0}
                        onClick={() => move(section.id, page, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${page} down`}
                        disabled={pageIndex === pages.length - 1}
                        onClick={() => move(section.id, page, 1)}
                      >
                        ↓
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </section>
          );
        })}
        {!editing &&
          query &&
          !sections.some((s) =>
            s.pages.some(
              (p) =>
                allowed(p) &&
                p.toLowerCase().includes(query.trim().toLowerCase()),
            ),
          ) && (
            <p className="navigation-help" role="status">
              No matching menus.
            </p>
          )}
      </nav>
      <span className="navigation-announcement" role="status">
        {message}
      </span>
    </div>
  );
}
