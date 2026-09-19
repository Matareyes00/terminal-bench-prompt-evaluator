// Records view. v1 has no auth, so this path is the only barrier — it is
// deliberately not guessable and not linked from the main page. That is
// obscurity, not security: anyone with the URL can read it. SPEC section 9.2.

import { list, dbConfigured, backend } from "../../src/lib/db.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = { robots: { index: false, follow: false } };

export default async function Records() {
  const configured = dbConfigured();
  const store = backend();
  const rows = configured ? await list(200) : [];

  return (
    <div className="wrap">
      <header>
        <h1>Evaluation records</h1>
        <p>
          Everything submitted through the check endpoint. Newest first, most recent 200.
          {configured && <> Storage backend: <code>{store}</code>.</>}
        </p>
      </header>

      {!configured && (
        <div className="banner">
          <strong>No storage configured.</strong> Nothing is being kept. Attach a Postgres
          store (which sets <code>POSTGRES_URL</code>) or a Vercel Blob store (which sets{" "}
          <code>BLOB_READ_WRITE_TOKEN</code>) and rows start appearing here; neither needs a
          migration step.
        </div>
      )}

      {configured && (
        <p style={{ marginTop: 18 }}>
          <a href="/records-7c41f9a2/export">Download all records as CSV</a>
        </p>
      )}

      {configured && rows.length === 0 && (
        <p style={{ color: "var(--ink-faint)", marginTop: 18 }}>No evaluations yet.</p>
      )}

      {rows.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>id</th>
              <th>when</th>
              <th>slug</th>
              <th>verdict</th>
              <th className="num">b / w / t</th>
              <th>prompt</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="num">{r.id}</td>
                <td className="num">{new Date(r.created_at).toISOString().slice(0, 16).replace("T", " ")}</td>
                <td>{r.slug ?? "—"}</td>
                <td>{r.verdict}</td>
                <td className="num">
                  {r.blockers} / {r.warns} / {r.todos}
                </td>
                <td>
                  <span className="snippet">{r.prompt.replace(/\s+/g, " ").slice(0, 160)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <footer>
        Prompts here are unpublished team work. The URL is the only thing keeping this
        page private.
      </footer>
    </div>
  );
}
