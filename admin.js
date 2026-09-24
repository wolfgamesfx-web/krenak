const REPO = "wolfgamesfx-web/krenak";
const BRANCH = "preview";
const TOKEN_KEY = "yy_admin_token";

const statusEl = document.getElementById("status");
const tokenInput = document.getElementById("token");
const publishBtn = document.getElementById("publish");

let site = {
  name: "KRENAK",
  subtitle: "DOVUX LIFE RP",
  kicker: "",
  tagline: "",
  kickUrl: "https://kick.com",
  description: "",
  background: "img/wallpaper.webp",
  logo: "img/logo.svg",
  stampTop: "EST. 2024",
  stampMark: "KRK",
  stampBottom: "FAMILIA",
  liveNote: "",
  footerLine: "",
  footerMid: "",
  ranks: [
    { id: 1, label: "Jefe" },
    { id: 2, label: "Campera" },
    { id: 3, label: "Krenak" },
    { id: 4, label: "Shatei" }
  ],
  explore: [],
  lore: []
};
let people = [];
let gallery = [];
let videos = [];
let shas = {};
let editing = -1;

function setStatus(msg, kind) {
  statusEl.textContent = msg;
  statusEl.className = "status" + (kind ? " " + kind : "");
}

function token() {
  return sessionStorage.getItem(TOKEN_KEY) || "";
}

function krenakDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("krenak", 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains("kv")) req.result.createObjectStore("kv");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbSet(key, value) {
  return krenakDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

async function gh(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const url = new URL(`https://api.github.com/repos/${REPO}/contents/${path}`);
  if (method === "GET") url.searchParams.set("ref", BRANCH);
  const res = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text.slice(0, 280) || res.statusText);
  return text ? JSON.parse(text) : {};
}

function b64utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

