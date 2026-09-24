#!/usr/bin/env node
/**
 * build-live.mjs (robusto)
 * Lee slugs Kick desde data.json y genera live.json en la raiz.
 * Si algo falla, escribe [] para no romper el workflow.
 */

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT   = process.cwd();
const INPUT  = path.join(ROOT, "data.json");
const OUTPUT = path.join(ROOT, "live.json");

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchJson(url, { retries = 2, backoffMs = 600 } = {}) {
  for (let a = 0; a <= retries; a++) {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 8000); // 8s timeout

      const res = await fetch(url, {
        headers: {
          accept: "application/json",
          "accept-language": "es-UY,es;q=0.9,en;q=0.8",
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          referer: "https://kick.com/"
        },
        signal: ac.signal,
        cache: "no-store",
        redirect: "follow"
      });

      clearTimeout(t);

      if (res.ok) {
        // Evitar respuestas vacias con 200
        const text = await res.text();
        if (!text?.trim()) throw new Error("respuesta vacia");
        try {
          return JSON.parse(text);
        } catch (e) {
          throw new Error("json invalido");
        }
      }

      if (res.status === 429 || res.status >= 500) {
        const wait = backoffMs * Math.pow(2, a);
        console.log(`[kick] ${res.status} -> retry en ${wait}ms`);
        await sleep(wait);
        continue;
      }

      throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      if (a === retries) throw e;
      const wait = backoffMs * Math.pow(2, a);
      console.log(`[net] ${e?.message || e} -> retry en ${wait}ms`);
      await sleep(wait);
    }
  }
  throw new Error("Unexpected");
}

async function fetchKick(slug) {
  const url = `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`;
  try {
    const data = await fetchJson(url);
    const live = Boolean(data?.livestream);
    const viewers = live ? (data?.livestream?.viewers ?? 0) : 0;
    const thumb = live ? (data?.livestream?.thumbnail?.url ?? null) : null;

    // Normalizar posibles cambios de API: si no hay livestream pero hay flags
    // conocidos que indiquen live, se puede adaptar aca en el futuro.

    return {
      slug,
      platform: "kick",
      live,
      viewers,
      thumb,
      updatedAt: new Date().toISOString()
    };
  } catch (e) {
    console.log(`[kick] ${slug}: ${e?.message || e}`);
    return {
      slug,
      platform: "kick",
      live: false,
      viewers: 0,
      thumb: null,
      updatedAt: new Date().toISOString(),
      error: String(e?.message || e)
    };
  }
}

async function loadPreviousLive() {
  try {
    const raw = await fs.readFile(OUTPUT, "utf8");
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function mergeWithPrevious(results, previous) {
  const prevMap = new Map(previous.map(x => [String(x.slug).toLowerCase(), x]));
  return results.map(entry => {
    if (!entry.error) return entry;
    const prev = prevMap.get(entry.slug);
    if (!prev) return entry;
    return {
      ...prev,
      slug: entry.slug,
      platform: "kick",
      updatedAt: entry.updatedAt,
      stale: true,
      error: entry.error,
    };
  });
}

async function main() {
  let data;
  const previous = await loadPreviousLive();
  try {
    const raw = await fs.readFile(INPUT, "utf8");
    data = JSON.parse(raw);
  } catch (e) {
    console.log(`[data.json] no encontrado o invalido (${e?.message || e}).`);
    if (previous.length) {
      console.log("[skip] conservo live.json previo.");
      return;
    }
    await fs.writeFile(OUTPUT, "[]\n", "utf8");
    return;
  }

  if (!Array.isArray(data)) data = [];

  // Extraer slugs kick unicos
  const slugs = [...new Set(
    data
      .filter(x => Number(x?.activo ?? 1) !== 0)
      .map(x => {
        const raw = x?.kick ? String(x.kick).trim() : "";
        const fromUrl = raw.match(/kick\.com\/([^/?#]+)/i);
        return (fromUrl ? fromUrl[1] : raw).replace(/^@/, "").trim().toLowerCase().split("/")[0];
      })
      .filter(s => s && !s.includes(".") && !s.includes(":"))
  )];

  console.log(`[info] ${slugs.length} slugs Kick encontrados.`);

  const CONCURRENCY = 5;
  const results = [];
  let i = 0;

  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= slugs.length) break;
      const slug = slugs[idx];
      const r = await fetchKick(slug);
      results.push(r); // array denso
    }
  }

  // Lanzar N workers en paralelo (min para no lanzar 0)
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(CONCURRENCY, slugs.length)) }, worker)
  );

  const errored = results.filter(r => r.error);
  if (errored.length) {
    console.log(`[retry] ${errored.length} slugs con error, segunda pasada...`);
    await sleep(2500);
    for (const prev of errored) {
      const retry = await fetchKick(prev.slug);
      const idx = results.findIndex(r => r.slug === prev.slug);
      if (idx >= 0) results[idx] = retry;
    }
  }

  let merged = mergeWithPrevious(results, previous);
  const okCount = merged.filter(x => !x.error).length;

  if (!okCount && previous.length) {
    console.log(`[skip] ${merged.length} slugs fallaron (Cloudflare?). Conservo live.json previo.`);
    return;
  }

  // Ordenar: live primero, luego por viewers desc, luego alfabetico por slug
  merged.sort((a, b) =>
    (Number(b.live) - Number(a.live)) ||
    (b.viewers - a.viewers) ||
    a.slug.localeCompare(b.slug)
  );

  await fs.writeFile(OUTPUT, JSON.stringify(merged, null, 2) + "\n", "utf8");

  const liveCount = merged.filter(x => x.live).length;
  console.log(`[done] live.json generado: ${merged.length} canales, ${liveCount} en vivo, ${okCount} consultas OK.`);
}

main().catch(async (err) => {
  console.error(`[fatal] ${err?.stack || err}`);
  // No vaciar live.json ante un fallo global.
});
