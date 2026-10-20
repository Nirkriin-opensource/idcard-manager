import type { Metadata } from "next";
import "./styles.css";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "IDcard Manager",
  description: "Private, self-hosted ID card management",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