function decodeContent(file) {
  const clean = String(file.content || "").replace(/\n/g, "");
  const bytes = Uint8Array.from(atob(clean), c => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function escapeAttr(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function readSiteForm() {
  site.name = document.getElementById("site-name").value.trim();
  site.subtitle = document.getElementById("site-subtitle").value.trim();
  site.kicker = document.getElementById("site-kicker").value.trim();
  site.tagline = document.getElementById("site-tagline").value.trim();
  site.kickUrl = document.getElementById("site-kick").value.trim();
  site.liveNote = document.getElementById("site-live-note").value.trim();
  site.description = document.getElementById("site-description").value.trim();
  site.background = document.getElementById("site-background").value.trim();
  site.logo = document.getElementById("site-logo").value.trim();
  site.stampTop = document.getElementById("stamp-top").value.trim();
  site.stampMark = document.getElementById("stamp-mark").value.trim();
  site.stampBottom = document.getElementById("stamp-bottom").value.trim();
  site.footerLine = document.getElementById("footer-line").value.trim();
  site.footerMid = document.getElementById("footer-mid").value.trim();
  site.ranks = [...document.querySelectorAll(".rank-row")].map((row, i) => ({
    id: i + 1,
    label: row.querySelector("input").value.trim() || `Rango ${i + 1}`
  }));
  site.explore = [...document.querySelectorAll(".explore-row")].map(row => ({
    view: row.dataset.view,
    title: row.querySelector("[data-f=title]").value.trim(),
    text: row.querySelector("[data-f=text]").value.trim()
  }));
  site.lore = [...document.querySelectorAll(".lore-edit")].map(row => ({
    year: row.querySelector("[data-f=year]").value.trim(),
    title: row.querySelector("[data-f=title]").value.trim(),
    body: row.querySelector("[data-f=body]").value.trim()
  })).filter(item => item.title || item.body);
  gallery = [...document.querySelectorAll(".gallery-edit")].map(row => ({
    src: row.querySelector("[data-f=src]").value.trim(),
    alt: row.querySelector("[data-f=alt]").value.trim()
  })).filter(item => item.src);
  videos = [...document.querySelectorAll(".video-edit")].map(row => ({
    id: row.querySelector("[data-f=id]").value.trim(),
    title: row.querySelector("[data-f=title]").value.trim(),
    published: row.querySelector("[data-f=published]").value.trim(),
    _channelName: row.querySelector("[data-f=channel]").value.trim()
  })).filter(item => item.id);
}

function fillSiteForm() {
  const set = (id, value) => { document.getElementById(id).value = value || ""; };
  set("site-name", site.name);
  set("site-subtitle", site.subtitle);
  set("site-kicker", site.kicker);
  set("site-tagline", site.tagline);
  set("site-kick", site.kickUrl);
  set("site-live-note", site.liveNote);
  set("site-description", site.description);
  set("site-background", site.background);
  set("site-logo", site.logo);
  set("stamp-top", site.stampTop);
  set("stamp-mark", site.stampMark);
  set("stamp-bottom", site.stampBottom);
  set("footer-line", site.footerLine);
  set("footer-mid", site.footerMid);
  document.getElementById("bg-preview").src = site.background || "";
  document.getElementById("logo-preview").src = site.logo || "";
  renderRanks();
  renderExplore();
  renderLore();
  renderGallery();
  renderVideos();
}

function renderRanks() {
  const box = document.getElementById("ranks");
  box.innerHTML = "";
  (site.ranks || []).forEach(rank => {
    const row = document.createElement("div");
    row.className = "rank-row";
    row.innerHTML = `<input value="${escapeAttr(rank.label)}" /><button type="button" class="ghost">Quitar</button>`;
    row.querySelector("button").onclick = () => row.remove();
    box.appendChild(row);
  });
}

function renderExplore() {
  const box = document.getElementById("explore");
  const items = site.explore?.length ? site.explore : [
    { view: "personajes", title: "Personajes", text: "" },
    { view: "galeria", title: "Galería", text: "" },
    { view: "videos", title: "Videos", text: "" },
    { view: "lore", title: "Lore", text: "" },
    { view: "multikick", title: "MultiKick", text: "" }
  ];
  box.innerHTML = "";
  items.forEach(item => {
    const row = document.createElement("div");
    row.className = "explore-row grid2";
    row.dataset.view = item.view;
    row.innerHTML = `
      <label>Título de ${escapeAttr(item.view)}<input data-f="title" value="${escapeAttr(item.title)}" /></label>
      <label>Texto<input data-f="text" value="${escapeAttr(item.text)}" /></label>`;
    box.appendChild(row);
  });
}

function renderLore() {
  const box = document.getElementById("lore");
  box.innerHTML = "";
  (site.lore || []).forEach(item => box.appendChild(loreRow(item)));
  if (!site.lore?.length) box.innerHTML = `<p class="hint">Sin capítulos.</p>`;
}

function loreRow(item = { year: "", title: "", body: "" }) {
  const row = document.createElement("div");
  row.className = "lore-edit block-edit";
  row.innerHTML = `
    <div class="grid3">
      <label>Año<input data-f="year" value="${escapeAttr(item.year)}" /></label>
      <label>Título<input data-f="title" value="${escapeAttr(item.title)}" /></label>
      <button type="button" class="ghost">Quitar</button>
    </div>
    <label>Texto<textarea data-f="body">${escapeAttr(item.body)}</textarea></label>`;
  row.querySelector("button").onclick = () => row.remove();
  return row;
}

function renderGallery() {
  const box = document.getElementById("gallery");
  box.innerHTML = "";
  if (!gallery.length) {
    box.innerHTML = `<p class="hint">La galería pública está vacía.</p>`;
    return;
  }
  gallery.forEach(item => box.appendChild(galleryRow(item)));
}

function galleryRow(item = { src: "", alt: "" }) {
  const row = document.createElement("div");
  row.className = "gallery-edit media-edit";
  row.innerHTML = `
    <label>Imagen<input data-f="src" value="${escapeAttr(item.src)}" /></label>
    <input data-file type="file" accept="image/*" />
    <label>Pie<input data-f="alt" value="${escapeAttr(item.alt)}" /></label>
    <button type="button" class="ghost">Quitar</button>`;
  row.querySelector("[data-file]").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    row.querySelector("[data-f=src]").value = await fileToDataUrl(file);
  });
  row.querySelector("button").onclick = () => row.remove();
  return row;
}

function renderVideos() {
  const box = document.getElementById("videos");
  box.innerHTML = "";
  if (!videos.length) {
    box.innerHTML = `<p class="hint">No hay videos cargados.</p>`;
    return;
  }
  videos.forEach(item => box.appendChild(videoRow(item)));
}

function videoRow(item = { id: "", title: "", published: "", _channelName: "" }) {
  const row = document.createElement("div");
  row.className = "video-edit block-edit";
  row.innerHTML = `
    <div class="grid2">
      <label>Id de YouTube<input data-f="id" value="${escapeAttr(item.id)}" /></label>
      <label>Título<input data-f="title" value="${escapeAttr(item.title)}" /></label>
      <label>Fecha<input data-f="published" value="${escapeAttr(item.published)}" placeholder="2026-09-24T00:00:00Z" /></label>
      <label>Canal<input data-f="channel" value="${escapeAttr(item._channelName)}" /></label>
    </div>
    <button type="button" class="ghost">Quitar</button>`;
  row.querySelector("button").onclick = () => row.remove();
  return row;
}

function renderPeople() {
  const box = document.getElementById("people");
  box.innerHTML = "";
  if (!people.length) {
    box.innerHTML = `<p class="hint">Todavía no hay personajes. Creá el primero.</p>`;
    return;
  }
  people.forEach((p, i) => {
    const row = document.createElement("div");
    row.className = "person" + (Number(p.activo) === 0 ? " off" : "");
    const rank = (site.ranks || []).find(r => String(r.id) === String(p.rango));
    row.innerHTML = `
      <img src="${escapeAttr(p.foto || site.logo)}" alt="" />
      <div class="who">
        <strong>${escapeAttr(p.nombre)}</strong>
        <span>${escapeAttr(p.ooc || "")}${p.kick ? " · kick:" + escapeAttr(p.kick) : ""} · ${escapeAttr(rank?.label || "sin rango")}</span>
      </div>
      <button type="button" class="ghost" data-edit>Editar</button>
      <button type="button" class="ghost" data-del>Borrar</button>`;
    row.querySelector("[data-edit]").onclick = () => openEditor(i);
    row.querySelector("[data-del]").onclick = () => {
      people.splice(i, 1);
      renderPeople();
    };
    box.appendChild(row);
  });
}

function rankOptions(selected) {
  return (site.ranks || []).map(r =>
    `<option value="${r.id}"${String(r.id) === String(selected) ? " selected" : ""}>${escapeAttr(r.label)}</option>`
  ).join("");
}

function linkRow(link = { label: "", href: "" }) {
  const row = document.createElement("div");
  row.className = "link-row";
  row.innerHTML = `
    <input name="label" placeholder="Instagram" value="${escapeAttr(link.label)}" />
    <input name="href" placeholder="https://" value="${escapeAttr(link.href)}" />
    <button type="button" class="ghost">×</button>`;
  row.querySelector("button").onclick = () => row.remove();
  return row;
}

function openEditor(index) {
  readSiteForm();
  editing = index;
  const p = index >= 0 ? people[index] : {
    nombre: "", ooc: "", alias: "", kick: "", rango: site.ranks?.[0]?.id || 1, foto: "", activo: 1, links: []
  };
  document.getElementById("editor-title").textContent = index >= 0 ? "Editar personaje" : "Nuevo personaje";
  const form = document.getElementById("editor-form");
  form.nombre.value = p.nombre || "";
  form.ooc.value = p.ooc || "";
  form.alias.value = p.alias || "";
  form.kick.value = p.kick || "";
  form.foto.value = p.foto || "";
  form.activo.checked = Number(p.activo ?? 1) !== 0;
  document.getElementById("editor-rank").innerHTML = rankOptions(p.rango);
  const links = document.getElementById("links");
  links.innerHTML = "";
  (p.links || []).forEach(l => links.appendChild(linkRow(l)));
  document.getElementById("editor").showModal();
}

async function fileToDataUrl(file) {
  if (file.type === "image/svg+xml") {
    const text = await file.text();
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(text)))}`;
  }
  const bmp = await createImageBitmap(file);
  const max = 1600;
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

function bindFile(inputId, targetId, previewId) {
  document.getElementById(inputId).addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = await fileToDataUrl(file);
    document.getElementById(targetId).value = url;
    if (previewId) document.getElementById(previewId).src = url;
  });
}

document.getElementById("editor-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.target;
  const links = [...document.querySelectorAll("#links .link-row")].map(row => ({
    label: row.querySelector('[name="label"]').value.trim(),
    href: row.querySelector('[name="href"]').value.trim()
  })).filter(l => l.href);
  const entry = {
    nombre: form.nombre.value.trim(),
    ooc: form.ooc.value.trim(),
    alias: form.alias.value.trim(),
    kick: form.kick.value.trim().toLowerCase(),
    rango: Number(form.rango.value),
    foto: form.foto.value.trim(),
    activo: form.activo.checked ? 1 : 0,
    links
  };
  if (!entry.nombre) return;
  if (editing >= 0) people[editing] = entry;
  else people.push(entry);
  document.getElementById("editor").close();
  renderPeople();
  persist();
});

document.getElementById("editor-cancel").onclick = () => document.getElementById("editor").close();
document.getElementById("add-person").onclick = () => openEditor(-1);
document.getElementById("add-link").onclick = () => document.getElementById("links").appendChild(linkRow());
document.getElementById("add-rank").onclick = () => {
  readSiteForm();
  site.ranks.push({ id: site.ranks.length + 1, label: "Nuevo rango" });
  renderRanks();
};
document.getElementById("add-lore").onclick = () => {
  const box = document.getElementById("lore");
  box.querySelector(".hint")?.remove();
  box.appendChild(loreRow({ year: "HOY", title: "", body: "" }));
};
document.getElementById("add-photo").onclick = () => {
  const box = document.getElementById("gallery");
  box.querySelector(".hint")?.remove();
  box.appendChild(galleryRow());
};
document.getElementById("add-video").onclick = () => {
  const box = document.getElementById("videos");
  box.querySelector(".hint")?.remove();
  box.appendChild(videoRow());
};
document.getElementById("foto-file").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  document.querySelector('#editor-form [name="foto"]').value = await fileToDataUrl(file);
});

["site-background", "site-logo"].forEach(id => {
  document.getElementById(id).addEventListener("input", () => {
    const key = id === "site-background" ? "bg-preview" : "logo-preview";
    document.getElementById(key).src = document.getElementById(id).value.trim();
  });
});
bindFile("site-background-file", "site-background", "bg-preview");
bindFile("site-logo-file", "site-logo", "logo-preview");

document.querySelectorAll(".tabs button").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("on", b === btn));
    document.querySelectorAll(".panel").forEach(panel => {
      panel.classList.toggle("hidden", panel.id !== `panel-${btn.dataset.panel}`);
    });
  };
});

async function loadJson(path, fallback) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) return fallback;
  return res.json();
}

async function loadLocal() {
  const [siteJson, dataJson, galleryJson, videosJson] = await Promise.all([
    loadJson("site.json", null),
    loadJson("data.json", []),
    loadJson("gallery.json", []),
    loadJson("videos.json", [])
  ]);
  if (siteJson) site = siteJson;
  people = Array.isArray(dataJson) ? dataJson : [];
  gallery = Array.isArray(galleryJson) ? galleryJson : [];
  videos = Array.isArray(videosJson) ? videosJson : [];
}

async function pullFile(path) {
  const file = await gh(path);
  shas[path] = file.sha;
  return decodeContent(file);
}

async function connect() {
  const value = tokenInput.value.trim();
  if (value) sessionStorage.setItem(TOKEN_KEY, value);
  if (!token()) {
    setStatus("Sin token igual podés guardar: se ve en este navegador. El token hace falta para que lo vean los demás.", "err");
    return;
  }
  setStatus("Conectando…");
  site = await pullFile("site.json");
  people = await pullFile("data.json");
  gallery = await pullFile("gallery.json");
  videos = await pullFile("videos.json");
  if (!Array.isArray(people)) people = [];
  if (!Array.isArray(gallery)) gallery = [];
  if (!Array.isArray(videos)) videos = [];
  publishBtn.disabled = false;
  fillSiteForm();
  renderPeople();
  setStatus(`Conectado. ${people.length} personajes en la página.`, "ok");
}

async function uploadDataUrl(dataUrl, name) {
  const match = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return dataUrl;
  const kind = match[1];
  const ext = kind.includes("svg") ? "svg" : kind.includes("png") ? "png" : kind.includes("webp") ? "webp" : "jpg";
  const path = `img/uploads/${name}-${Date.now()}.${ext}`;
  const saved = await gh(path, {
    method: "PUT",
    body: JSON.stringify({
      message: "Sube imagen del sitio",
      content: match[2],
      branch: BRANCH
    })
  });
  shas[path] = saved.content && saved.content.sha;
  return path;
}

async function materialize(value, name) {
  if (typeof value === "string" && value.startsWith("data:")) return uploadDataUrl(value, name);
  return value;
}

async function rememberLocal() {
  await idbSet("bundle", { site, people, gallery, videos, savedAt: Date.now() });
}

async function persist() {
  readSiteForm();
  publishBtn.disabled = true;
  try {
    await rememberLocal();
    if (!token()) {
      setStatus("Quedó guardado en esta computadora. Abrí la página en este mismo navegador y ya se ve. Para que lo vean los demás, pegá el token arriba, tocá Conectar y volvé a guardar.", "err");
      return;
    }
    await publish();
  } catch (err) {
    setStatus(err.message || "No se pudo guardar", "err");
  } finally {
    publishBtn.disabled = false;
  }
}

async function publish() {
  if (!token()) {
    setStatus("Falta el token de GitHub para que lo vean los demás.", "err");
    return;
  }
  publishBtn.disabled = true;
  setStatus("Subiendo imágenes y textos…");
  try {
    site.logo = await materialize(site.logo, "logo");
    site.background = await materialize(site.background, "fondo");
    for (let i = 0; i < people.length; i++) {
      people[i].foto = await materialize(people[i].foto, `persona-${i + 1}`);
    }
    for (let i = 0; i < gallery.length; i++) {
      gallery[i].src = await materialize(gallery[i].src, `galeria-${i + 1}`);
    }
    await saveFile("site.json", JSON.stringify(site, null, 2) + "\n", "Actualiza el sitio");
    await saveFile("data.json", JSON.stringify(people, null, 2) + "\n", "Actualiza personajes");
    await saveFile("gallery.json", JSON.stringify(gallery, null, 2) + "\n", "Actualiza galeria");
    await saveFile("videos.json", JSON.stringify(videos, null, 2) + "\n", "Actualiza videos");
    fillSiteForm();
    await rememberLocal();
    setStatus("Guardado. La página ya lo muestra en este navegador y en uno o dos minutos lo ven todos.", "ok");
  } catch (err) {
    setStatus(err.message || "No se pudo publicar", "err");
  } finally {
    publishBtn.disabled = false;
  }
}

async function saveFile(path, text, message) {
  if (!shas[path]) {
    try {
      const cur = await gh(path);
      shas[path] = cur.sha;
    } catch {
      shas[path] = undefined;
    }
  }
  const body = { message, content: b64utf8(text), branch: BRANCH };
  if (shas[path]) body.sha = shas[path];
  const saved = await gh(path, { method: "PUT", body: JSON.stringify(body) });
  shas[path] = saved.content && saved.content.sha;
}

document.getElementById("connect").onclick = () => {
  connect().catch(err => setStatus(err.message || "No conectó", "err"));
};
document.getElementById("publish").onclick = () => persist();
document.getElementById("import-legacy").onclick = async () => {
  const res = await fetch("data.legacy.json", { cache: "no-cache" });
  if (!res.ok) {
    setStatus("No está el roster anterior.", "err");
    return;
  }
  const json = await res.json();
  if (!Array.isArray(json)) return;
  people = json;
  renderPeople();
  setStatus(`Roster anterior cargado (${people.length}). Todavía no está publicado.`, "ok");
};

loadLocal().then(() => {
  fillSiteForm();
  renderPeople();
  const saved = token();
  if (saved) {
    tokenInput.value = saved;
    publishBtn.disabled = false;
    setStatus("Token de esta pestaña listo. Conectá si querés traer lo último de GitHub.");
  } else {
    setStatus("Subí lo que quieras y tocá Guardar en la página. En este navegador se ve al instante.");
  }
}).catch(err => setStatus(err.message || "No se pudo leer la config", "err"));
