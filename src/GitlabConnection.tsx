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
      .catch((error) => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Не удалось проверить доступ GitLab."); });
    return () => controller.abort();
  }, [endpoint, projectUrl, retry]);
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
  if (connected === null) return <div className="gitlab-form gitlab-token-form">
    {error ? <><p className="form-error" role="alert">{error}</p><button className="text-button" onClick={() => setRetry((value) => value + 1)}>Повторить</button></>
      : <p role="status"><LoaderCircle size={14} className="spin" aria-hidden="true" /> Проверяем доступ GitLab…</p>}
    <button className="text-button" onClick={onCancel}>Отмена</button>
  </div>;
  if (connected && !editing) return <div className="gitlab-form gitlab-token-form">
    <p role="status">Токен для {address.host} подключён. Он используется для всех твоих проектов на этом сервере и сохраняется после выхода из Stud.IP.</p>
    <div className="gitlab-actions">
      <button className="text-button" type="button" disabled={busy} onClick={() => setEditing(true)}>Заменить токен</button>
      <button className="text-button" type="button" disabled={busy} onClick={() => void save(null)}>Удалить токен для всех проектов</button>
      <button className="text-button" type="button" disabled={busy} onClick={onCancel}>Закрыть</button>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
  return <form className="gitlab-form gitlab-token-form" onSubmit={submit}>
    <a className="text-button gitlab-create-token" href={createUrl.href} target="_blank" rel="noopener noreferrer">
      Создать токен в GitLab<ArrowUpRight size={14} aria-hidden="true" />
    </a>
    <p id="gitlab-token-help">Один личный токен с правом <code>read_api</code> используется для всех твоих проектов на {address.host}. Он сохранится после выхода и повторного входа в твой аккаунт Stud.IP. Вставь существующий токен или создай его один раз по ссылке выше.</p>
    <label htmlFor="gitlab-access-token">Токен доступа</label>
    <input id="gitlab-access-token" type="password" value={token} onChange={(event) => setToken(event.target.value)} required maxLength={512}
      autoComplete="off" spellCheck={false} placeholder="glpat-…" aria-describedby="gitlab-token-help" disabled={busy} />
    <div className="gitlab-actions">
      <button className="primary-button" type="submit" disabled={busy || !token.trim()}>
        {busy && <LoaderCircle size={14} className="spin" aria-hidden="true" />}Подключить GitLab
      </button>
      <button className="text-button" type="button" disabled={busy} onClick={onCancel}>Отмена</button>
      {connected && <button className="text-button" type="button" disabled={busy} onClick={() => void save(null)}>Удалить токен для всех проектов</button>}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
  </form>;
}
