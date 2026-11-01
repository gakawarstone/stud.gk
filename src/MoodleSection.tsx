import { BookOpen, ExternalLink, FileText, RefreshCw } from "lucide-solid";
import { createSignal, For, onMount, onCleanup, Show } from "solid-js";
import { api } from "./api";
import type { MoodleContents, MoodleCourses } from "../shared/moodle";

export function MoodleSection(props: { storageKey: string; demo: boolean }) {
  const [catalog, setCatalog] = createSignal<MoodleCourses | null>(null);
  const [contents, setContents] = createSignal<MoodleContents | null>(null);
  const [course, setCourse] = createSignal("");
  const [url, setUrl] = createSignal("");
  const [token, setToken] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const controller = new AbortController();
  onCleanup(() => controller.abort());
  async function run(action: () => Promise<void>) {
    setBusy(true); setError("");
    try { await action(); } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not load Moodle.");
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }
  async function loadCourse(id: string) {
    setCourse(id); setContents(null);
    try { localStorage.setItem(props.storageKey, id); } catch { /* Optional preference. */ }
    if (id) setContents(await api<MoodleContents>(`/api/moodle/courses/${id}`, undefined, controller.signal));
  }
  async function refresh() {
    if (props.demo) {
      const data = await api<MoodleCourses & MoodleContents>("/api/moodle/demo", undefined, controller.signal);
      setCatalog(data); setCourse("42"); setContents(data); return;
    }
    const data = await api<MoodleCourses & { connected: boolean }>("/api/moodle/courses", undefined, controller.signal);
    setCatalog(data.connected ? data : null);
    let saved = course();
    try { saved ||= localStorage.getItem(props.storageKey) || ""; } catch { /* Optional preference. */ }
    if (data.connected && data.courses.some(c => String(c.id) === saved)) await loadCourse(saved);
  }
  onMount(() => void run(refresh));
  return (
    <section class="course-section moodle-section" aria-label="Moodle">
      <header class="moodle-heading">
        <div><span class="moodle-eyebrow">COURSE INTEGRATION</span><h2><BookOpen size={24} /> Moodle</h2></div>
        <Show when={catalog()}><button class="text-button" disabled={busy()} onClick={() => void run(refresh)} aria-label="Refresh Moodle"><RefreshCw size={16} /> Refresh</button></Show>
      </header>
      <Show when={props.demo}><p class="moodle-demo">Demo preview · Sample materials. Sign in to connect your Moodle account.</p></Show>
      <Show when={error()}><p class="form-error" role="alert">{error()}</p></Show>
      <Show when={!catalog() && !props.demo}>
        <form class="nextcloud-form moodle-connect" onSubmit={e => {
          e.preventDefault();
          void run(async () => {
            const data = await api<MoodleCourses>("/api/moodle/connect", { url: url(), token: token() }, controller.signal);
            setToken(""); setCatalog(data); setContents(null); setCourse("");
          });
        }}>
          <h3>Connect your Moodle account</h3>
          <p class="course-section-notice">Browse your enrolled courses and open activities in Moodle.</p>
          <label for="moodle-url">Moodle site URL</label>
          <input id="moodle-url" type="url" placeholder="https://moodle.example.edu" required value={url()} onInput={e => setUrl(e.currentTarget.value)} disabled={busy()} />
          <label for="moodle-token">Web service token</label>
          <input id="moodle-token" type="password" autocomplete="off" required value={token()} onInput={e => setToken(e.currentTarget.value)} disabled={busy()} />
          <p class="course-section-notice">Find your token in Moodle under Preferences → Security keys, or ask your administrator. The site must enable REST web services.</p>
          <button class="primary-button" disabled={busy()} type="submit">{busy() ? "Connecting…" : "Connect Moodle"}</button>
          <p class="course-section-notice">Your token stays in the encrypted server session. This integration only reads courses and activities.</p>
        </form>
      </Show>
      <Show when={catalog()}>
        <div class="moodle-connection">
          <div><span class="moodle-eyebrow">{props.demo ? "SAMPLE SITE" : "CONNECTED SITE"}</span><p>{catalog()!.site || "Moodle"}</p></div>
          <Show when={!props.demo}><button class="text-button" disabled={busy()} onClick={() => void run(async () => {
            await api("/api/moodle/disconnect", {}, controller.signal);
            setCatalog(null); setContents(null); setCourse("");
          })}>Disconnect</button></Show>
        </div>
        <label class="moodle-course-label" for="moodle-course">Moodle course</label>
        <select id="moodle-course" value={course()} disabled={busy() || props.demo} onChange={e => void run(() => loadCourse(e.currentTarget.value))}>
          <option value="">Choose an enrolled course</option>
          <For each={catalog()!.courses}>{c => <option value={c.id}>{c.title}{c.shortname ? ` · ${c.shortname}` : ""}</option>}</For>
        </select>
        <Show when={!catalog()!.courses.length}><p class="course-section-notice">No enrolled courses were returned by Moodle.</p></Show>
      </Show>
      <Show when={busy()}><p role="status" class="course-section-notice">Loading Moodle…</p></Show>
      <Show when={contents()}>
        <For each={contents()!.sections}>{section => <article class="moodle-topic">
          <h3>{section.title || "Untitled section"}</h3>
          <Show when={section.summary}><p class="moodle-summary">{section.summary}</p></Show>
          <For each={section.modules}>{module => <div class="moodle-module">
            <span class="moodle-module-icon"><FileText size={20} /></span>
            <div><span class="moodle-eyebrow">{module.kind}</span><h4><Show when={module.url} fallback={module.title}><a href={module.url!} target="_blank" rel="noreferrer">{module.title}<ExternalLink size={13} /></a></Show></h4><Show when={module.description}><p>{module.description}</p></Show></div>
          </div>}</For>
          <Show when={!section.modules.length}><p class="course-section-notice">No activities in this section.</p></Show>
        </article>}</For>
        <Show when={!contents()!.sections.length}><p class="course-section-notice">No visible sections in this course.</p></Show>
      </Show>
    </section>
  );
}
