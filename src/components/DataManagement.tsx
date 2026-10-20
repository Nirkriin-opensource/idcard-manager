"use client";
import { useState } from "react";
import MenuIcon from "./MenuIcon";

const resources = [
  {
    page: "Recycle bin",
    title: "Recycle bin",
    description:
      "Restore deleted people or photos, or preview permanent removal after work is complete.",
    actions: "Select · Restore · Preview purge · Empty category",
    roles: ["ORG_ADMIN"],
    admin:
      "Permanent purge removes the previewed linked card data. Shared assets and existing backups are retained.",
  },
  {
    page: "People",
    title: "People",
    description:
      "Add a person, edit details, or select records to delete and restore.",
    actions: "Create · Edit · Bulk delete · Restore",
    roles: ["ORG_ADMIN", "OPERATOR"],
    admin: "Bulk delete and restore require an administrator.",
  },
  {
    page: "Forms",
    title: "Forms & responses",
    description:
      "Create and edit forms, open or close collection, and review responses before adding people.",
    actions: "Create · Edit · Close / reopen · Approve / reject",
    roles: ["ORG_ADMIN"],
    admin:
      "Closing a form preserves its responses. Changing the share link revokes the old link.",
  },
  {
    page: "Imports",
    title: "Spreadsheet imports",
    description:
      "Download one import kit, upload a spreadsheet, match columns and validate before importing.",
    actions: "Upload · Preview · Validate · Import",
    roles: ["ORG_ADMIN", "OPERATOR"],
    admin:
      "Correct imported records in People. Import history is not an undo button.",
  },
  {
    page: "Photos",
    title: "Photos",
    description:
      "Upload images, preview bulk matches and link photos to the correct people.",
    actions: "Upload · Match · Crop · Bulk delete · Restore",
    roles: ["ORG_ADMIN", "OPERATOR", "DESIGNER"],
    admin:
      "Bulk delete and restore require an administrator. Restored photos need matching again.",
  },
  {
    page: "Templates",
    title: "Card templates",
    description:
      "Create and edit the front and back, preview a person, or archive unused designs.",
    actions: "Create · Edit · Preview · Archive · Restore",
    roles: ["ORG_ADMIN", "DESIGNER"],
    admin:
      "Archiving removes a template from new-card choices and preserves issued-card history.",
  },
  {
    page: "Cards",
    title: "Issued cards",
    description:
      "Generate a sample, inspect both sides and manage activation, expiry, renewal and replacement.",
    actions: "Generate · Preview · Activate · Renew · Replace",
    roles: ["ORG_ADMIN", "OPERATOR"],
    admin:
      "Saved cards keep their original details. Generate a new card after editing a person or template.",
  },
  {
    page: "Jobs",
    title: "Bulk generation",
    description:
      "Choose a template and people, queue generation, then inspect progress and failures.",
    actions: "Queue · Inspect · Retry / cancel where available",
    roles: ["ORG_ADMIN", "OPERATOR"],
    admin:
      "New batches capture current details and photos. Completed job logs can be purged separately.",
  },
  {
    page: "Exports",
    title: "Downloads & printing",
    description:
      "Select generated cards, choose PDF or image output, and download the completed export.",
    actions: "Create export · Download · Print",
    roles: ["ORG_ADMIN", "OPERATOR"],
    admin:
      "Print at 100% / actual size. Export files and job logs have separate admin purge controls.",
  },
  {
    page: "Organization",
    title: "Organization settings",
    description:
      "Manage required fields, team access, structure, numbering, appearance and time settings.",
    actions: "Configure · Save",
    roles: ["ORG_ADMIN"],
    admin:
      "Check required fields before importing. Review team roles before sharing access.",
  },
  {
    page: "Privacy",
    title: "Privacy & API access",
    description:
      "Choose public verification fields and manage scoped API access.",
    actions: "Configure · Create token · Revoke",
    roles: ["ORG_ADMIN"],
    admin: "Only expose fields that are necessary for public verification.",
  },
  {
    page: "Audit",
    title: "Activity history",
    description:
      "Review who changed data and when. Use the admin purge preview for older logs.",
    actions: "Review · Preview purge",
    roles: ["ORG_ADMIN"],
    admin:
      "Purge is permanent. Apply your approved retention policy before confirming.",
  },
];

