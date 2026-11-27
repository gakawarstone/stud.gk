import { ExternalLink, FileText, Link, LogOut, RefreshCw, Unlink } from "lucide-solid";
import { createSignal, For, onMount, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { api, ApiError } from "./api";
import { CourseSettingsMenu } from "./CourseSettingsMenu";
import type { MoodleContents, MoodleCourses } from "../shared/moodle";

export function MoodleSection(props: { storageKey: string; demo: boolean; toolbarTarget: HTMLElement | null }) {
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
  let coursePicker: HTMLSelectElement | undefined;
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
      setContents(await api<MoodleContents>("/api/moodle/demo", undefined, controller.signal));
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
  async function disconnect() {
    await api("/api/moodle/disconnect", {}, controller.signal);
    setDraftId("");
    setEditing(false);
    await showCatalog(null);
  }
  onMount(() => void run(refresh));
  return (
    <section class="course-section moodle-section" aria-label="Moodle">
      <Show when={catalog() && props.toolbarTarget}>
        {target => (
          <Portal mount={target()}>
            <CourseSettingsMenu label="Moodle settings">
              {close => <>
                <button type="button" role="menuitem" disabled={busy()} onClick={() => {
                  close();
                  void run(refresh);
                }}><RefreshCw size={16} aria-hidden="true" /> Refresh materials</button>
                <Show when={linkedCourse() && !editing()}>
                  <button type="button" role="menuitem" disabled={busy()} onClick={() => {
                    close(false);
                    setError("");
                    setDraftId(linkedId() || "");
                    setEditing(true);
                    coursePicker?.focus();
                  }}><Link size={16} aria-hidden="true" /> Change course</button>
                </Show>
                <Show when={linkedId()}>
                  <button type="button" role="menuitem" disabled={busy()} onClick={() => {
                    close();
                    saveLink(null);
                    setContents(null);
                    setError("");
                  }}><Unlink size={16} aria-hidden="true" /> Unlink course</button>
                </Show>
                <button type="button" role="menuitem" disabled={busy()} onClick={() => {
                  close();
                  void run(disconnect);
                }}><LogOut size={16} aria-hidden="true" /> Disconnect Moodle</button>
              </>}
            </CourseSettingsMenu>
          </Portal>
        )}
      </Show>
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
          <label for="moodle-username">Moodle username</label>
          <input id="moodle-username" autocomplete="username" placeholder="abcd1234" required value={username()} onInput={e => setUsername(e.currentTarget.value)} disabled={busy()} />
          <label for="moodle-password">Moodle password</label>
          <input id="moodle-password" type="password" autocomplete="current-password" required value={password()} onInput={e => setPassword(e.currentTarget.value)} disabled={busy()} />
          <p class="course-section-notice">Use the same Hochschule Flensburg username and password as for Stud.IP.</p>
          <div class="nextcloud-actions">
            <button class="nextcloud-save" disabled={busy() || !username().trim() || !password()} type="submit">{busy() ? "Signing in…" : "Sign in to Moodle"}</button>
          </div>
        </form>
      </Show>
      <Show when={catalog()}>
        <Show when={editing() || !linkedCourse()}>
          <Show when={linkedId() && !linkedCourse()}>
            <p class="course-section-notice" role="status">The linked course is unavailable in this Moodle account.</p>
          </Show>
          <Show when={catalog()!.courses.length} fallback={<p class="course-section-notice">No enrolled courses were returned by Moodle.</p>}>
            <form class="nextcloud-form moodle-course-picker" onSubmit={event => {
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
              <label for="moodle-course">Moodle course to link</label>
              <select ref={coursePicker} id="moodle-course" value={draftId()} required disabled={busy()} onChange={event => setDraftId(event.currentTarget.value)}>
                <option value="">Choose an enrolled course</option>
                <For each={catalog()!.courses}>{course =>
                  <option value={course.id}>{course.title}{course.shortname ? ` · ${course.shortname}` : ""}</option>
                }</For>
              </select>
              <div class="nextcloud-actions">
                <button class="nextcloud-save" type="submit" disabled={busy() || !draftId() || draftId() === linkedId()}>Link course</button>
                <Show when={editing()}>
                  <button type="button" disabled={busy()} onClick={() => {
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
            <div><span class="moodle-module-kind">{module.kind}</span><h4><Show when={module.url} fallback={module.title}><a href={module.url!} target="_blank" rel="noreferrer">{module.title}<ExternalLink size={13} /></a></Show></h4><Show when={module.description}><p>{module.description}</p></Show></div>
          </div>}</For>
          <Show when={!section.modules.length}><p class="course-section-notice">No activities in this section.</p></Show>
        </article>}</For>
        <Show when={!contents()!.sections.length}><p class="course-section-notice">No visible sections in this course.</p></Show>
      </Show>
    </section>
  );
}
