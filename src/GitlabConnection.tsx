import { useEffect, useState, type FormEvent } from "react";
import { ArrowUpRight, LoaderCircle } from "lucide-react";
import { gitlabApi } from "./gitlab-api";

export function GitlabConnection({ endpoint, projectUrl, onConnected, onCancel }: {
  endpoint: string; projectUrl: string; onConnected: () => void; onCancel: () => void;
}) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [editing, setEditing] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setConnected(null); setEditing(false); setError(null);
    void gitlabApi<{ connected: boolean }>(`${endpoint}/token`, controller.signal)
      .then((status) => { if (!controller.signal.aborted) setConnected(status.connected); })
      .catch((error) => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not check GitLab access."); });
    return () => controller.abort();
  }, [endpoint, projectUrl, retry]);
  const address = new URL(projectUrl);
  const createUrl = new URL("/-/user_settings/personal_access_tokens", address.origin);
  createUrl.search = new URLSearchParams({ name: "Stud.GK", scopes: "read_api" }).toString();
  async function save(value: string | null) {
    setBusy(true); setError(null);
    try { await gitlabApi(`${endpoint}/token`, undefined, { token: value }); setToken(""); onConnected(); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not connect to GitLab."); }
    finally { setBusy(false); }
  }
  function submit(event: FormEvent) { event.preventDefault(); void save(token.trim()); }
  if (connected === null) return <div className="gitlab-form gitlab-token-form">
    {error ? <><p className="form-error" role="alert">{error}</p><button className="text-button" onClick={() => setRetry((value) => value + 1)}>Retry</button></>
      : <p role="status"><LoaderCircle size={14} className="spin" aria-hidden="true" /> Checking GitLab access…</p>}
    <button className="text-button" onClick={onCancel}>Cancel</button>
  </div>;
  if (connected && !editing) return <div className="gitlab-form gitlab-token-form">
    <p role="status">The token for {address.host} is connected. It is used for all your projects on this server.</p>
    <div className="gitlab-actions">
      <button className="text-button" type="button" disabled={busy} onClick={() => setEditing(true)}>Replace token</button>
      <button className="text-button" type="button" disabled={busy} onClick={() => void save(null)}>Remove token for all projects</button>
      <button className="text-button" type="button" disabled={busy} onClick={onCancel}>Close</button>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
  return <form className="gitlab-form gitlab-token-form" onSubmit={submit}>
    <a className="text-button gitlab-create-token" href={createUrl.href} target="_blank" rel="noopener noreferrer">
      Create token in GitLab<ArrowUpRight size={14} aria-hidden="true" />
    </a>
    <p id="gitlab-token-help">One personal access token with the <code>read_api</code> scope is used for all your projects on {address.host}. Paste an existing token or create one using the link above.</p>
    <label htmlFor="gitlab-access-token">Access token</label>
    <input id="gitlab-access-token" type="password" value={token} onChange={(event) => setToken(event.target.value)} required maxLength={512}
      autoComplete="off" spellCheck={false} placeholder="glpat-…" aria-describedby="gitlab-token-help" disabled={busy} />
    <div className="gitlab-actions">
      <button className="primary-button" type="submit" disabled={busy || !token.trim()}>
        {busy && <LoaderCircle size={14} className="spin" aria-hidden="true" />}Connect GitLab
      </button>
      <button className="text-button" type="button" disabled={busy} onClick={onCancel}>Cancel</button>
      {connected && <button className="text-button" type="button" disabled={busy} onClick={() => void save(null)}>Remove token for all projects</button>}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
  </form>;
}
