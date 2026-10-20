import { useState, type FormEvent } from "react";
import { ArrowUpRight, GraduationCap, LoaderCircle, ShieldCheck } from "lucide-react";

export function Login({
  error,
  busy,
  onLogin,
  onDemo,
}: {
  error: string | null;
  busy: boolean;
  onLogin: (username: string, password: string) => Promise<void>;
  onDemo: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await onLogin(username, password);
    } finally {
      setPassword("");
    }
  }
  return (
    <div className="login-wrap">
      <section className="login-card">
        <span className="login-symbol">
          <GraduationCap size={29} strokeWidth={1.6} />
        </span>
        <h1>Войти в Stud.IP</h1>
        <p className="login-description">
          Hochschule Flensburg.
          <br />
          Тот же логин и пароль, что и в Stud.IP.
        </p>
        <form onSubmit={submit}>
          <label htmlFor="username">Логин</label>
          <input
            id="username"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Твой логин университета"
            maxLength={128}
            disabled={busy}
            required
            autoFocus
          />
          <label htmlFor="password">Пароль</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Пароль Stud.IP"
            maxLength={1024}
            disabled={busy}
            required
          />
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="primary-button login-submit"
            type="submit"
            disabled={busy || !username.trim() || !password}
          >
            {busy ? (
              <>
                <LoaderCircle size={16} className="spin" />
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
        <p className="login-privacy">
          <ShieldCheck size={15} />
          <span>
            Пароль не сохраняется.
            <br />
            Сессия останется на этом компьютере до 7 дней.
          </span>
        </p>
      </section>
      <button className="demo-link" onClick={onDemo} disabled={busy}>
        Посмотреть демо
      </button>
    </div>
  );
}
