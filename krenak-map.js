(function () {
  const TIPOS = {
    territorio: { label: "Territorio", color: "#9e2744" },
    almacen: { label: "Almacén", color: "#d4a017" },
    casa: { label: "Casa", color: "#f4f1ea" },
    negocio: { label: "Negocio", color: "#7eb8c9" },
    otro: { label: "Otro", color: "#8d8d8d" }
  };

  function crs() {
    const image = [8192, 12288];
    const topLeft = [-4140, 8400];
    const bottomRight = [4860, -5100];
    const maxZoom = 6;
    const scaleFactor = Math.pow(2, maxZoom);
    const u = image[0] / ((bottomRight[0] - topLeft[0]) * scaleFactor);
    const d = image[1] / ((bottomRight[1] - topLeft[1]) * scaleFactor);
    const next = Object.create(L.CRS.Simple);
    next.transformation = new L.Transformation(u, -u * topLeft[0], d, -d * topLeft[1]);
    next.infinite = true;
    next.scale = (zoom) => Math.pow(2, zoom);
    next.zoom = (scale) => Math.log(scale) / Math.LN2;
    return next;
  }

  function esc(value) {
    return String(value || "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[ch]));
  }

  function roundCoord(n) {
    return Math.round(Number(n) * 10) / 10;
  }

  function puntosOf(layer) {
    if (typeof layer.getLatLngs === "function") {
      const rings = layer.getLatLngs();
      const ring = Array.isArray(rings[0]) ? rings[0] : rings;
      return ring.map((ll) => [roundCoord(ll.lng), roundCoord(ll.lat)]);
    }
    const ll = layer.getLatLng();
    return [[roundCoord(ll.lng), roundCoord(ll.lat)]];
  }

  function mount(id, opts) {
    const el = document.getElementById(id);
    if (!el || !window.L) return null;
    if (el._krenakMap) return el._krenakMap;

    const map = L.map(el, {
      crs: crs(),
      minZoom: 0,
      maxZoom: 6,
      zoomControl: true,
      attributionControl: true
    });
    L.tileLayer("https://assets.loaf-scripts.com/map-tiles/gtav/main/game/{z}/{x}/{y}.jpg", {
      minZoom: 0,
      maxZoom: 6,
      maxNativeZoom: 6,
      tileSize: 256,
      noWrap: true,
      attribution: "Los Santos"
    }).addTo(map);
    const group = L.featureGroup().addTo(map);
    map.setView([-400, 200], 3);

    let createdCb = null;
    let drawHandler = null;

    if (opts && opts.draw && window.L.Draw) {
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png"
      });
      map.on(L.Draw.Event.CREATED, (e) => {
        const forma = e.layerType === "marker" ? "marker" : "polygon";
        const puntos = puntosOf(e.layer);
        if (drawHandler) drawHandler.disable();
        drawHandler = null;
        if (createdCb) createdCb({ forma, puntos });
      });
    }

    const api = {
      setPlaces(list) {
        group.clearLayers();
        (list || []).forEach((item) => {
          const pts = Array.isArray(item.puntos)
            ? item.puntos.filter((p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])))
            : [];
          if (!pts.length) return;
          const tipo = TIPOS[item.tipo] || TIPOS.otro;
          const layer = (item.forma === "marker" || pts.length === 1)
            ? L.circleMarker([Number(pts[0][1]), Number(pts[0][0])], {
              radius: 8,
              color: "#0a0a0a",
              weight: 2,
              fillColor: tipo.color,
              fillOpacity: 0.95
            })
            : L.polygon(pts.map(([x, y]) => [Number(y), Number(x)]), {
              color: tipo.color,
              fillColor: tipo.color,
              fillOpacity: 0.28,
              weight: 2
            });
          layer._kid = item.id || "";
          const note = item.nota ? `<br>${esc(item.nota)}` : "";
          layer.bindPopup(`<strong>${esc(item.nombre || "Sin nombre")}</strong><br>${esc(tipo.label)}${note}`);
          group.addLayer(layer);
        });
      },
      focus(id) {
        let found = null;
        group.eachLayer((layer) => { if (layer._kid === id) found = layer; });
        if (!found) return;
        if (typeof found.getBounds === "function") map.fitBounds(found.getBounds().pad(0.35));
        else map.setView(found.getLatLng(), Math.max(map.getZoom(), 4));
        found.openPopup();
      },
      invalidate() {
        map.invalidateSize();
      },
      draw(kind, color) {
        if (!window.L.Draw) return;
        if (drawHandler) drawHandler.disable();
        const shape = { color, fillColor: color, fillOpacity: 0.28, weight: 2 };
        if (kind === "marker") drawHandler = new L.Draw.Marker(map);
        else if (kind === "rect") drawHandler = new L.Draw.Rectangle(map, { shapeOptions: shape });
        else drawHandler = new L.Draw.Polygon(map, { allowIntersection: false, shapeOptions: shape });
        drawHandler.enable();
      },
      onCreated(fn) { createdCb = fn; },
      map
    };
    el._krenakMap = api;
    setTimeout(() => map.invalidateSize(), 60);
    return api;
  }

  window.KrenakMap = { tipos: TIPOS, mount };
})();
