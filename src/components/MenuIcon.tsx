const shapes: Record<string, string> = {
  "Manage data": "M4 4h16v5H4zM4 15h7v5H4zM15 15h5v5h-5zM7 9v6m0-3h11v3",
  "Recycle bin": "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7",
  People:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  Imports: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  Forms: "M6 3h12v18H6zM9 7h6M9 11h6M9 15h3M16 18l2 2 4-4",
  Photos: "M3 5h18v15H3zM8 9h.01M3 17l6-5 4 4 3-3 5 4",
  Templates: "M3 3h8v8H3zM15 3h6v8h-6zM3 15h8v6H3zM15 15h6v6h-6z",
  Cards: "M2 5h20v14H2zM6 9h4v5H6zM14 9h4m-4 4h4",
  Organization:
    "M4 21V7l8-4 8 4v14M2 21h20M8 8h1m6 0h1M8 12h1m6 0h1M10 21v-5h4v5",
  System:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2",
  Dashboard: "M3 3h7v7H3zM14 3h7v11h-7zM3 14h7v7H3zM14 18h7v3h-7z",
  Exports: "M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5",
  Jobs: "M3 7h18v14H3zM8 7V3h8v4M3 12h18m-11 0v3h4v-3",
  Privacy: "M12 2l9 4v6c0 5-9 10-9 10S3 17 3 12V6zM8 12l3 3 5-6",
  Locations:
    "M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0M12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
  Audit: "M6 3h12v18H6zM9 7h6M9 11h6M9 15h4",
  Setup: "M4 21V3h16v18M8 7h8M8 11h8M8 15h4",
};
export default function MenuIcon({ name }: { name: string }) {
  return (
    <span className="nav-icon" aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={shapes[name] || shapes.Setup} />
      </svg>
    </span>
  );
}
