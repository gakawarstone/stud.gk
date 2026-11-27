import { BookOpen, ExternalLink, FileText, RefreshCw } from "lucide-solid";
import { createSignal, For, onMount, onCleanup, Show } from "solid-js";
import { api, ApiError } from "./api";
import type { MoodleContents, MoodleCourses } from "../shared/moodle";

export function MoodleSection(props: { storageKey: string; demo: boolean }) {
  const [catalog, setCatalog] = createSignal<MoodleCourses | null>(null);
  const [contents, setContents] = createSignal<MoodleContents | null>(null);
  const [linkedId, setLinkedId] = createSignal<string | null>((() => {
    if (props.demo) return null;
    try { return localStorage.getItem(props.storageKey) || null; }
    catch { return null; }
  })());
  const [draftId, setDraftId] = createSignal("");
  const [editing, setEditing] = createSignal(false);
  const linkedCourse = () => catalog()?.courses.find(course => String(course.id) === linkedId());
  const [username, setUsername] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const controller = new AbortController();
  onCleanup(() => controller.abort());
  async function run(action: () => Promise<void>) {
    if (busy()) return;
    setBusy(true); setError("");
    try { await action(); } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not load Moodle.");
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }
  function saveLink(id: string | null) {
    try {
      if (id) localStorage.setItem(props.storageKey, id);
      else localStorage.removeItem(props.storageKey);
    } catch { /* The link still works for the current view. */ }
    setLinkedId(id);
    setDraftId("");
    setEditing(false);
  }
  function fetchCourse(id: number) {
    return api<MoodleContents>(`/api/moodle/courses/${id}`, undefined, controller.signal);
  }
  async function showCatalog(data: MoodleCourses | null) {
    setCatalog(data);
    const course = linkedCourse();
    if (course) setContents(await fetchCourse(course.id));
    else setContents(null);
  }
  async function refresh() {
    if (props.demo) {
      const data = await api<MoodleCourses & MoodleContents>("/api/moodle/demo", undefined, controller.signal);
      setCatalog(data);
      setLinkedId(data.courses[0] ? String(data.courses[0].id) : null);
      setContents(data);
      return;
    }
    let data;
    try {
      data = await api<MoodleCourses & { connected: boolean }>("/api/moodle/courses", undefined, controller.signal);
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) await showCatalog(null);
      throw error;
    }
    await showCatalog(data.connected ? data : null);
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
          if (busy()) return;
          const credentials = { username: username().trim(), password: password() };
          setPassword("");
          void run(async () => {
            const data = await api<MoodleCourses>("/api/moodle/connect", credentials, controller.signal);
            await showCatalog(data);
          });
        }}>
          <h3>Sign in to Moodle</h3>
          <p class="course-section-notice">Use the same Hochschule Flensburg username and password as for Stud.IP.</p>
          <label for="moodle-username">University username</label>
          <input id="moodle-username" autocomplete="username" placeholder="abcd1234" required value={username()} onInput={e => setUsername(e.currentTarget.value)} disabled={busy()} />
          <label for="moodle-password">University password</label>
          <input id="moodle-password" type="password" autocomplete="current-password" required value={password()} onInput={e => setPassword(e.currentTarget.value)} disabled={busy()} />
          <button class="primary-button" disabled={busy() || !username().trim() || !password()} type="submit">{busy() ? "Signing in…" : "Sign in to Moodle"}</button>
          <p class="course-section-notice">Your password is sent to moodle.hs-flensburg.de to sign in and is not stored.</p>
        </form>
      </Show>
      <Show when={catalog()}>
        <div class="moodle-connection">
          <div><span class="moodle-eyebrow">{props.demo ? "SAMPLE SITE" : "CONNECTED SITE"}</span><p>{catalog()!.site || "Moodle"}</p></div>
          <Show when={!props.demo}><button class="text-button" disabled={busy()} onClick={() => void run(async () => {
            await api("/api/moodle/disconnect", {}, controller.signal);
            setDraftId("");
            setEditing(false);
            await showCatalog(null);
          })}>Disconnect Moodle</button></Show>
        </div>
        <Show when={linkedCourse()}>
          {course => <div class="moodle-linked-course">
            <div>
              <span class="moodle-eyebrow">{props.demo ? "Sample linked course" : "Linked Moodle course"}</span>
              <h3>{course().title}</h3>
              <Show when={course().shortname}><p>{course().shortname}</p></Show>
            </div>
            <Show when={!props.demo && !editing()}>
              <div class="moodle-course-actions">
                <button type="button" class="text-button" disabled={busy()} onClick={() => {
                  setError("");
                  setEditing(true);
                }}>Change course</button>
                <button type="button" class="text-button" disabled={busy()} onClick={() => {
                  saveLink(null);
                  setContents(null);
                  setError("");
                }}>Unlink course</button>
              </div>
            </Show>
          </div>}
        </Show>
        <Show when={!props.demo && (editing() || !linkedCourse())}>
          <Show when={linkedId() && !linkedCourse()}>
            <p class="course-section-notice" role="status">The linked course is unavailable in this Moodle account.</p>
            <button type="button" class="text-button" disabled={busy()} onClick={() => saveLink(null)}>Unlink course</button>
          </Show>
          <Show when={catalog()!.courses.length} fallback={<p class="course-section-notice">No enrolled courses were returned by Moodle.</p>}>
            <form class="moodle-course-picker" onSubmit={event => {
              event.preventDefault();
              const course = catalog()?.courses.find(course => String(course.id) === draftId());
              if (!course || draftId() === linkedId()) return;
              void run(async () => {
                const result = await fetchCourse(course.id);
                if (controller.signal.aborted) return;
                saveLink(String(course.id));
                setContents(result);
              });
            }}>
              <label class="moodle-course-label" for="moodle-course">Moodle course to link</label>
              <select id="moodle-course" value={draftId()} required disabled={busy()} onChange={event => setDraftId(event.currentTarget.value)}>
                <option value="">Choose an enrolled course</option>
                <For each={catalog()!.courses}>{course =>
                  <option value={course.id}>{course.title}{course.shortname ? ` · ${course.shortname}` : ""}</option>
                }</For>
              </select>
              <div class="moodle-course-actions">
                <button class="primary-button" type="submit" disabled={busy() || !draftId() || draftId() === linkedId()}>Link course</button>
                <Show when={editing()}>
                  <button type="button" class="text-button" disabled={busy()} onClick={() => {
                    setDraftId("");
                    setEditing(false);
                    setError("");
                  }}>Cancel</button>
                </Show>
              </div>
            </form>
          </Show>
        </Show>
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
