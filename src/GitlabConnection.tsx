import { ArrowUpRight, LoaderCircle } from "lucide-solid";
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from "solid-js";
import { gitlabApi } from "./gitlab-api";
export function GitlabConnection(props: {
  endpoint: string;
  projectUrl: string;
  onConnected: () => void;
  onCancel: () => void;
}) {
  const [token, setToken] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [connected, setConnected] = createSignal<boolean | null>(null);
  const [editing, setEditing] = createSignal(false);
  const [retry, setRetry] = createSignal(0);
  createEffect(
    on(
      () => [props.endpoint, props.projectUrl, retry()],
      () => {
        const controller = new AbortController();
        setConnected(null);
        setEditing(false);
        setError(null);
        void gitlabApi<{
          connected: boolean;
        }>(`${props.endpoint}/token`, controller.signal)
          .then((status) => {
            if (!controller.signal.aborted) setConnected(status.connected);
          })
          .catch((error) => {
            if (!controller.signal.aborted)
              setError(
                error instanceof Error
                  ? error.message
                  : "Не удалось проверить доступ GitLab.",
              );
          });
        onCleanup(() => controller.abort());
      },
    ),
  );
  const address = createMemo(() => new URL(props.projectUrl));
  const createUrl = createMemo(() => {
    const url = new URL(
      "/-/user_settings/personal_access_tokens",
      address().origin,
    );
    url.search = new URLSearchParams({
      name: "Stud.GK",
      scopes: "read_api",
    }).toString();
    return url;
  });
  async function save(value: string | null) {
    setBusy(true);
    setError(null);
    try {
      await gitlabApi(`${props.endpoint}/token`, undefined, { token: value });
      setToken("");
      props.onConnected();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Не удалось подключить GitLab.",
      );
    } finally {
      setBusy(false);
    }
  }
  function submit(event: SubmitEvent) {
    event.preventDefault();
    void save(token().trim());
  }
  const view = () => {
    if (connected() === null)
      return (
        <div class="gitlab-form gitlab-token-form">
          {error() ? (
            <>
              <p class="form-error" role="alert">
                {error()}
              </p>
              <button
                class="text-button"
                onClick={() => setRetry((value) => value + 1)}
              >
                Повторить
              </button>
            </>
          ) : (
            <p role="status">
              <LoaderCircle size={14} class="spin" aria-hidden="true" />{" "}
              Проверяем доступ GitLab…
            </p>
          )}
          <button class="text-button" onClick={props.onCancel}>
            Отмена
          </button>
        </div>
      );
    if (connected() && !editing())
      return (
        <div class="gitlab-form gitlab-token-form">
          <p role="status">
            Токен для {address().host} подключён. Он используется для всех твоих
            проектов на этом сервере.
          </p>
          <div class="gitlab-actions">
            <button
              class="text-button"
              type="button"
              disabled={busy()}
              onClick={() => setEditing(true)}
            >
              Заменить токен
            </button>
            <button
              class="text-button"
              type="button"
              disabled={busy()}
              onClick={() => void save(null)}
            >
              Удалить токен для всех проектов
            </button>
            <button
              class="text-button"
              type="button"
              disabled={busy()}
              onClick={props.onCancel}
            >
              Закрыть
            </button>
          </div>
          {error() && (
            <p class="form-error" role="alert">
              {error()}
            </p>
          )}
        </div>
      );
    return (
      <form class="gitlab-form gitlab-token-form" onSubmit={submit}>
        <a
          class="text-button gitlab-create-token"
          href={createUrl().href}
          target="_blank"
          rel="noopener noreferrer"
        >
          Создать токен в GitLab
          <ArrowUpRight size={14} aria-hidden="true" />
        </a>
        <p id="gitlab-token-help">
          Один личный токен с правом <code>read_api</code> используется для всех
          твоих проектов на {address().host}. Вставь существующий токен или
          создай его один раз по ссылке выше.
        </p>
        <label for="gitlab-access-token">Токен доступа</label>
        <input
          id="gitlab-access-token"
          type="password"
          value={token()}
          onInput={(event) => setToken(event.target.value)}
          required
          maxlength={512}
          autocomplete="off"
          spellcheck={false}
          placeholder="glpat-…"
          aria-describedby="gitlab-token-help"
          disabled={busy()}
        />
        <div class="gitlab-actions">
          <button
            class="primary-button"
            type="submit"
            disabled={busy() || !token().trim()}
          >
            {busy() && (
              <LoaderCircle size={14} class="spin" aria-hidden="true" />
            )}
            Подключить GitLab
          </button>
          <button
            class="text-button"
            type="button"
            disabled={busy()}
            onClick={props.onCancel}
          >
            Отмена
          </button>
          {connected() && (
            <button
              class="text-button"
              type="button"
              disabled={busy()}
              onClick={() => void save(null)}
            >
              Удалить токен для всех проектов
            </button>
          )}
        </div>
        {error() && (
          <p class="form-error" role="alert">
            {error()}
          </p>
        )}
      </form>
    );
  };
  return <>{view()}</>;
}
