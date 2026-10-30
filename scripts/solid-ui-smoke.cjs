const { app, BrowserWindow } = require("electron");
// Teardown is awaited below; closing the last window must not exit early.
app.on("window-all-closed", () => {});
const assert = require("node:assert/strict");
const { mkdtemp, rm, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { tmpdir } = require("node:os");
const { pathToFileURL } = require("node:url");
let runtime, profile;
const timeout = setTimeout(() => {
  console.error("UI smoke timed out");
  app.exit(1);
}, 60000);
async function waitFor(window, condition) {
  for (let i = 0; i < 200; i++) {
    if (await window.webContents.executeJavaScript(condition)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timed out: ${condition}`);
}
async function evaluate(window, code) {
  return window.webContents.executeJavaScript(code);
}
async function frames(window) {
  await evaluate(window, "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
}
// Small, deterministic 12-page PDF with real selectable text and a white page.
function pdfFixture() {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const kids = [];
  for (let page = 1; page <= 12; page++) {
    const id = objects.length + 1;
    kids.push(`${id} 0 R`);
    const text = `BT /F1 24 Tf 40 700 Td (Fixture page ${page}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`,
      `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    );
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count 12 >>`;
  let result = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(result));
    result += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(result);
  result +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
      .join("");
  return Buffer.from(result + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}
(async () => {
  profile = await mkdtemp(path.join(tmpdir(), "stud-gk-ui-"));
  app.setPath("userData", profile);
  await app.whenReady();
  const root = process.env.CAMPUS_SMOKE_ROOT || path.resolve(__dirname, "..");
  const { startServer } = await import(pathToFileURL(path.join(root, "server/runtime.js")).href);
  const { CookieJar } = await import("tough-cookie");
  const pdf = pdfFixture();
  let filename = "Fixture.pdf",
    updatedAt = "2026-10-01T12:00:00Z",
    newsTitle = "Announcement";
  runtime = await startServer({
    root,
    dataDir: path.join(profile, "data"),
    autoSync: false,
    authenticate: async () => ({
      jar: new CookieJar(),
      user: { id: "fixture", name: "Fixture" },
    }),
    getSnapshot: async () => ({
      courses: ["c1", "c2", "c3"].map((id) => ({
        id,
        title: `Course ${id}`,
        color: "blue",
        url: null,
      })),
      resources: [
        {
          id: "news",
          courseId: "c1",
          kind: "news",
          title: newsTitle,
          description: "Long announcement. ".repeat(40),
          createdAt: "2026-10-01T12:00:00Z",
          updatedAt,
        },
        {
          id: "pdf",
          courseId: "c1",
          kind: "file",
          title: filename,
          updatedAt,
          remoteId: "pdf",
          createdAt: "2026-10-01T12:00:00Z",
        },
      ],
    }),
    getDownload: async () =>
      new Response(pdf, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": String(pdf.length),
        },
      }),
  });
  const window = new BrowserWindow({
    show: true,
    width: 1280,
    height: 850,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  const errors = require("./renderer-errors.cjs")(window);
  await window.loadURL(runtime.url);
  await waitFor(window, "!!document.querySelector('#username')");
  await evaluate(
    window,
    `(() => {
    const original = window.setTimeout;
    window.setTimeout = (callback, delay, ...args) => {
      const id = original(callback, delay, ...args);
      if(delay === 30000 || delay === 2000) window.runUiPoll = () => { clearTimeout(id); return callback(...args); };
      return id;
    };
  })()`,
  );
  await evaluate(
    window,
    `(()=>{for(const id of ['username','password']) {const el=document.getElementById(id);el.value='fixture';el.dispatchEvent(new Event('input',{bubbles:true}));}document.querySelector('form').requestSubmit();})()`,
  );
  await waitFor(window, "document.querySelectorAll('.course-card').length===3");
  await evaluate(
    window,
    `(()=>{const handle=document.querySelector('.course-drag-handle');window.originalCard=document.querySelector('.course-card');handle.focus();handle.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));})()`,
  );
  await frames(window);
  assert.deepEqual(
    await evaluate(window, "[...document.querySelectorAll('.course-card')].map(x=>x.dataset.courseId)"),
    ["c2", "c1", "c3"],
  );
  assert.equal(await evaluate(window, "document.activeElement.closest('.course-card').dataset.courseId"), "c1");
  assert.equal(
    await evaluate(window, "document.querySelectorAll('.course-card')[1]===originalCard"),
    true,
    "Keyed reorder keeps the same DOM node",
  );
  // Pointer drag is the same path for mouse cards and touch handles.
  for (const type of ["mouse", "touch"]) {
    await evaluate(
      window,
      `(()=>{const source=document.querySelector('[data-course-id="c1"]');const target=document.querySelector('[data-course-id="${type === "mouse" ? "c3" : "c2"}"]');const a=source.getBoundingClientRect(),b=target.getBoundingClientRect();const handle=${type === "touch" ? "source.querySelector('.course-drag-handle')" : "source"};handle.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,isPrimary:true,pointerId:3,pointerType:'${type}',clientX:a.x+30,clientY:a.y+30}));window.dispatchEvent(new PointerEvent('pointermove',{cancelable:true,pointerId:3,pointerType:'${type}',clientX:b.x+30,clientY:b.y+30}));window.dispatchEvent(new PointerEvent('pointerup',{pointerId:3,pointerType:'${type}'}));})()`,
    );
    await frames(window);
    assert.equal(
      await evaluate(
        window,
        "document.querySelectorAll('.course-card')[" + (type === "mouse" ? 2 : 0) + "].dataset.courseId",
      ),
      "c1",
    );
  }
  await evaluate(window, "location.hash='course=c1'");
  await waitFor(window, "!!document.querySelector('.file-card button')");
  await evaluate(
    window,
    "document.querySelector('.file-card button').focus();document.querySelector('.file-card button').click()",
  );
  await waitFor(
    window,
    "document.querySelectorAll('.pdf-page').length===12 && !!document.querySelector('.pdf-page canvas')",
  );
  assert.equal(await evaluate(window, "document.querySelector('.pdf-viewer').open"), true);
  assert.equal(await evaluate(window, "document.body.style.overflow"), "hidden");
  assert.ok(
    await evaluate(window, "document.querySelectorAll('.pdf-page canvas').length < 12"),
    "PDF renders nearby pages only",
  );
  await waitFor(window, "document.querySelector('.pdf-text-layer').textContent.includes('Fixture page 1')");
  assert.equal(
    await evaluate(
      window,
      `(()=>{const node=document.querySelector('.pdf-text-layer span');const range=document.createRange();range.selectNodeContents(node);getSelection().removeAllRanges();getSelection().addRange(range);return getSelection().toString();})()`,
    ),
    "Fixture page 1",
  );
  const pixel = () =>
    evaluate(
      window,
      "[...document.querySelector('.pdf-page canvas').getContext('2d').getImageData(1,1,1,1).data].slice(0,3)",
    );
  const themed = await pixel();
  await evaluate(window, "document.querySelector('.pdf-viewer [title*=\"цвета\"]').click()");
  await waitFor(
    window,
    "document.querySelector('.pdf-viewer').dataset.themed === 'false' && !!document.querySelector('.pdf-page canvas')",
  );
  assert.deepEqual(await pixel(), [255, 255, 255]);
  assert.notDeepEqual(themed, [255, 255, 255]);
  // Fullscreen requires real input rather than element.click().
  window.focus();
  window.webContents.focus();
  const fullscreenPoint = await evaluate(
    window,
    `(() => {
    const rect=document.querySelector('.pdf-viewer [title="На весь экран"]').getBoundingClientRect();
    return {x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)};
  })()`,
  );
  window.webContents.sendInputEvent({
    type: "mouseDown",
    button: "left",
    clickCount: 1,
    ...fullscreenPoint,
  });
  window.webContents.sendInputEvent({
    type: "mouseUp",
    button: "left",
    clickCount: 1,
    ...fullscreenPoint,
  });
  await waitFor(window, "!!document.fullscreenElement");
  await evaluate(window, "document.exitFullscreen()");
  await waitFor(window, "!document.fullscreenElement");
  const width = await evaluate(window, "document.querySelector('.pdf-page').getBoundingClientRect().width");
  await evaluate(window, "document.querySelector('[aria-label=\"Увеличить масштаб\"]').click()");
  await waitFor(window, `document.querySelector('.pdf-page').getBoundingClientRect().width > ${width}`);
  await evaluate(
    window,
    `(()=>{const input=document.querySelector('.pdf-page-number input');input.value='10';input.dispatchEvent(new Event('input',{bubbles:true}));input.closest('form').requestSubmit();})()`,
  );
  await waitFor(window, "!!document.querySelector('[data-page=\"10\"] canvas')");
  await waitFor(window, "!document.querySelector('[data-page=\"1\"] canvas')");
  assert.equal(await evaluate(window, "document.querySelector('.pdf-page-number input').value"), "10");
  const original = await evaluate(
    window,
    "fetch(document.querySelector('.pdf-viewer a[download],.pdf-viewer a[href$=\"/download\"]').href).then(r=>r.arrayBuffer()).then(b=>Array.from(new Uint8Array(b)))",
  );
  assert.deepEqual(Buffer.from(original), pdf, "Download keeps original PDF bytes");
  if (process.env.CAMPUS_SMOKE_PDF_SCREENSHOT)
    await writeFile(process.env.CAMPUS_SMOKE_PDF_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
  await evaluate(window, "document.querySelector('.pdf-viewer-document').focus()");
  window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
  await waitFor(window, "!document.querySelector('.pdf-viewer')");
  assert.equal(await evaluate(window, "document.body.style.overflow"), "");
  assert.equal(await evaluate(window, "document.activeElement.className"), "file-card-link");
  // Reconcile fresh JSON snapshots by resource ID, preserving focus, DOM and
  // local expansion while still updating every field read by a component.
  await evaluate(window, "window.originalFile=document.querySelector('.file-card');");
  updatedAt = "2026-10-02T12:00:00Z";
  await evaluate(
    window,
    "fetch('/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(()=>runUiPoll())",
  );
  await waitFor(window, "!!document.querySelector('.file-card.unread')");
  assert.equal(await evaluate(window, "document.querySelector('.file-card')===originalFile"), true);
  await evaluate(window, "document.querySelector('.file-card button').click()");
  await waitFor(window, "!!document.querySelector('.pdf-page canvas') && !document.querySelector('.file-card.unread')");
  await evaluate(window, "document.querySelector('.pdf-viewer [aria-label=\"Закрыть просмотр\"]').click()");
  await waitFor(window, "!document.querySelector('.pdf-viewer')");
  filename = "Renamed.txt";
  updatedAt = "2026-10-03T12:00:00Z";
  await evaluate(
    window,
    "fetch('/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(()=>runUiPoll())",
  );
  await waitFor(
    window,
    "document.querySelector('.file-card h2').textContent==='Renamed.txt' && !!document.querySelector('.file-preview.document')",
  );
  assert.equal(await evaluate(window, "document.querySelector('.file-card')===originalFile"), true);
  await evaluate(window, "location.hash='course=c1&tab=news'");
  await waitFor(window, "!!document.querySelector('.course-news-more')");
  // Finish visibility/read tracking before starting the next controlled poll.
  await frames(window);
  await waitFor(window, "!document.querySelector('.course-rail-dot')");
  await evaluate(
    window,
    "document.querySelector('.course-news-more').click();window.originalNews=document.querySelector('.course-news');",
  );
  newsTitle = "Updated announcement";
  updatedAt = "2026-10-04T12:00:00Z";
  await evaluate(
    window,
    "fetch('/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(()=>runUiPoll())",
  );
  await waitFor(window, "document.querySelector('.course-news h3').textContent==='Updated announcement'");
  assert.equal(await evaluate(window, "document.querySelector('.course-news')===originalNews"), true);
  assert.equal(
    await evaluate(window, "document.querySelector('.course-news-more').getAttribute('aria-expanded')"),
    "true",
  );
  await evaluate(window, "document.querySelector('.account-button').click()");
  await waitFor(window, "!!document.querySelector('#username')");
  assert.deepEqual(errors, [], "No uncaught UI exceptions");
  console.log(
    JSON.stringify({
      result: "passed",
      checks:
        "keyed keyboard/mouse/touch reorder, PDF rendering/text/colors/fullscreen/zoom/page input/virtualization/download/Escape/focus/cleanup, snapshot reconciliation and reactive fields",
    }),
  );
  window.destroy();
  await runtime.close();
  await rm(profile, { recursive: true, force: true });
  clearTimeout(timeout);
  app.quit();
})().catch(async (error) => {
  console.error(error);
  clearTimeout(timeout);
  for (const w of BrowserWindow.getAllWindows()) w.destroy();
  await runtime?.close();
  if (profile) await rm(profile, { recursive: true, force: true });
  app.exit(1);
});