export function WorkflowNavigation({
  active,
  onNavigate,
}: {
  active: string;
  onNavigate: (page: string) => void;
}) {
  const steps = [
    ["People", "1. People"],
    ["Photos", "2. Photos"],
    ["Templates", "3. Template"],
    ["Jobs", "4. Generate"],
    ["Exports", "5. Download"],
  ];
  return (
    <nav className="workflow-navigation" aria-label="Card preparation workflow">
      {steps.map(([page, label]) => (
        <button
          type="button"
          key={page}
          aria-current={active === page ? "step" : undefined}
          onClick={() => onNavigate(page)}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}

export default function DataManagement({
  role,
  superAdmin,
  onNavigate,
}: {
  role: string;
  superAdmin: boolean;
  onNavigate: (page: string) => void;
}) {
  const [query, setQuery] = useState("");
  const visible = resources.filter(
    (r) =>
      (superAdmin ||
        r.roles.includes(role) ||
        (role === "VIEWER" &&
          ["People", "Photos", "Templates", "Cards", "Exports"].includes(
            r.page,
          ))) &&
      `${r.title} ${r.description} ${r.actions}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  return (
    <>
      <section className="panel management-intro">
        <p className="eyebrow">YOUR DAILY WORKFLOW</p>
        <h2>From a person’s details to a printed card</h2>
        <p>
          Add or import people → match photos → prepare the template → generate
          → download.
        </p>
        <WorkflowNavigation active="" onNavigate={onNavigate} />
        <p className="muted">
          For self-service collection, use Forms first, review responses, then
          approve them into People.
        </p>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Manage your data</h2>
            <p>Find the right place to create, change or remove records.</p>
          </div>
          <label>
            Find a task
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Try photos, edit, restore or purge…"
            />
          </label>
        </div>
        {role === "VIEWER" && !superAdmin && (
          <p className="notice">
            Your access is read-only. Ask an organization administrator to make
            changes.
          </p>
        )}
        <div className="management-grid">
          {visible.map((r) => (
            <article className="management-card" key={r.page}>
              <div className="management-card-heading">
                <MenuIcon name={r.page} />
                <h3>{r.title}</h3>
              </div>
              <p>{r.description}</p>
              <p className="management-actions">{r.actions}</p>
              <p className="muted">{r.admin}</p>
              <button type="button" onClick={() => onNavigate(r.page)}>
                Open {r.title.toLowerCase()} <span aria-hidden="true">→</span>
              </button>
            </article>
          ))}
        </div>
        {!visible.length && (
          <p role="status">
            No matching tasks in your access level. Try another word.
          </p>
        )}
      </section>
      <section className="panel management-policy">
        <h2>Choose the right removal action</h2>
        <dl>
          <div>
            <dt>Delete / restore</dt>
            <dd>
              For People and Photos. Moves records into a deleted view where an
              administrator can restore them.
            </dd>
          </div>
          <div>
            <dt>Archive / restore</dt>
            <dd>
              For Templates. Hides unused designs from normal choices and
              preserves their versions.
            </dd>
          </div>
          <div>
            <dt>Close / reopen</dt>
            <dd>
              For Forms. Stops new submissions and keeps responses available for
              review.
            </dd>
          </div>
          <div>
            <dt>Permanently purge</dt>
            <dd>
              Use Recycle bin for deleted people/photos and their linked card
              data. Use Audit, Cards or Jobs for older logs and outputs.
              Administrator only; preview the impact, then type PURGE. Backups
              retain earlier copies.
            </dd>
          </div>
        </dl>
        <p className="muted">
          Removal options differ because issued cards and shared records depend
          on historical data. Available actions are enforced by your
          organization role.
        </p>
      </section>
    </>
  );
}
