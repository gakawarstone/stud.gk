import { ArrowUpRight, GraduationCap, LoaderCircle, ShieldCheck } from "lucide-solid";
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
        <h1>Sign in to Stud.IP</h1>
        <p class="login-description">
          Hochschule Flensburg.
          <br />
          Use your Stud.IP username and password.
        </p>
        <form onSubmit={submit}>
          <label for="username">Username</label>
          <input
            id="username"
            name="username"
            autocomplete="username"
            autocapitalize="none"
            spellcheck={false}
            value={username()}
            onInput={(e) => setUsername(e.target.value)}
            placeholder="Your university username"
            maxlength={128}
            disabled={props.busy}
            required
            autofocus
          />
          <label for="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autocomplete="current-password"
            value={password()}
            onInput={(e) => setPassword(e.target.value)}
            placeholder="Stud.IP password"
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
                Signing in…
              </>
            ) : (
              <>
                Sign in
                <ArrowUpRight size={16} />
              </>
            )}
          </button>
        </form>
        <p class="login-privacy">
          <ShieldCheck size={15} />
          <span>
            Your password is not stored.
            <br />
            Your session stays on this computer for up to 7 days.
          </span>
        </p>
      </section>
      <button class="demo-link" onClick={props.onDemo} disabled={props.busy}>
        Try demo
      </button>
    </div>
  );
}
