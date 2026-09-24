    // ===== Utilidades =====
    let RANKS = { "1": "Jefe", "2": "Campera", "3": "Yakuza", "4": "Shatei" };
    let SITE = {
      name: "YAKUZA",
      subtitle: "DOVUX LIFE RP",
      description: "",
      background: "img/wallpaper.webp",
      logo: "img/logo.png",
      ranks: [
        { id: 1, label: "Jefe" },
        { id: 2, label: "Campera" },
        { id: 3, label: "Yakuza" },
        { id: 4, label: "Shatei" }
      ]
    };
    const FALLBACK_AVATAR = 'img/logo.png';
    const rankLabel = v => RANKS[String(v)] ?? "-";
    const norm = s => (s || "").toString().normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
    const debounce = (fn, ms=200) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; };

    function escapeHtml(s) {
      return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function decodeHtmlEntities(s) {
      return String(s ?? '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
    }

    function isValidKickSlug(kick) {
      if (!kick) return false;
      const s = String(kick).trim().toLowerCase();
      return s.length > 0 && !/^x+$/i.test(s);
    }

    function isCharacterActive(p) {
      return Number(p?.activo ?? 1) !== 0;
    }

    function sanitizeCharacters(list = []) {
      const seen = new Set();
      const sanitized = [];
      list.forEach(item => {
        const entry = normalizeCharacter(item);
        if (!entry) return;
        const key = `${entry.nombre.toLowerCase()}|${entry.kick || ''}`;
        if (seen.has(key)) return;
        seen.add(key);
        sanitized.push(entry);
      });
      return sanitized;
    }

    function normalizeCharacter(raw = {}) {
      const nombre = (raw.nombre || '').trim();
      if (!nombre) return null;
      const alias = (raw.alias || '').trim();
      const ooc = (raw.ooc || '').trim();
      const rango = Number(raw.rango ?? raw.rank);
      const kickRaw = raw.kick ? String(raw.kick).trim().toLowerCase() : undefined;
      const kick = isValidKickSlug(kickRaw) ? kickRaw : undefined;
      const foto = (raw.foto || '').trim() || FALLBACK_AVATAR;
      const links = normalizeLinks(raw.links);
      const activo = Number(raw.activo ?? raw.active ?? 1) === 0 ? 0 : 1;

      return {
        ...raw,
        nombre,
        alias,
        ooc,
        rango: Number.isFinite(rango) ? rango : undefined,
        kick,
        foto,
        links,
        activo,
      };
    }

    function normalizeLinks(list) {
      if (!Array.isArray(list)) return [];
      return list
        .map(link => {
          if (!link) return null;
          const label = (link.label || '').trim();
          const href = safeUrl(link.href);
          if (!href) return null;
          return { label, href, type: link.type };
        })
        .filter(Boolean);
    }

    function safeUrl(value) {
      try {
        const url = new URL(String(value));
        return url.href;
      } catch {
        return null;
      }
    }

    function driveIdFrom(url){
      try{
        const u = new URL(url);
        if (u.hostname.includes('googleusercontent.com')) {
          const part = u.pathname.split('/d/')[1] || "";
          return (part.split('=')[0] || "").trim();
        }
        return (u.searchParams.get('id') || "").trim();
      }catch{ return ""; }
    }
    const driveThumb = id => `https://lh3.googleusercontent.com/d/${id}=w800`;   // grilla
    const driveFull  = id => `https://lh3.googleusercontent.com/d/${id}=w2400`;  // lightbox
    const driveDL    = id => `https://drive.google.com/uc?export=download&id=${id}`;


    let DATA = [];
    let liveRefreshTimer = null;
    let rotateTimer = null;
    let LIVE_QUEUE = [];
    let LIVE_INDEX = 0;
    let ROTATOR_OPEN = true;

    // Videos
    let videosTimer = null;
    const VIDEOS_REFRESH_MS = 5 * 60_000;
    let VIDEOS_CACHE = { t: 0, items: [] };
    const VIDEOS_LIST_TTL = 5 * 60_000;

    // ===== LIVE STATUS desde live.json (generado por GitHub Actions) =====
    // Revertir poll hibrido: YY_LIVE.clientKickRefresh = false
    // o: git checkout backup-pre-live-hybrid -- apps.js .github/workflows/
    const YY_LIVE = {
      clientKickRefresh: true,
      jsonTtlMs: 45_000,
      clientSweepMinGapMs: 90_000,
      clientConcurrency: 4,
      clientRetryAfterMs: 5 * 60_000,
    };

    let LIVE_CACHE = { t: 0, map: new Map(), jsonUpdatedAt: 0 };
    let lastLiveSnapshot = new Map();
    let lastClientSweep = 0;
    let clientKickDisabledUntil = 0;
    let clientConsecutiveFails = 0;
    let liveBootstrapped = false;

    function getActiveKickSlugs() {
      return [...new Set(
        DATA
          .filter(p => isCharacterActive(p) && p.kick && isValidKickSlug(p.kick))
          .map(p => String(p.kick).toLowerCase())
      )];
    }

    function isLiveJsonStale() {
      if (!LIVE_CACHE.jsonUpdatedAt) return true;
      return Date.now() - LIVE_CACHE.jsonUpdatedAt > 5 * 60_000;
    }

    function preserveClientEntries() {
      const overlay = new Map();
      for (const [slug, entry] of LIVE_CACHE.map) {
        if (entry?.source === 'client') overlay.set(slug, entry);
      }
      return overlay;
    }

    function mergeClientEntries(overlay) {
      for (const [slug, entry] of overlay) {
        const current = LIVE_CACHE.map.get(slug);
        const entryTime = new Date(entry.updatedAt).getTime();
        const currentTime = current?.updatedAt ? new Date(current.updatedAt).getTime() : 0;
        if (!current || entryTime >= currentTime || current.error || current.stale) {
          LIVE_CACHE.map.set(slug, entry);
        }
      }
    }

    function liveJsonHasErrors() {
      for (const entry of LIVE_CACHE.map.values()) {
        if (entry?.error) return true;
      }
      return false;
    }

    function needsLiveView() {
      const visible = id => !document.getElementById('view-' + id)?.classList.contains('hidden');
      if (visible('inicio') || visible('personajes') || visible('multikick')) return true;
      const rotator = document.getElementById('live-rotator');
      return rotator && !rotator.classList.contains('hidden');
    }

    function getClientPollSlugs() {
      const slugs = getActiveKickSlugs();
      if (!slugs.length) return [];

      const live = slugs.filter(s => LIVE_CACHE.map.get(s)?.live === true);
      const rest = slugs.filter(s => !live.includes(s));
      return [...live, ...rest];
    }

    async function fetchKickClient(slug) {
      const url = `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`;
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 8000);
      try {
        const res = await fetch(url, {
          signal: ac.signal,
          cache: 'no-store',
          headers: {
            accept: 'application/json',
            'accept-language': 'es-UY,es;q=0.9,en;q=0.8',
            referer: `https://kick.com/${slug}`,
          },
        });
        clearTimeout(timer);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const live = Boolean(data?.livestream);
        return {
          slug,
          platform: 'kick',
          live,
          viewers: live ? (data?.livestream?.viewers ?? 0) : 0,
          thumb: live ? (data?.livestream?.thumbnail?.url ?? null) : null,
          updatedAt: new Date().toISOString(),
          source: 'client',
        };
      } catch {
        clearTimeout(timer);
        return null;
      }
    }

    async function fetchKickClientBatch(slugs) {
      const out = [];
      let i = 0;
      const workers = Math.min(YY_LIVE.clientConcurrency, slugs.length);

      async function worker() {
        while (true) {
          const idx = i++;
          if (idx >= slugs.length) break;
          const r = await fetchKickClient(slugs[idx]);
          if (r) out.push(r);
        }
      }

      await Promise.all(Array.from({ length: Math.max(1, workers) }, worker));
      return out;
    }

    async function maybeClientKickRefresh({ force = false, bootstrap = false } = {}) {
      if (!YY_LIVE.clientKickRefresh) return;
      if (Date.now() < clientKickDisabledUntil) return;
      if (!bootstrap && (document.hidden || !needsLiveView())) return;
      if (!force && !bootstrap && Date.now() - lastClientSweep < YY_LIVE.clientSweepMinGapMs) return;

      const slugs = getClientPollSlugs();
      if (!slugs.length) return;

      lastClientSweep = Date.now();
      const results = await fetchKickClientBatch(slugs);
      if (!results.length) {
        clientConsecutiveFails += 1;
        if (clientConsecutiveFails >= 2) {
          clientKickDisabledUntil = Date.now() + YY_LIVE.clientRetryAfterMs;
          clientConsecutiveFails = 0;
        }
        return;
      }

      clientConsecutiveFails = 0;
      for (const entry of results) {
        LIVE_CACHE.map.set(entry.slug, entry);
      }
      liveBootstrapped = true;
    }

    async function getLiveMap({ force = false, skipClient = false } = {}) {
      const now = Date.now();
      const clientOverlay = preserveClientEntries();

      if (!force && now - LIVE_CACHE.t < YY_LIVE.jsonTtlMs) {
        mergeClientEntries(clientOverlay);
        if (!skipClient && (needsLiveView() || !liveBootstrapped)) {
          await maybeClientKickRefresh({ force: !liveBootstrapped });
        }
        return LIVE_CACHE.map;
      }

      try {
        const res = await fetch(`live.json?t=${now}`, { cache: 'no-cache' });
        if (!res.ok) {
          mergeClientEntries(clientOverlay);
          if (!skipClient && (needsLiveView() || !liveBootstrapped)) {
            await maybeClientKickRefresh({ force: true });
          }
          return LIVE_CACHE.map;
        }
        const raw = await res.json();

        const arr = (Array.isArray(raw) ? raw : []).filter(x => x && x.slug);
        const map = new Map(arr.map(x => [String(x.slug).toLowerCase(), x]));
        let jsonUpdatedAt = 0;
        for (const x of arr) {
          if (!x.updatedAt) continue;
          const t = new Date(x.updatedAt).getTime();
          if (Number.isFinite(t)) jsonUpdatedAt = Math.max(jsonUpdatedAt, t);
        }

        LIVE_CACHE = { t: now, map, jsonUpdatedAt: jsonUpdatedAt || now };
        mergeClientEntries(clientOverlay);
      } catch {
        mergeClientEntries(clientOverlay);
      }

      if (!skipClient && (needsLiveView() || !liveBootstrapped)) {
        await maybeClientKickRefresh({
          force: !liveBootstrapped || force || isLiveJsonStale(),
        });
      }
      return LIVE_CACHE.map;
    }

    async function bootstrapLiveStatus() {
      if (!DATA.length || liveBootstrapped) return;
      await getLiveMap({ force: true, skipClient: true });
      await maybeClientKickRefresh({ force: true, bootstrap: true });
    }

    // ===== MULTIKICK (sin "return" y leyendo live.json) =====
    const MK = {};
    (() => {
      let selected = new Set();
      let cachedLive = [];

      async function liveListAsync() {
        const LIVE_MAP = await getLiveMap();
        return DATA.filter(p => isCharacterActive(p) && p.kick && LIVE_MAP.get(p.kick)?.live === true);
      }

      function updateCount() {
        const countEl = document.getElementById('mk-count');
        if (countEl) countEl.textContent = `${selected.size} seleccionados`;
      }

      function renderChips(live) {
        const box = document.getElementById('mk-live-list');
        if (!box) return;

        if (!live.length) {
          box.innerHTML = '<p class="text-sm text-neutral-500">No hay streams en vivo.</p>';
          updateCount();
          return;
        }

        box.innerHTML = [...live].reverse().map(p => {
          const sel = selected.has(p.kick);
          return `
            <button type="button" class="mk-picker-btn ${sel ? 'mk-picker-btn-active' : ''}"
                    data-slug="${p.kick}" aria-label="${p.nombre}">
              <img src="${p.foto || FALLBACK_AVATAR}" alt="" loading="lazy" decoding="async" />
            </button>
          `;
        }).join('');

        updateCount();
      }

      function bestMkGrid(n, w, h, gap = 6) {
        const aspect = 16 / 9;
        let best = { cols: 1, rows: n, score: 0 };
        for (let cols = 1; cols <= n; cols++) {
          const rows = Math.ceil(n / cols);
          const cellW = (w - gap * (cols - 1)) / cols;
          const cellH = (h - gap * (rows - 1)) / rows;
          if (cellW <= 0 || cellH <= 0) continue;
          const vidW = Math.min(cellW, cellH * aspect);
          const vidH = Math.min(cellH, cellW / aspect);
          const score = vidW * vidH;
          if (score > best.score) best = { cols, rows, score };
        }
        return best;
      }

      function applyMkLayout(count = selected.size) {
        const grid = document.getElementById('mk-grid');
        const root = document.getElementById('view-multikick');
        if (!grid) return;

        grid.classList.remove('mk-grid-cols-2', 'mk-grid-cols-3', 'mk-grid-cols-4');

        if (!count) {
          grid.style.removeProperty('grid-template-columns');
          grid.style.removeProperty('grid-template-rows');
          grid.style.removeProperty('--mk-gap');
          delete grid.dataset.mkCount;
          delete grid.dataset.mkCols;
          delete grid.dataset.mkRows;
          return;
        }

        const fullscreen = root?.classList.contains('mk-is-fullscreen');
        const gap = fullscreen ? 6 : 16;
        let cols;
        let rows;

        if (fullscreen) {
          const layout = bestMkGrid(count, window.innerWidth, window.innerHeight, gap);
          cols = layout.cols;
          rows = layout.rows;
          grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
          grid.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
        } else {
          const w = grid.clientWidth || root?.clientWidth || window.innerWidth;
          if (count === 1) {
            cols = 1;
            rows = 1;
          } else if (w < 640) {
            cols = 1;
            rows = count;
          } else if (count === 2) {
            cols = 2;
            rows = 1;
          } else if (count === 3) {
            cols = 2;
            rows = 2;
          } else if (count === 4) {
            cols = 2;
            rows = 2;
          } else {
            const layout = bestMkGrid(
              count,
              w,
              Math.ceil(count / 2) * ((w / 2) * 9 / 16) + gap * Math.ceil(count / 2),
              gap
            );
            cols = layout.cols;
            rows = layout.rows;
          }
          grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
          grid.style.removeProperty('grid-template-rows');
        }

        grid.style.setProperty('--mk-gap', `${gap}px`);
        grid.dataset.mkCount = String(count);
        grid.dataset.mkCols = String(cols);
        grid.dataset.mkRows = String(rows);
      }

      function bindMkLayoutWatch() {
        if (bindMkLayoutWatch.done) return;
        bindMkLayoutWatch.done = true;
        const grid = document.getElementById('mk-grid');
        const onResize = () => applyMkLayout();
        window.addEventListener('resize', onResize);
        if (grid) new ResizeObserver(onResize).observe(grid);
      }

      function setGridCols(n) {
        applyMkLayout(n);
      }

      function playerSrc(slug) {
        return `https://player.kick.com/${encodeURIComponent(slug)}?autoplay=true&muted=true`;
      }

      function pausePlayers() {
        document.querySelectorAll('#mk-grid .mk-player iframe').forEach(iframe => {
          if (iframe.src) iframe.dataset.mkSrc = iframe.src;
          iframe.removeAttribute('src');
        });
      }

      function resumePlayers() {
        document.querySelectorAll('#mk-grid .mk-player').forEach(wrap => {
          const slug = wrap.dataset.slug;
          const iframe = wrap.querySelector('iframe');
          if (!iframe || !slug || iframe.src) return;
          iframe.src = iframe.dataset.mkSrc || playerSrc(slug);
        });
      }

      function exitFullscreenIfNeeded() {
        const root = document.getElementById('view-multikick');
        const inFs = root && (
          document.fullscreenElement === root ||
          document.webkitFullscreenElement === root ||
          document.msFullscreenElement === root
        );
        if (!inFs) return;
        const ex = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
        ex?.call(document);
      }

      function createPlayer(slug) {
        const wrap = document.createElement('div');
        wrap.className = 'mk-player';
        wrap.dataset.slug = slug;
        const iframe = document.createElement('iframe');
        iframe.src = playerSrc(slug);
        iframe.allow = 'autoplay; fullscreen';
        iframe.loading = 'lazy';
        iframe.title = `Stream ${slug}`;
        wrap.appendChild(iframe);
        return wrap;
      }

      function syncGrid() {
        const grid = document.getElementById('mk-grid');
        if (!grid) return;

        const slugs = [...selected];
        setGridCols(slugs.length);

        grid.querySelectorAll('.mk-player').forEach(el => {
          if (!selected.has(el.dataset.slug)) el.remove();
        });

        slugs.forEach(slug => {
          if (grid.querySelector(`.mk-player[data-slug="${CSS.escape(slug)}"]`)) return;
          grid.appendChild(createPlayer(slug));
        });

        const order = new Map(slugs.map((slug, i) => [slug, i]));
        [...grid.querySelectorAll('.mk-player')].sort((a, b) => {
          return (order.get(a.dataset.slug) ?? 0) - (order.get(b.dataset.slug) ?? 0);
        }).forEach(el => grid.appendChild(el));

        updateCount();
      }

      function clearGrid() {
        const grid = document.getElementById('mk-grid');
        if (grid) grid.innerHTML = '';
        updateCount();
      }

      async function refresh(first = false) {
        cachedLive = await liveListAsync();
        if (!cachedLive.length) {
          selected.clear();
          renderChips(cachedLive);
          clearGrid();
          return;
        }
        const liveSlugs = cachedLive.map(p => p.kick);
        selected = new Set([...selected].filter(s => liveSlugs.includes(s)));
        if (first && selected.size === 0) cachedLive.forEach(p => selected.add(p.kick));
        renderChips(cachedLive);
        syncGrid();
      }

      function toggleSlug(slug) {
        if (selected.has(slug)) selected.delete(slug);
        else selected.add(slug);
        renderChips(cachedLive);
        syncGrid();
      }

      async function manualRefresh() {
        LIVE_CACHE = { t: 0, map: new Map(), jsonUpdatedAt: 0 };
        lastClientSweep = 0;
        clientKickDisabledUntil = 0;
        clientConsecutiveFails = 0;
        await refresh(false);
      }

      let mkActive = false;

      async function open() {
        if (!Array.isArray(DATA) || DATA.length === 0) {
          document.addEventListener('yy:data-ready', () => { open(); }, { once: true });
          return;
        }
        bindMkLayoutWatch();
        if (mkActive) {
          resumePlayers();
          applyMkLayout();
          return;
        }
        mkActive = true;

        if (document.querySelectorAll('#mk-grid .mk-player').length) {
          resumePlayers();
          applyMkLayout();
          return;
        }
        await refresh(true);
      }

      function stop() {
        if (!mkActive) return;
        mkActive = false;
        pausePlayers();
        exitFullscreenIfNeeded();
      }

      document.getElementById('view-multikick')?.addEventListener('click', (e) => {
        const chip = e.target.closest('.mk-picker-btn');
        if (chip?.dataset.slug) {
          toggleSlug(chip.dataset.slug);
          return;
        }
        if (e.target.closest('#mk-clear')) {
          selected.clear();
          clearGrid();
          renderChips(cachedLive);
          return;
        }
        if (e.target.closest('#mk-refresh')) {
          const refreshBtn = e.target.closest('#mk-refresh');
          refreshBtn?.classList.add('mk-btn-spin');
          manualRefresh().finally(() => refreshBtn?.classList.remove('mk-btn-spin'));
          return;
        }
        if (e.target.closest('#mk-select-all')) {
          selected = new Set(cachedLive.map(p => p.kick));
          renderChips(cachedLive);
          syncGrid();
        }
      });

      MK.open = open; MK.stop = stop; MK.refresh = manualRefresh;
      MK.syncGrid = syncGrid;
      MK.applyLayout = applyMkLayout;
    })();

    // ==== Fullscreen para MultiKick ====
    (function () {
      const btn = document.getElementById('mk-full');
      if (!btn) return;

      const root = document.getElementById('view-multikick');
      const hudBar = root?.querySelector('.mk-bar');
      const HIDE_MS = 3000;
      const TOP_ZONE = 72;
      let hideTimer = null;

      const isFS = () =>
        document.fullscreenElement === root ||
        document.webkitFullscreenElement === root ||
        document.msFullscreenElement === root;

      const enterFS = () => {
        const req = root.requestFullscreen || root.webkitRequestFullscreen || root.msRequestFullscreen;
        if (req) req.call(root);
      };

      const exitFS = () => {
        const ex = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
        if (ex) ex.call(document);
      };

      const clearHideTimer = () => {
        if (hideTimer) {
          clearTimeout(hideTimer);
          hideTimer = null;
        }
      };

      const hideHud = () => {
        if (isFS()) root.classList.add('mk-hud-hidden');
      };

      const scheduleHide = () => {
        clearHideTimer();
        hideTimer = setTimeout(hideHud, HIDE_MS);
      };

      const showHud = () => {
        root.classList.remove('mk-hud-hidden');
        scheduleHide();
      };

      const updateLabel = () => {
        const active = isFS();
        root.classList.toggle('mk-is-fullscreen', active);
        root.classList.remove('mk-hud-hidden');
        clearHideTimer();
        btn.textContent = active ? 'Salir' : 'Pantalla completa';
        MK.applyLayout?.();
        if (active) scheduleHide();
      };

      root.addEventListener('mousemove', (e) => {
        if (!isFS()) return;
        const y = e.clientY - root.getBoundingClientRect().top;
        if (y <= TOP_ZONE) showHud();
      });

      hudBar?.addEventListener('mouseenter', () => {
        if (!isFS()) return;
        clearHideTimer();
        root.classList.remove('mk-hud-hidden');
      });

      hudBar?.addEventListener('mouseleave', () => {
        if (!isFS()) return;
        scheduleHide();
      });

      btn.addEventListener('click', () => (isFS() ? exitFS() : enterFS()));
      document.addEventListener('fullscreenchange', updateLabel);
      document.addEventListener('webkitfullscreenchange', updateLabel);
      updateLabel();
    })();

    // ===== Tabs =====
    const VIEWS = ['inicio','personajes','galeria','videos','lore','multikick'];
    const TAB_ACTIVE   = 'tab tab-active';
    const TAB_INACTIVE = 'tab';

    function styleTabs(activeId) {
      document.querySelectorAll('.tab[data-view]').forEach(btn => {
        const id = btn.dataset.view;
        btn.className = (id === activeId) ? TAB_ACTIVE : TAB_INACTIVE;
      });
    }
    function shouldHideRotator(view) {
      return view === 'inicio' || view === 'multikick';
    }

    const headerNav = document.getElementById('header-nav');
    const headerMenuToggle = document.getElementById('header-menu-toggle');

    function closeHeaderMenu() {
      headerNav?.classList.remove('header-nav-open');
      headerMenuToggle?.setAttribute('aria-expanded', 'false');
      headerMenuToggle?.setAttribute('aria-label', 'Abrir menú');
    }

    headerMenuToggle?.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = headerNav?.classList.toggle('header-nav-open');
      headerMenuToggle.setAttribute('aria-expanded', String(!!open));
      headerMenuToggle.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.site-header')) closeHeaderMenu();
    });

    function viewFromHash() {
      const id = (location.hash || '').replace(/^#/, '').toLowerCase();
      return VIEWS.includes(id) ? id : 'inicio';
    }

    function pauseHomePlayers() {
      ['home-player', 'home-chat'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (el.src) el.dataset.yySrc = el.src;
        el.removeAttribute('src');
      });
    }

    function pauseRotator() {
      const iframe = document.getElementById('live-iframe');
      if (iframe?.src) iframe.dataset.yySrc = iframe.src;
      iframe?.removeAttribute('src');
      clearInterval(rotateTimer);
      rotateTimer = null;
    }

    function showView(v, { updateHash = true } = {}) {
      if (!VIEWS.includes(v)) v = 'inicio';

      VIEWS.forEach(id => {
        const el = document.getElementById('view-'+id);
        if (el) el.classList.toggle('hidden', id !== v);
      });
      styleTabs(v);
      closeHeaderMenu();

      if (updateHash && location.hash !== `#${v}`) {
        location.hash = v;
      }

      if (v === 'inicio') { renderHome(); }
      else {
        stopHomeRotation();
        pauseHomePlayers();
      }
      if (v === 'personajes' && DATA.length) { render(); }
      if (v === 'galeria') { loadGallery(); }
      if (v === 'videos') { loadVideos(); }
      if (v === 'lore') {
        loadLore().then(() => requestAnimationFrame(refreshLoreReveal));
      }

      if (v === 'multikick') { MK.open?.(); }
      else { MK.stop?.(); }

      const rotator = document.getElementById('live-rotator');
      if (shouldHideRotator(v)) {
        rotator?.classList.add('hidden');
        pauseRotator();
      } else if (ROTATOR_OPEN && LIVE_QUEUE.length > 0) {
        rotator?.classList.remove('hidden');
        if (!rotateTimer) startRotation();
        else setIframeTo(LIVE_QUEUE[LIVE_INDEX % LIVE_QUEUE.length]);
      }
    }

    window.addEventListener('hashchange', () => {
      showView(viewFromHash(), { updateHash: false });
    });
    document.addEventListener('click', (e) => {
      const goto = e.target.closest('[data-goto]');
      if (goto) { showView(goto.dataset.goto); return; }
      const tab = e.target.closest('.tab[data-view]');
      if (tab) showView(tab.dataset.view);
    });

    function applySite(site) {
      const name = site.name || "YAKUZA";
      const subtitle = site.subtitle || "";
      const titleEl = document.querySelector(".header-title");
      const subEl = document.querySelector(".header-subtitle");
      if (titleEl) titleEl.textContent = name;
      if (subEl) subEl.textContent = subtitle;
      document.querySelectorAll("[data-site-name]").forEach(el => { el.textContent = name; });
      const heroTitle = document.getElementById("hero-title");
      const wordmark = document.getElementById("site-name");
      if (heroTitle) heroTitle.textContent = name;
      if (wordmark) wordmark.textContent = name;
      const kicker = document.getElementById("hero-kicker");
      if (kicker && site.kicker) kicker.textContent = site.kicker;
      const tagline = document.getElementById("hero-tagline");
      if (tagline && site.tagline) tagline.textContent = site.tagline;
      const kickCta = document.getElementById("header-kick");
      if (kickCta && site.kickUrl) kickCta.href = site.kickUrl;
      document.title = name || "KRENAK";
      const desc = document.querySelector('meta[name="description"]');
      if (desc && site.description) desc.setAttribute("content", site.description);
      const logo = document.querySelector(".header-logo");
      if (logo && site.logo) logo.src = site.logo;
      const bg = document.querySelector(".fixed picture img");
      const source = document.querySelector(".fixed picture source");
      if (site.background) {
        if (bg) bg.src = site.background;
        if (source) source.srcset = site.background;
        const heroBg = document.querySelector(".hero-bg");
        if (heroBg) heroBg.src = site.background;
      }
      if (Array.isArray(site.ranks) && site.ranks.length) {
        RANKS = {};
        site.ranks.forEach(r => { RANKS[String(r.id)] = r.label; });
        const rango = document.getElementById("rango");
        if (rango) {
          const current = rango.value;
          rango.innerHTML = '<option value="">Todos</option>' + site.ranks
            .map(r => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.label)}</option>`)
            .join("");
          rango.value = current;
        }
        const chips = document.getElementById("rank-chips");
        if (chips) {
          chips.innerHTML = `<button type="button" class="chip on" data-rank="">Todos</button>` + site.ranks
            .map(r => `<button type="button" class="chip" data-rank="${escapeHtml(r.id)}">${escapeHtml(r.label)}</button>`)
            .join("");
        }
      }
    }

    async function loadSite() {
      try {
        const res = await fetch("site.json", { cache: "no-cache" });
        if (!res.ok) return;
        const site = await res.json();
        SITE = { ...SITE, ...site };
        applySite(SITE);
      } catch (e) {
        console.error("Error cargando site.json", e);
      }
    }

    // ===== Data & render Personajes =====
    async function loadData() {
      try {
        setHomeLiveLoading(true);
        await loadSite();
        const res = await fetch('data.json');
        if (!res.ok) throw new Error(`No se pudieron cargar los datos (HTTP ${res.status})`);
        const json = await res.json();
        DATA = sanitizeCharacters(Array.isArray(json) ? json : []);
        document.dispatchEvent(new CustomEvent('yy:data-ready'));
        // Kick real antes del primer render (live.json suele estar desactualizado)
        await bootstrapLiveStatus();
        await renderHome();
        if (viewFromHash() === 'personajes') await render();
      } catch (e) {
        console.error('Error cargando data.json', e);
        setHomeLiveLoading(false);
        document.getElementById('grid').innerHTML =
          '<div class="text-red-400">Error cargando datos. Asegúrate de subir <code>data.json</code> válido.</div>';
      }
    }

    function renderLinkButtons(p) {
      if (!p.links?.length) return '';
      return p.links.map(l => {
        const t = linkType(l);
        const title = escapeHtml(l.label || t.charAt(0).toUpperCase() + t.slice(1));
        return `
          <a class="yy-icon-btn" href="${l.href}" target="_blank" rel="noreferrer" aria-label="${title}" title="${title}">
            ${iconSvg(t)}
          </a>
        `;
      }).join('');
    }

    function renderCharacterCard(p) {
      const kickHtml = p.kick ? `
        <a id="kick-${escapeHtml(p.kick)}"
           data-slug="${escapeHtml(p.kick)}"
           href="https://kick.com/${encodeURIComponent(p.kick)}"
           target="_blank" rel="noreferrer"
           class="kick-btn inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border border-neutral-700/50 bg-neutral-800/50 hover:bg-neutral-700/50">
          <span class="kick-dot inline-block w-2 h-2 rounded-full bg-neutral-500"></span>
          <span class="kick-label">Kick</span>
        </a>
      ` : '';

      const linksHtml = renderLinkButtons(p);
      const actionsHtml = (kickHtml || linksHtml) ? `
        <div class="flex flex-wrap items-center gap-1.5 mt-3 pt-3 border-t border-white/5">
          ${kickHtml}
          ${linksHtml}
        </div>
      ` : '';

      const inactiveClass = isCharacterActive(p) ? '' : ' char-card-inactive';

      return `
        <article class="char-card scroll-reveal group rounded-xl overflow-hidden bg-neutral-900/50 border border-white/5 backdrop-blur-sm hover:border-yakuza/25${inactiveClass}"
                 data-char-key="${escapeHtml(p.kick || p.nombre)}"${p.kick ? ` data-kick="${escapeHtml(p.kick)}"` : ''}>
          <div class="relative aspect-[3/4] overflow-hidden bg-neutral-950">
            <img src="${p.foto || FALLBACK_AVATAR}" alt="${p.nombre}"
                 class="char-photo w-full h-full object-cover object-top" loading="lazy" decoding="async" />
            <div class="char-card-overlay absolute inset-0"></div>
            <span class="char-rank-badge absolute top-2.5 left-2.5 px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide bg-black/55 text-yakuza border border-yakuza/35 backdrop-blur-sm">
              ${escapeHtml(rankLabel(p.rango))}
            </span>
          </div>
          <div class="char-meta">
            ${p.alias ? `<p class="char-alias">${escapeHtml(p.alias)}</p>` : ''}
            <h3 class="char-name">${escapeHtml(p.nombre)}</h3>
            <p class="char-ooc">${escapeHtml(p.ooc || '—')}</p>
            ${actionsHtml}
          </div>
        </article>
      `;
    }

    function renderCharacterLinks(p) {
      const btns = renderLinkButtons(p);
      if (!btns) return '';
      return `<div class="flex flex-wrap gap-1.5 mt-3">${btns}</div>`;
    }

    let HOME_LIVE_LIST = [];
    let HOME_LIVE_INDEX = 0;
    let homeRotateTimer = null;
    const HOME_ROTATE_MS = 20_000;

    function stopHomeRotation() {
      clearInterval(homeRotateTimer);
      homeRotateTimer = null;
    }

    function startHomeRotation() {
      stopHomeRotation();
      if (!isViewVisible('inicio') || HOME_LIVE_LIST.length <= 1 || document.hidden) return;
      homeRotateTimer = setInterval(() => {
        setHomeStream(HOME_LIVE_INDEX + 1);
      }, HOME_ROTATE_MS);
    }

    function setHomeTheaterMode(mode) {
      const shell = document.querySelector('#home-live-theater .live-theater');
      shell?.classList.toggle('home-theater-mode-live', mode === 'live');
      shell?.classList.toggle('home-theater-mode-video', mode === 'video');
      document.getElementById('home-live-badge')?.classList.toggle('hidden', mode !== 'live');
      document.getElementById('home-video-badge')?.classList.toggle('hidden', mode !== 'video');
      document.getElementById('home-info-videos')?.classList.toggle('hidden', mode !== 'video');
    }

    function setHomeVideoFallback(video) {
      if (!video?.id) return;
      setHomeTheaterMode('video');

      const title = decodeHtmlEntities(video.title || 'Video');
      const player = document.getElementById('home-player');
      const chat = document.getElementById('home-chat');
      if (player) {
        player.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(video.id)}`;
        player.title = title;
      }
      if (chat) chat.removeAttribute('src');

      const avatar = document.getElementById('home-info-avatar');
      const nameEl = document.getElementById('home-info-name');
      const aliasEl = document.getElementById('home-info-alias');
      const oocEl = document.getElementById('home-info-ooc');
      const rankEl = document.getElementById('home-info-rank');
      const linksEl = document.getElementById('home-info-links');
      const kickLink = document.getElementById('home-info-kick');

      if (avatar) {
        avatar.src = `https://i.ytimg.com/vi/${encodeURIComponent(video.id)}/hqdefault.jpg`;
        avatar.alt = title;
      }
      if (nameEl) nameEl.textContent = title;
      if (aliasEl) aliasEl.classList.add('hidden');
      if (oocEl) oocEl.textContent = video._channelName || 'YouTube';
      if (rankEl) {
        rankEl.textContent = new Date(video.published).toLocaleString('es-UY', {
          dateStyle: 'medium',
          timeStyle: 'short',
        });
      }
      if (linksEl) linksEl.innerHTML = '';
      if (kickLink) {
        kickLink.href = `https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`;
        kickLink.textContent = 'Ver en YouTube';
        kickLink.classList.remove('hidden');
      }

      document.getElementById('home-prev')?.classList.add('hidden');
      document.getElementById('home-next')?.classList.add('hidden');
      document.getElementById('home-live-pos')?.classList.add('hidden');
    }

    function setHomeStream(index) {
      if (!HOME_LIVE_LIST.length) return;
      HOME_LIVE_INDEX = ((index % HOME_LIVE_LIST.length) + HOME_LIVE_LIST.length) % HOME_LIVE_LIST.length;
      const p = HOME_LIVE_LIST[HOME_LIVE_INDEX];
      const slug = p.kick;

      setHomeTheaterMode('live');

      const player = document.getElementById('home-player');
      const chat = document.getElementById('home-chat');
      if (player) {
        player.src = `https://player.kick.com/${encodeURIComponent(slug)}?autoplay=true&muted=true`;
      }
      if (chat) {
        chat.src = `https://kick.com/popout/${encodeURIComponent(slug)}/chat`;
      }

      const avatar = document.getElementById('home-info-avatar');
      const nameEl = document.getElementById('home-info-name');
      const aliasEl = document.getElementById('home-info-alias');
      const oocEl = document.getElementById('home-info-ooc');
      const rankEl = document.getElementById('home-info-rank');
      const linksEl = document.getElementById('home-info-links');
      const kickLink = document.getElementById('home-info-kick');
      const chatLink = document.getElementById('home-chat-link');

      if (avatar) { avatar.src = p.foto || FALLBACK_AVATAR; avatar.alt = p.nombre; }
      if (nameEl) nameEl.textContent = p.nombre;
      if (aliasEl) {
        aliasEl.textContent = p.alias ? `"${p.alias}"` : '';
        aliasEl.classList.toggle('hidden', !p.alias);
      }
      if (oocEl) oocEl.textContent = p.ooc || '';
      if (rankEl) rankEl.textContent = rankLabel(p.rango);
      if (linksEl) linksEl.innerHTML = renderLinkButtons(p) || '';
      const kickUrl = `https://kick.com/${encodeURIComponent(slug)}`;
      if (kickLink) {
        kickLink.href = kickUrl;
        kickLink.textContent = 'Ver en Kick';
        kickLink.classList.remove('hidden');
      }
      if (chatLink) chatLink.href = `https://kick.com/popout/${encodeURIComponent(slug)}/chat`;

      document.querySelectorAll('.home-picker-btn').forEach((btn, i) => {
        btn.classList.toggle('home-picker-btn-active', i === HOME_LIVE_INDEX);
      });

      updateHomeNav();
    }

    function updateHomeNav() {
      const total = HOME_LIVE_LIST.length;
      const multiple = total > 1;
      const prev = document.getElementById('home-prev');
      const next = document.getElementById('home-next');
      const pos = document.getElementById('home-live-pos');
      prev?.classList.toggle('hidden', !multiple);
      next?.classList.toggle('hidden', !multiple);
      if (pos) {
        pos.classList.toggle('hidden', !multiple);
        pos.textContent = `${HOME_LIVE_INDEX + 1} / ${total}`;
      }
    }

    function renderHomePicker(liveList) {
      const picker = document.getElementById('home-live-picker');
      if (!picker) return;

      if (liveList.length <= 1) {
        picker.innerHTML = '';
        picker.classList.add('hidden');
        picker.classList.remove('home-picker-labeled');
        return;
      }

      const showAlias = liveList.length <= 4;
      picker.classList.toggle('home-picker-labeled', showAlias);
      picker.classList.remove('hidden');
      picker.innerHTML = liveList.map((p, i) => {
        const label = showAlias ? String(p.alias || p.nombre || '').trim() : '';
        return `
        <button type="button" class="home-picker-btn ${i === HOME_LIVE_INDEX ? 'home-picker-btn-active' : ''}"
                data-home-index="${i}" aria-label="${escapeHtml(p.nombre)}">
          <img src="${p.foto || FALLBACK_AVATAR}" alt="" loading="lazy" decoding="async" />
          ${label ? `<span class="home-picker-alias">${escapeHtml(label)}</span>` : ''}
        </button>`;
      }).join('');
    }

    function setHomeLiveLoading(loading) {
      document.getElementById('home-live-loading')?.classList.toggle('hidden', !loading);
      if (!loading) return;
      document.getElementById('home-live-theater')?.classList.add('hidden');
      document.getElementById('home-live-empty')?.classList.add('hidden');
    }

    async function renderHome() {
      if (!DATA.length) return;

      const LIVE_MAP = await getLiveMap();
      setHomeLiveLoading(false);
      const prevKick = HOME_LIVE_LIST[HOME_LIVE_INDEX]?.kick;
      HOME_LIVE_LIST = DATA
        .filter(p => isCharacterActive(p) && p.kick && LIVE_MAP.get(p.kick)?.live === true)
        .sort((a, b) => {
          const ra = Number.isFinite(a.rango) ? a.rango : 999;
          const rb = Number.isFinite(b.rango) ? b.rango : 999;
          if (ra !== rb) return ra - rb; // izquierda → derecha: rango 0, 1, 2...
          return norm(a.nombre).localeCompare(norm(b.nombre));
        });

      // Mantener el stream actual si sigue en vivo; si no, arrancar en el de la izquierda (menor rango)
      if (prevKick) {
        const keep = HOME_LIVE_LIST.findIndex(p => p.kick === prevKick);
        HOME_LIVE_INDEX = keep >= 0 ? keep : 0;
      } else {
        HOME_LIVE_INDEX = 0;
      }

      const theater = document.getElementById('home-live-theater');
      const empty = document.getElementById('home-live-empty');
      const countEl = document.getElementById('home-live-count');

      if (countEl) countEl.textContent = String(HOME_LIVE_LIST.length);

      if (!HOME_LIVE_LIST.length) {
        const videos = await getVideosList();
        const latest = videos[0] || null;

        if (latest) {
          empty?.classList.add('hidden');
          theater?.classList.remove('hidden');
          renderHomePicker(HOME_LIVE_LIST);
          stopHomeRotation();
          setHomeVideoFallback(latest);
        } else {
          theater?.classList.add('hidden');
          empty?.classList.remove('hidden');
          renderHomePicker(HOME_LIVE_LIST);
          stopHomeRotation();
          const player = document.getElementById('home-player');
          const chat = document.getElementById('home-chat');
          if (player) player.removeAttribute('src');
          if (chat) chat.removeAttribute('src');
        }
      } else {
        empty?.classList.add('hidden');
        theater?.classList.remove('hidden');

        if (HOME_LIVE_INDEX >= HOME_LIVE_LIST.length) HOME_LIVE_INDEX = 0;
        renderHomePicker(HOME_LIVE_LIST);
        setHomeStream(HOME_LIVE_INDEX);
        startHomeRotation();
      }

      await updateLiveUI_fromMap(LIVE_MAP);
      syncLiveSnapshotFromData(LIVE_MAP);
      scheduleRender();
    }

    function getFilteredList(LIVE_MAP, { scope = 'activos' } = {}) {
      const q = norm(document.getElementById('q').value);
      const rango = document.getElementById('rango').value;
      const sort = document.getElementById('sort').value;

      const list = DATA.filter(p => {
        const active = isCharacterActive(p);
        if (scope === 'activos' && !active) return false;
        if (scope === 'inactivos' && active) return false;

        const matchQ =
          !q ||
          norm(p.nombre).includes(q) ||
          norm(p.ooc).includes(q) ||
          norm(p.alias || '').includes(q) ||
          norm(rankLabel(p.rango)).includes(q);
        const matchRango = !rango || String(p.rango) === String(rango);
        return matchQ && matchRango;
      });

      list.sort((a, b) => {
        const liveA = LIVE_MAP.get(a.kick)?.live ? 1 : 0;
        const liveB = LIVE_MAP.get(b.kick)?.live ? 1 : 0;
        if (liveB !== liveA) return liveB - liveA;
        switch (sort) {
          case 'rango-asc':  return (b.rango ?? -999) - (a.rango ?? -999);
          case 'rango-desc': return (a.rango ??  999) - (b.rango ??  999);
          case 'nombre-desc': return norm(b.nombre).localeCompare(norm(a.nombre));
          case 'live-desc':   return 0;
          default:            return norm(a.nombre).localeCompare(norm(b.nombre));
        }
      });

      return { list, sort };
    }

    function syncLiveSnapshotFromData(LIVE_MAP) {
      lastLiveSnapshot.clear();
      DATA.forEach(p => {
        if (!p.kick || !isCharacterActive(p)) return;
        lastLiveSnapshot.set(p.kick, LIVE_MAP.get(p.kick)?.live ?? false);
      });
    }

    function cardKeyForPerson(p) {
      return p.kick || p.nombre;
    }

    function reorderPersonajesGrid(LIVE_MAP) {
      const grid = document.getElementById('grid');
      if (!grid?.querySelector('.char-card')) return false;

      const { list } = getFilteredList(LIVE_MAP, { scope: 'activos' });
      const cardsByKey = new Map();
      grid.querySelectorAll('.char-card').forEach(card => {
        const key = card.dataset.charKey;
        if (key) cardsByKey.set(key, card);
      });

      const expectedKeys = list.map(cardKeyForPerson);
      if (expectedKeys.length !== cardsByKey.size) return false;
      for (const key of expectedKeys) {
        if (!cardsByKey.has(key)) return false;
      }

      expectedKeys.forEach(key => grid.appendChild(cardsByKey.get(key)));
      return true;
    }

    async function updatePersonajesLiveOrder(LIVE_MAP) {
      const grid = document.getElementById('grid');
      if (!grid?.querySelector('.char-card')) {
        await render();
        return;
      }
      if (!reorderPersonajesGrid(LIVE_MAP)) await render();
    }

    function isViewVisible(id) {
      return !document.getElementById('view-' + id)?.classList.contains('hidden');
    }

    async function refreshLiveState() {
      await getLiveMap({ force: true });
      const LIVE_MAP = LIVE_CACHE.map;

      let liveChanged = false;
      DATA.forEach(p => {
        if (!p.kick) return;
        const live = LIVE_MAP.get(p.kick)?.live ?? false;
        if (isCharacterActive(p)) {
          const prev = lastLiveSnapshot.get(p.kick);
          if (prev !== undefined && prev !== live) liveChanged = true;
          paintKickButton(p.kick, { live });
        } else {
          paintKickButton(p.kick, { live: false });
        }
      });

      await updateLiveUI_fromMap(LIVE_MAP);

      if (liveChanged) {
        if (isViewVisible('inicio')) {
          const prevSlug = HOME_LIVE_LIST[HOME_LIVE_INDEX]?.kick;
          await renderHome();
          if (prevSlug) {
            const newIdx = HOME_LIVE_LIST.findIndex(p => p.kick === prevSlug);
            if (newIdx >= 0) setHomeStream(newIdx);
          }
          startHomeRotation();
        }
        if (isViewVisible('personajes')) await updatePersonajesLiveOrder(LIVE_MAP);
        else syncLiveSnapshotFromData(LIVE_MAP);
      } else {
        syncLiveSnapshotFromData(LIVE_MAP);
        scheduleRender();
      }
    }

      async function render() {
        const LIVE_MAP = await getLiveMap();
        const active = getFilteredList(LIVE_MAP, { scope: 'activos' });
        const inactive = getFilteredList(LIVE_MAP, { scope: 'inactivos' });

        const grid = document.getElementById('grid');
        const gridInactivos = document.getElementById('grid-inactivos');
        const inactivosSection = document.getElementById('inactivos-section');
        const empty = document.getElementById('empty');

        const hasActive = active.list.length > 0;
        const hasInactive = inactive.list.length > 0;

        grid.innerHTML = hasActive ? active.list.map(renderCharacterCard).join('') : '';
        empty.classList.toggle('hidden', hasActive || hasInactive);

        if (hasInactive) {
          inactivosSection?.classList.remove('hidden');
          if (gridInactivos) gridInactivos.innerHTML = inactive.list.map(renderCharacterCard).join('');
        } else {
          inactivosSection?.classList.add('hidden');
          if (gridInactivos) gridInactivos.innerHTML = '';
        }

        requestAnimationFrame(() => initScrollReveal('#grid .scroll-reveal, #grid-inactivos .scroll-reveal'));

        [...active.list, ...inactive.list].forEach(p => {
          if (!p.kick) return;
          const live = isCharacterActive(p) && (LIVE_MAP.get(p.kick)?.live ?? false);
          paintKickButton(p.kick, { live });
        });

        await updateLiveUI_fromMap(LIVE_MAP);
        syncLiveSnapshotFromData(LIVE_MAP);
        scheduleRender();
      }

    function scheduleRender(){
      clearTimeout(liveRefreshTimer);
      const needsRefresh = (isViewVisible('personajes') || isViewVisible('inicio') || isViewVisible('multikick')) && !document.hidden;
      if (needsRefresh) {
        liveRefreshTimer = setTimeout(() => refreshLiveState(), 90_000);
      }
    }

    // Eventos Personajes (debounced)
    document.getElementById('rank-chips')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-rank]');
      if (!btn) return;
      const rango = document.getElementById('rango');
      rango.value = btn.dataset.rank;
      document.querySelectorAll('#rank-chips .chip').forEach(c => c.classList.toggle('on', c === btn));
      rango.dispatchEvent(new Event('change'));
    });
    document.getElementById('q').addEventListener('input', debounce(render, 200));
    document.getElementById('rango').addEventListener('change', render);
    document.getElementById('sort').addEventListener('change', render);
    document.getElementById('clear').addEventListener('click', () => {
      document.getElementById('q').value = '';
      document.getElementById('rango').value = '';
      document.getElementById('sort').value = 'rango-desc';
      render();
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        clientKickDisabledUntil = 0;
        lastClientSweep = 0;
        refreshLiveState();
      }
      if (isViewVisible('inicio')) {
        if (document.hidden) stopHomeRotation();
        else startHomeRotation();
      }
    });

    // Click en boton Kick: abrir canal
    document.getElementById('grid').addEventListener('click', (e) => {
      const btn = e.target.closest('.kick-btn');
      if (!btn) return;
      e.preventDefault();
      const slug = (btn.getAttribute('data-slug') || '').trim().toLowerCase();
      if (!slug) return;
      window.open(`https://kick.com/${encodeURIComponent(slug)}`, '_blank', 'noopener,noreferrer');
    });
    document.getElementById('home-live-picker')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-home-index]');
      if (!btn) return;
      setHomeStream(Number(btn.dataset.homeIndex || 0));
      startHomeRotation();
    });
    document.getElementById('home-prev')?.addEventListener('click', () => {
      if (HOME_LIVE_LIST.length > 1) {
        setHomeStream(HOME_LIVE_INDEX - 1);
        startHomeRotation();
      }
    });
    document.getElementById('home-next')?.addEventListener('click', () => {
      if (HOME_LIVE_LIST.length > 1) {
        setHomeStream(HOME_LIVE_INDEX + 1);
        startHomeRotation();
      }
    });

    async function updateLiveUI_fromMap(LIVE_MAP) {
      const liveNow = DATA
        .filter(p => isCharacterActive(p) && p.kick && (LIVE_MAP.get(p.kick)?.live === true))
        .map(p => String(p.kick).toLowerCase());
    
      const changed = JSON.stringify(liveNow) !== JSON.stringify(LIVE_QUEUE);
      LIVE_QUEUE = liveNow;
      if (changed) { LIVE_INDEX = 0; startRotation(); }
    
      const panel = document.getElementById('live-rotator');
      const hideRotator = shouldHideRotator(
        VIEWS.find(id => isViewVisible(id))
      );
      if (LIVE_QUEUE.length === 0 || hideRotator) {
        panel.classList.add('hidden');
        pauseRotator();
      } else if (ROTATOR_OPEN) {
        panel.classList.remove('hidden');
        setIframeTo(LIVE_QUEUE[LIVE_INDEX % LIVE_QUEUE.length]);
        if (!rotateTimer) startRotation();
      }
    }

    function updateRotatorInfo(slug) {
      const p = DATA.find(x => x.kick && String(x.kick).toLowerCase() === String(slug).toLowerCase());
      const avatar = document.getElementById('live-rotator-avatar');
      const name = document.getElementById('live-rotator-name');
      const ooc = document.getElementById('live-rotator-ooc');
      const counter = document.getElementById('live-rotator-counter');

      if (avatar) {
        avatar.src = p?.foto || FALLBACK_AVATAR;
        avatar.alt = p?.nombre || slug;
      }
      if (name) name.textContent = p?.nombre || slug;
      if (ooc) ooc.textContent = p?.ooc || '';
      if (counter) {
        counter.textContent = LIVE_QUEUE.length > 1
          ? `${LIVE_INDEX + 1} / ${LIVE_QUEUE.length}`
          : '';
      }
    }

    function setIframeTo(slug) {
      const iframe = document.getElementById('live-iframe');
      const link = document.getElementById('live-link');
      if (!slug) return;
      iframe.src = `https://player.kick.com/${encodeURIComponent(slug)}?autoplay=true&muted=true`;
      link.href = `https://kick.com/${encodeURIComponent(slug)}`;
      updateRotatorInfo(slug);
    }
    function startRotation() {
      clearInterval(rotateTimer);
      if (LIVE_QUEUE.length === 0) return;
      setIframeTo(LIVE_QUEUE[LIVE_INDEX % LIVE_QUEUE.length]);
      rotateTimer = setInterval(() => {
        LIVE_INDEX = (LIVE_INDEX + 1) % LIVE_QUEUE.length;
        setIframeTo(LIVE_QUEUE[LIVE_INDEX]);
      }, 20_000);
    }
    document.getElementById('live-close').addEventListener('click', () => {
      ROTATOR_OPEN = false;
      document.getElementById('live-rotator').classList.add('hidden');
      pauseRotator();
    });
    document.getElementById('live-prev').addEventListener('click', () => {
      if (LIVE_QUEUE.length === 0) return;
      LIVE_INDEX = (LIVE_INDEX - 1 + LIVE_QUEUE.length) % LIVE_QUEUE.length;
      setIframeTo(LIVE_QUEUE[LIVE_INDEX]);
    });
    document.getElementById('live-next').addEventListener('click', () => {
      if (LIVE_QUEUE.length === 0) return;
      LIVE_INDEX = (LIVE_INDEX + 1) % LIVE_QUEUE.length;
      setIframeTo(LIVE_QUEUE[LIVE_INDEX]);
    });

    // ===== Pintar estado boton Kick =====
    function paintKickButton(slug, state) {
      const esc = (s) =>
        (typeof CSS !== 'undefined' && typeof CSS.escape === 'function')
          ? CSS.escape(s)
          : String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
      const selector = `#kick-${esc(slug)}, a.kick-btn[data-slug="${esc(slug)}"]`;
      document.querySelectorAll(selector).forEach(el => {
        let dot = el.querySelector('.kick-dot');
        let label = el.querySelector('.kick-label');
        if (!dot) { dot = document.createElement('span'); dot.className='kick-dot inline-block w-2 h-2 rounded-full'; el.prepend(dot); }
        if (!label) { label = document.createElement('span'); label.className='kick-label'; el.appendChild(label); }

        if (state.live === true) {
          el.className = 'kick-btn inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border border-yakuza/50 bg-yakuza/10 hover:bg-yakuza/20';
          dot.className = 'kick-dot kick-dot-live inline-block w-2 h-2 rounded-full bg-yakuza';
          label.textContent = 'En vivo';
        } else if (state.live === false) {
          el.className = 'kick-btn inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border border-neutral-700/50 bg-neutral-800/50 hover:bg-neutral-700/50';
          dot.className = 'kick-dot inline-block w-2 h-2 rounded-full bg-neutral-500';
          label.textContent = 'Offline';
        } else {
          el.className = 'kick-btn inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border border-neutral-700/50 bg-neutral-800/50 hover:bg-neutral-700/50';
          dot.className = 'kick-dot inline-block w-2 h-2 rounded-full bg-neutral-500';
          label.textContent = 'Kick';
        }
      });
    }
    // ===== Galería =====
    let galleryLoaded = false;
    let YY_GALLERY = [];    // [{src, alt}]
    let YY_INDEX = 0;
    let galleryLastFetch = 0;
    let galleryListenersBound = false;
    const GALLERY_TTL = 5 * 60_000;

   async function loadGallery(options = {}) {
      const force = options.force === true;
      const now = Date.now();
    
      if (!force && galleryLoaded && YY_GALLERY.length && (now - galleryLastFetch) < GALLERY_TTL) {
        return;
      }
    
      try {
        const r = await fetch('gallery.json', { cache: 'no-cache' });
        if (!r.ok) throw new Error('gallery.json no encontrado');
        YY_GALLERY = await r.json();
    
        const html = YY_GALLERY.map((i, idx) => {
          const id = driveIdFrom(i.src) || i.id;
          const thumb = id ? driveThumb(id) : (i.src || "");
          const alt = i.alt || "";
          const altEsc = escapeHtml(alt);
          return `
            <figure class="gallery-item relative group overflow-hidden cursor-zoom-in aspect-square bg-neutral-900/50" tabindex="0">
              <a href="${id ? driveDL(id) : (safeUrl(i.src) || '#')}" download
                 class="yy-dl-btn text-neutral-200 hover:text-white" title="Descargar" aria-label="Descargar">
                <svg class="yy-dl-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M12 3v12"/>
                  <path d="m7 11 5 5 5-5"/>
                  <path d="M5 21h14"/>
                </svg>
              </a>
              <img src="${thumb}" alt="${altEsc}"
                   class="yy-zoomable w-full h-full object-cover"
                   loading="lazy" decoding="async"
                   data-idx="${idx}" data-id="${id || ""}">
              ${alt ? `<figcaption class="gallery-caption">${altEsc}</figcaption>` : ''}
            </figure>
          `;
        }).join('');
    
        const grid = document.getElementById('galeria-grid');
        grid.innerHTML = html || '<p class="text-neutral-400">Sin imágenes.</p>';
        galleryLoaded = true;
        galleryLastFetch = now;
    
        // ðŸ”½ Fallback si alguna miniatura no carga
        document.querySelectorAll('#galeria-grid img').forEach(img => {
          img.addEventListener('error', () => {
            try {
              const id = new URL(img.src).pathname.split('/d/')[1]?.split('=')[0] 
                         || new URL(img.src).searchParams.get('id');
              if (id) img.src = `https://lh3.googleusercontent.com/d/${id}=w1600`;
            } catch {}
          });
        });
    
        // ðŸ”½ Listener para abrir el lightbox al click
        if (!galleryListenersBound) {
          grid.addEventListener('click', (e) => {
            const img = e.target.closest('img[data-idx]');
            if (!img) return;
            e.preventDefault();
            const i = Number(img.dataset.idx || 0);
            yyOpen(i);
          });
          galleryListenersBound = true;
        }
    
      } catch (e) {
        document.getElementById('galeria-grid').innerHTML =
          '<div class="text-red-400">No se pudo cargar <code>gallery.json</code>.</div>';
      }
    }
   
    function yyRender() {
      const item = YY_GALLERY[YY_INDEX];
      if (!item) return;
    
      // intentamos ID desde el DOM (data-id) o URL original
      const imgDom = document.querySelector(`#galeria-grid img[data-idx="${YY_INDEX}"]`);
      const id = imgDom?.dataset?.id || driveIdFrom(item.src);
    
      const img = document.getElementById('yy-img');
      const cap = document.getElementById('yy-caption');
      const dl  = document.getElementById('yy-dl');
    
      const bigSrc = id ? driveFull(id) : (item.src || "");
      const dlHref = id ? driveDL(id)   : (item.src || "");
    
      img.src = bigSrc;
      img.alt = item.alt || '';
      cap.textContent = item.alt || '';
      dl.href = dlHref;                 // descarga forzada
      dl.download = (item.alt || `imagen-${YY_INDEX+1}`).replace(/[^\w.-]+/g,'_');
    }
    
    let yyFocusReturn = null;

    function yyFocusables(container) {
      return [...container.querySelectorAll(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )].filter(el => !el.closest('[hidden]') && el.getAttribute('aria-hidden') !== 'true');
    }

    function yyTrapFocus(e) {
      if (e.key !== 'Tab') return;
      const lb = document.getElementById('yy-lightbox');
      if (!lb || lb.classList.contains('hidden')) return;
      const items = yyFocusables(lb);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    function yyOpen(i=0) {
      YY_INDEX = Math.max(0, Math.min(i, YY_GALLERY.length-1));
      yyRender();
      const lb = document.getElementById('yy-lightbox');
      yyFocusReturn = document.activeElement;
      lb.classList.remove('hidden');
      lb.setAttribute('aria-hidden', 'false');
      document.body.classList.add('yy-lb-open');
      document.addEventListener('keydown', yyKeys);
      document.addEventListener('keydown', yyTrapFocus);
      requestAnimationFrame(() => document.getElementById('yy-close')?.focus());
    }

    function yyClose() {
      const lb = document.getElementById('yy-lightbox');
      lb.classList.add('hidden');
      lb.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('yy-lb-open');
      document.removeEventListener('keydown', yyKeys);
      document.removeEventListener('keydown', yyTrapFocus);
      if (yyFocusReturn?.focus) yyFocusReturn.focus();
      yyFocusReturn = null;
    }
    function yyPrev() { if (!YY_GALLERY.length) return; YY_INDEX = (YY_INDEX - 1 + YY_GALLERY.length) % YY_GALLERY.length; yyRender(); }
    function yyNext() { if (!YY_GALLERY.length) return; YY_INDEX = (YY_INDEX + 1) % YY_GALLERY.length; yyRender(); }
    function yyKeys(e) {
      if (e.key === 'Escape') yyClose();
      if (e.key === 'ArrowLeft') yyPrev();
      if (e.key === 'ArrowRight') yyNext();
    }
    // Detecta tipo desde l.type o desde hostname
    function linkType(l){
      const t = (l.type || '').toLowerCase();
      if (t) return t;
      try {
        const h = new URL(l.href).hostname.toLowerCase();
        if (h.includes('instagram')) return 'instagram';
        if (h.includes('twitter') || h.includes('x.com')) return 'twitter';
        if (h.includes('tiktok')) return 'tiktok';
        if (h.includes('youtube')) return 'youtube';
        if (h.includes('twitch')) return 'twitch';
        if (h.includes('kick.com')) return 'kick';
        return 'link';
      } catch { return 'link'; }
    }
    
    // SVGs inline (simples y livianos)
    function iconSvg(type){
      switch(type){
        case 'instagram': return `<svg class="yy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="3" width="18" height="18" rx="5" stroke-width="1.5"/><circle cx="12" cy="12" r="3.5" stroke-width="1.5"/><circle cx="17.2" cy="6.8" r="1.2" fill="currentColor"/></svg>`;
        case 'twitter':   return `<svg class="yy-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2H21L14.326 10.63 22 22h-6.31l-4.94-7.18L5.24 22H3l7.23-9.16L2 2h6.42l4.47 6.48L18.244 2Z"/></svg>`; // 'X'
        case 'tiktok':    return `<svg class="yy-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M19 7.6a7.5 7.5 0 0 1-4.3-1.6v6.9a5.6 5.6 0 1 1-4.8-5.5v2.6a2.9 2.9 0 1 0 2.1 2.8V2h2.7A7.5 7.5 0 0 0 19 5.2v2.4z"/></svg>`;
        case 'youtube':   return `<svg class="yy-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M23 12s0-3.4-.44-5.06a3 3 0 0 0-2.1-2.12C18.68 4.25 12 4.25 12 4.25s-6.68 0-8.46.57A3 3 0 0 0 1.44 6.94C1 8.6 1 12 1 12s0 3.4.44 5.06a3 3 0 0 0 2.1 2.12c1.78.57 8.46.57 8.46.57s6.68 0 8.46-.57a3 3 0 0 0 2.1-2.12C23 15.4 23 12 23 12ZM10 15.5v-7l6 3.5-6 3.5Z"/></svg>`;
        case 'twitch':    return `<svg class="yy-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M4 3h16v10.5l-4 4h-3.5L9 20v-2.5H6V6h12v6.5l-3 3V17h-3l-2 2v-2H8V5H4v-2z"/><path d="M13 7h2v4h-2V7zm-4 0h2v4H9V7z"/></svg>`;
        case 'kick':      return `<svg class="yy-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M3 4h18v4h-6v3h6v9h-5v-5h-5v5H6V8H3V4zm8 4v3H9V8h2z"/></svg>`;
        default:          return `<svg class="yy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M10.6 13.4a4 4 0 0 0 5.7 0l2.3-2.3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M13.4 10.6a4 4 0 0 0-5.7 0l-2.3 2.3a4 4 0 0 0 5.7 5.7l1-1" stroke-width="1.5"/></svg>`;
      }
    }


    // botones del lightbox
    document.getElementById('yy-close')?.addEventListener('click', yyClose);
    document.getElementById('yy-prev')?.addEventListener('click', yyPrev);
    document.getElementById('yy-next')?.addEventListener('click', yyNext);
    // click en fondo oscuro cierra
    document.getElementById('yy-lightbox')?.addEventListener('click', (e) => {
      if (e.target.closest('.yy-lb-media, .yy-lb-nav, .yy-lb-close, #yy-dl')) return;
      yyClose();
    });



  // ===== Videos (estático desde videos.json) =====
    let videosListenersBound = false;
    let videosEditorBound = false;
    let VIDEOS_CHANNELS = [];
    let videosChannelsLoaded = false;
    let videoEditorFilter = '';

    async function getChannelsList() {
      if (videosChannelsLoaded) return VIDEOS_CHANNELS;
      try {
        const r = await fetch('channels.json', { cache: 'no-cache' });
        if (!r.ok) return VIDEOS_CHANNELS;
        const cfg = await r.json();
        VIDEOS_CHANNELS = Array.isArray(cfg?.channels) ? cfg.channels : [];
        videosChannelsLoaded = true;
      } catch { /* keep cache empty */ }
      return VIDEOS_CHANNELS;
    }

    function renderVideoEditorSelect(channels) {
      const sel = document.getElementById('videos-editor');
      if (!sel) return;
      const current = sel.value || videoEditorFilter;
      sel.innerHTML = [
        '<option value="">Todos los editores</option>',
        ...channels.map(ch => {
          const name = escapeHtml(ch.name || '');
          return `<option value="${name}">${name}</option>`;
        }),
      ].join('');
      const valid = current && channels.some(ch => ch.name === current);
      sel.value = valid ? current : '';
      videoEditorFilter = sel.value;
    }

    function renderVideoCard(v, i) {
      const featured = i === 0 ? 'md:col-span-2' : '';
      const title = escapeHtml(v.title || 'Video');
      const date = new Date(v.published).toLocaleString('es-UY', { dateStyle: 'medium', timeStyle: 'short' });
      const channel = escapeHtml(v._channelName || '');
      const id = escapeHtml(v.id || '');
      return `
        <article class="video-item ${featured}">
          <button type="button" class="video-facade w-full text-left rounded-lg overflow-hidden bg-black ring-1 ring-white/10 shadow-xl shadow-black/30"
                  data-yt-id="${id}" data-yt-title="${title}" aria-label="Reproducir: ${title}">
            <span class="video-facade-media relative block aspect-video">
              <img src="https://i.ytimg.com/vi/${id}/hqdefault.jpg" alt="" class="absolute inset-0 w-full h-full object-cover" loading="lazy" decoding="async" />
              <span class="video-facade-play" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              </span>
            </span>
          </button>
          <div class="mt-3 px-0.5">
            <h3 class="font-medium text-neutral-100 leading-snug line-clamp-2">${title}</h3>
            <p class="text-sm text-neutral-500 mt-1">${date}${channel ? ` · ${channel}` : ''}</p>
          </div>
        </article>
      `;
    }

    function renderVideosGrid(items) {
      const filtered = videoEditorFilter
        ? items.filter(v => v._channelName === videoEditorFilter)
        : items;

      const grid = document.getElementById('videos-grid');
      const empty = document.getElementById('videos-empty');
      if (!grid) return;

      if (!filtered.length) {
        grid.innerHTML = '';
        empty?.classList.remove('hidden');
        return;
      }

      empty?.classList.add('hidden');
      grid.innerHTML = filtered.map((v, i) => renderVideoCard(v, i)).join('');
    }

    function bindVideosEditorFilter() {
      if (videosEditorBound) return;
      document.getElementById('videos-editor')?.addEventListener('change', async (e) => {
        videoEditorFilter = e.target.value;
        renderVideosGrid(await getVideosList());
      });
      videosEditorBound = true;
    }

    async function getVideosList() {
      const now = Date.now();
      if (now - VIDEOS_CACHE.t < VIDEOS_LIST_TTL && VIDEOS_CACHE.items.length) {
        return VIDEOS_CACHE.items;
      }
      try {
        const r = await fetch('videos.json', { cache: 'no-cache' });
        if (!r.ok) return VIDEOS_CACHE.items;
        const items = await r.json();
        VIDEOS_CACHE = {
          t: now,
          items: (Array.isArray(items) ? items : [])
            .slice()
            .sort((a, b) => new Date(b.published) - new Date(a.published)),
        };
        return VIDEOS_CACHE.items;
      } catch {
        return VIDEOS_CACHE.items;
      }
    }

    function mountVideoPlayer(facade) {
      const id = facade.dataset.ytId;
      if (!id || facade.dataset.loaded === '1') return;
      const title = facade.dataset.ytTitle || 'Video';
      const wrap = document.createElement('div');
      wrap.className = 'rounded-lg overflow-hidden bg-black ring-1 ring-white/10 shadow-xl shadow-black/30';
      const iframe = document.createElement('iframe');
      iframe.className = 'w-full aspect-video';
      iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1`;
      iframe.title = title;
      iframe.loading = 'lazy';
      iframe.setAttribute('frameborder', '0');
      iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      wrap.appendChild(iframe);
      facade.replaceWith(wrap);
    }

    async function loadVideos() {
      try {
        const [items, channels] = await Promise.all([getVideosList(), getChannelsList()]);
        renderVideoEditorSelect(channels);
        bindVideosEditorFilter();
        renderVideosGrid(items);

        if (!videosListenersBound) {
          document.getElementById('videos-grid')?.addEventListener('click', (e) => {
            const facade = e.target.closest('.video-facade');
            if (facade) mountVideoPlayer(facade);
          });
          videosListenersBound = true;
        }

        clearInterval(videosTimer);
        videosTimer = setInterval(() => {
          const visible = !document.getElementById('view-videos')?.classList.contains('hidden');
          if (visible) loadVideos();
        }, VIDEOS_REFRESH_MS);

      } catch {
        const grid = document.getElementById('videos-grid');
        if (grid) {
          grid.innerHTML =
            '<div class="text-red-400">No se pudo cargar la pestaña Videos. Revisa <code>videos.json</code> y <code>channels.json</code>.</div>';
        }
        document.getElementById('videos-empty')?.classList.add('hidden');
      }
    }



    // ===== Scroll reveal (Lore + Personajes) =====
    let scrollRevealObserver = null;

    function prefersReducedMotion() {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    function initScrollReveal(selector = '.scroll-reveal, .lore-reveal') {
      const els = document.querySelectorAll(selector);
      if (!els.length) return;

      scrollRevealObserver?.disconnect();
      scrollRevealObserver = null;

      if (prefersReducedMotion() || !('IntersectionObserver' in window)) {
        els.forEach(el => el.classList.add('scroll-revealed', 'lore-revealed'));
        return;
      }

      scrollRevealObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('scroll-revealed', 'lore-revealed');
          scrollRevealObserver.unobserve(entry.target);
        });
      }, { threshold: 0.1, rootMargin: '0px 0px -32px 0px' });

      els.forEach(el => {
        el.classList.remove('scroll-revealed', 'lore-revealed');
        scrollRevealObserver.observe(el);
      });
    }

    // ===== Lore =====
    let loreLoadPromise = null;

    function refreshLoreReveal() {
      const body = document.getElementById('lore-body');
      if (!body?.querySelector('.lore-reveal, .lore-chapter')) return;

      if (prefersReducedMotion()) {
        body.querySelectorAll('.lore-reveal').forEach(el => {
          el.classList.add('scroll-revealed', 'lore-revealed');
        });
        return;
      }
      initScrollReveal('#lore-body .lore-reveal');
    }

    function loadLore() {
      if (loreLoadPromise) return loreLoadPromise;

      loreLoadPromise = (async () => {
        try {
          const r = await fetch('lore.html', { cache: 'no-store' });
          if (!r.ok) throw new Error('lore.html no encontrado');
          const html = await r.text();
          document.getElementById('lore-body').innerHTML = html;
        } catch {
          document.getElementById('lore-body').innerHTML =
            '<p class="text-red-400">Subí <code>lore.html</code> con tu historia.</p>';
        }
      })();

      loreLoadPromise.catch(() => { loreLoadPromise = null; });
      return loreLoadPromise;
    }

    const siteHeader = document.querySelector('.site-header');
    const syncHeader = () => siteHeader?.classList.toggle('is-scrolled', window.scrollY > 12);
    syncHeader();
    window.addEventListener('scroll', syncHeader, { passive: true });

    // ===== Go! =====
    showView(viewFromHash(), { updateHash: false });
    loadData();
    loadLore();
