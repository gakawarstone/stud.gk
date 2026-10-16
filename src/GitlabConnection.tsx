import { useState, type FormEvent } from "react";
import { ArrowUpRight, LoaderCircle } from "lucide-react";
import { gitlabApi } from "./gitlab-api";

export function GitlabConnection({ endpoint, projectUrl, onConnected, onCancel }: {
  endpoint: string; projectUrl: string; onConnected: () => void; onCancel: () => void;
}) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const address = new URL(projectUrl);
  const createUrl = new URL("/-/user_settings/personal_access_tokens", address.origin);
  createUrl.search = new URLSearchParams({ name: "Stud.GK", scopes: "read_api" }).toString();
  async function save(value: string | null) {
    setBusy(true); setError(null);
    try { await gitlabApi(`${endpoint}/token`, undefined, { token: value }); setToken(""); onConnected(); }
    catch (error) { setError(error instanceof Error ? error.message : "Не удалось подключить GitLab."); }
    finally { setBusy(false); }
  }
  function submit(event: FormEvent) { event.preventDefault(); void save(token.trim()); }
  return <form className="gitlab-form gitlab-token-form" onSubmit={submit}>
    <a className="text-button gitlab-create-token" href={createUrl.href} target="_blank" rel="noopener noreferrer">
      Создать токен в GitLab<ArrowUpRight size={14} aria-hidden="true" />
    </a>
    <p id="gitlab-token-help">На {address.host} уже выбраны название Stud.GK и право <code>read_api</code>. Создай токен и вставь его ниже.</p>
    <label htmlFor="gitlab-access-token">Токен доступа</label>
    <input id="gitlab-access-token" type="password" value={token} onChange={(event) => setToken(event.target.value)} required maxLength={512}
      autoComplete="off" spellCheck={false} placeholder="glpat-…" aria-describedby="gitlab-token-help" disabled={busy} />
    <div className="gitlab-actions">
      <button className="primary-button" type="submit" disabled={busy || !token.trim()}>
        {busy && <LoaderCircle size={14} className="spin" aria-hidden="true" />}Подключить GitLab
      </button>
      <button className="text-button" type="button" disabled={busy} onClick={onCancel}>Отмена</button>
      <button className="text-button" type="button" disabled={busy} onClick={() => void save(null)}>Удалить токен</button>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
  </form>;
}
