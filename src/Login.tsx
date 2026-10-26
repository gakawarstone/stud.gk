import {
  ArrowUpRight,
  GraduationCap,
  LoaderCircle,
  ShieldCheck,
} from "lucide-solid";
import { createSignal } from "solid-js";
export function Login(props: {
  error: string | null;
  busy: boolean;
  onLogin: (username: string, password: string) => Promise<void>;
  onDemo: () => void;
}) {
  const [username, setUsername] = createSignal("");
  const [password, setPassword] = createSignal("");
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    try {
      await props.onLogin(username(), password());
    } finally {
      setPassword("");
    }
  }
  return (
    <div class="login-wrap">
      <section class="login-card">
        <span class="login-symbol">
          <GraduationCap size={29} stroke-width={1.6} />
        </span>
        <h1>Войти в Stud.IP</h1>
        <p class="login-description">
          Hochschule Flensburg.
          <br />
          Тот же логин и пароль, что и в Stud.IP.
        </p>
        <form onSubmit={submit}>
          <label for="username">Логин</label>
          <input
            id="username"
            name="username"
            autocomplete="username"
            autocapitalize="none"
            spellcheck={false}
            value={username()}
            onInput={(e) => setUsername(e.target.value)}
            placeholder="Твой логин университета"
            maxlength={128}
            disabled={props.busy}
            required
            autofocus
          />
          <label for="password">Пароль</label>
          <input
            id="password"
            name="password"
            type="password"
            autocomplete="current-password"
            value={password()}
            onInput={(e) => setPassword(e.target.value)}
            placeholder="Пароль Stud.IP"
            maxlength={1024}
            disabled={props.busy}
            required
          />
          {props.error && (
            <p class="form-error" role="alert">
              {props.error}
            </p>
          )}
          <button
            class="primary-button login-submit"
            type="submit"
            disabled={props.busy || !username().trim() || !password()}
          >
            {props.busy ? (
              <>
                <LoaderCircle size={16} class="spin" />
                Входим…
              </>
            ) : (
              <>
                Войти
                <ArrowUpRight size={16} />
              </>
            )}
          </button>
        </form>
        <p class="login-privacy">
          <ShieldCheck size={15} />
          <span>
            Пароль не сохраняется.
            <br />
            Сессия останется на этом компьютере до 7 дней.
          </span>
        </p>
      </section>
      <button class="demo-link" onClick={props.onDemo} disabled={props.busy}>
        Посмотреть демо
      </button>
    </div>
  );
}
