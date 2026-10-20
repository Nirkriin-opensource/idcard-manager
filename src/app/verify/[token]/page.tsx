import { headers } from "next/headers";
import { verifyCard, rateLimit } from "../../../core/verification";
export const dynamic = "force-dynamic";
export default async function Verification({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  try {
    await rateLimit(
      "verify-page:" + (await headers()).get("x-forwarded-for"),
      60,
      60,
    );
    const card = await verifyCard((await params).token);
    return (
      <main className="auth">
        <section className="auth-card">
          <div className="brand-mark">iD</div>
          <h1>Card verification</h1>
          <h2>{card.organization}</h2>
          <p className={card.valid ? "notice" : "error"}>{card.status}</p>
          <p>
            {card.valid
              ? "This card is currently valid."
              : "This card is not currently valid. Contact the issuing organization."}
          </p>
          {Object.entries(card.fields).map(([key, value]) => (
            <p key={key}>
              <strong>{key.replaceAll("_", " ")}: </strong>
              {String(value)}
            </p>
          ))}
          <small>
            Status checked live. Printed information may be out of date.
          </small>
        </section>
      </main>
    );
  } catch {
    return (
      <main className="auth">
        <section className="auth-card">
          <h1>Card unavailable</h1>
          <p>Check the QR link or contact the issuing organization.</p>
        </section>
      </main>
    );
  }
}
