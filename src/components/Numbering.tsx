"use client";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "./client";
export default function Numbering({
  org,
  onError,
}: {
  org: string;
  onError: (s: string) => void;
}) {
  const [value, setValue] = useState({
      prefix: "ID",
      pattern: "{{prefix}}-{{year}}-{{seq}}",
      padding: 6,
      start: 1,
    }),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api(`orgs/${org}/numbering`)
      .then((n) => setValue({ ...n, start: Number(n.next_value) }))
      .catch((e) => onError(e.message));
  }, [org]);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`orgs/${org}/numbering`, "PUT", value);
      setMessage("Number format saved. Existing card numbers are unchanged.");
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>Card numbering</h2>
      <p className="muted">
        New card numbers use this format. Uniqueness is enforced by the
        database.
      </p>
      <form onSubmit={save}>
        <label>
          Prefix
          <input
            required
            value={value.prefix}
            onChange={(e) => setValue({ ...value, prefix: e.target.value })}
          />
        </label>
        <label>
          Format
          <input
            required
            value={value.pattern}
            onChange={(e) => setValue({ ...value, pattern: e.target.value })}
          />
        </label>
        <small>
          {"{{prefix}}, {{year}}, {{dept}}, {{seq}}, {{random}}, {{uuid}}"}.
          Include seq, random or uuid. Department uses the first department code
          alphabetically if a person has several.
        </small>
        <div className="two-columns">
          <label>
            Sequence padding
            <input
              type="number"
              min={1}
              max={18}
              value={value.padding}
              onChange={(e) =>
                setValue({ ...value, padding: Number(e.target.value) })
              }
            />
          </label>
          <label>
            Next sequence value
            <input
              type="number"
              min={1}
              max={Number.MAX_SAFE_INTEGER}
              value={value.start}
              onChange={(e) =>
                setValue({ ...value, start: Number(e.target.value) })
              }
            />
          </label>
        </div>
        <button disabled={busy}>Save number format</button>
        {message && <p className="notice">{message}</p>}
      </form>
    </section>
  );
}
