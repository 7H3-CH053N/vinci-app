/**
 * Home Assistant — REST-API-Bridge mit LAN/Tailscale-Failover.
 *
 * Probiert bei jedem Call zuerst die LAN-URL (kurzer Timeout), bei Fehler
 * fällt es auf die Remote-URL (Tailscale) zurück. Die zuletzt funktionierende
 * Base wird für die Session gemerkt, bis sie wieder fehlschlägt.
 */
import { execFile } from 'child_process'

let activeBase = null
let activeBaseExpires = 0   // ms-Timestamp ab wann wir wieder beide neu probieren
let inventoryCache = ''
let inventoryExpires = 0

const FAST_TIMEOUT = 1200    // LAN-Versuch
const SLOW_TIMEOUT = 4000    // Remote / fallback
const ACTIVE_BASE_TTL = 60_000  // 1 min: danach erneut LAN priorisieren
const INVENTORY_TTL = 60_000

function withTimeout(promise, ms, label = 'request') {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timeout (${ms} ms)`)), ms)
    promise.then(
      v => { clearTimeout(t); resolve(v) },
      e => { clearTimeout(t); reject(e) }
    )
  })
}

function normalize(url) {
  if (!url) return ''
  return url.replace(/\/+$/, '')
}

async function probe(base, token, timeout) {
  if (!base) return false
  try {
    const res = await withTimeout(fetch(`${base}/api/`, {
      headers: { Authorization: `Bearer ${token}` }
    }), timeout, 'probe')
    return res.ok
  } catch {
    return false
  }
}

async function resolveBase(cfg) {
  const lan    = normalize(cfg.lanUrl)
  const remote = normalize(cfg.remoteUrl)

  // Wenn aktive Base noch frisch ist, probieren wir sie zuerst
  if (activeBase && Date.now() < activeBaseExpires) {
    if (await probe(activeBase, cfg.token, FAST_TIMEOUT)) return activeBase
    activeBase = null
  }

  // LAN bevorzugen
  if (lan && await probe(lan, cfg.token, FAST_TIMEOUT)) {
    activeBase = lan
    activeBaseExpires = Date.now() + ACTIVE_BASE_TTL
    return lan
  }

  // Fallback: Remote (Tailscale)
  if (remote && await probe(remote, cfg.token, SLOW_TIMEOUT)) {
    activeBase = remote
    activeBaseExpires = Date.now() + ACTIVE_BASE_TTL
    return remote
  }

  return null
}

async function call(cfg, path, init = {}) {
  if (!cfg?.token) throw new Error('Kein Home-Assistant-Token konfiguriert')
  const base = await resolveBase(cfg)
  if (!base) throw new Error('Home Assistant nicht erreichbar (LAN und Tailscale fehlgeschlagen)')

  const headers = {
    'Authorization': `Bearer ${cfg.token}`,
    'Content-Type': 'application/json',
    ...(init.headers || {})
  }
  const res = await withTimeout(
    fetch(`${base}${path}`, { ...init, headers }),
    SLOW_TIMEOUT,
    'HA call'
  )
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`HA ${res.status}: ${text.slice(0, 200)}`)
  }
  return res
}

/**
 * Verbindungstest. Gibt zurück: { ok, base, version, locationName }.
 */
export async function ping(cfg) {
  try {
    const res = await call(cfg, '/api/config')
    const json = await res.json()
    return {
      ok: true,
      base: activeBase,
      via: activeBase === normalize(cfg.lanUrl) ? 'lan' : 'remote',
      version: json.version,
      locationName: json.location_name
    }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

/**
 * Einzelner Entity-State. Liefert das volle State-Objekt von HA.
 */
export async function getState(cfg, entityId) {
  if (!entityId) throw new Error('entity_id fehlt')
  const res = await call(cfg, `/api/states/${encodeURIComponent(entityId)}`)
  return await res.json()
}

/**
 * Liste aller Entities, optional nach Domain gefiltert (z. B. 'light', 'sensor').
 * Reduziert das Volumen, indem nur kompakte Felder zurückgegeben werden.
 */
export async function listEntities(cfg, domain = null) {
  const res = await call(cfg, '/api/states')
  const all = await res.json()
  const filtered = domain
    ? all.filter(s => s.entity_id.startsWith(`${domain}.`))
    : all
  return filtered.map(s => ({
    entity_id: s.entity_id,
    state: s.state,
    name: s.attributes?.friendly_name || s.entity_id,
    unit: s.attributes?.unit_of_measurement,
    device_class: s.attributes?.device_class
  }))
}

/**
 * Service-Call: light.turn_on, automation.trigger, script.<name>, etc.
 * Beispiel: callService(cfg, 'light', 'turn_on', { entity_id: 'light.kitchen', brightness: 200 })
 */
export async function callService(cfg, domain, service, data = {}) {
  if (!domain || !service) throw new Error('domain und service erforderlich')
  const res = await call(cfg, `/api/services/${domain}/${service}`, {
    method: 'POST',
    body: JSON.stringify(data)
  })
  return await res.json().catch(() => ({}))
}

/**
 * Konvenienz: Suche nach Entities per Substring (für sprachgesteuerte Aliasse).
 */
export async function searchEntities(cfg, query) {
  const all = await listEntities(cfg)
  const q = query.toLowerCase()
  return all.filter(e =>
    e.entity_id.toLowerCase().includes(q) ||
    (e.name && e.name.toLowerCase().includes(q))
  ).slice(0, 30)
}

/**
 * Reset aller Caches — z. B. wenn Settings geändert wurden.
 */
export function resetActiveBase() {
  activeBase = null
  activeBaseExpires = 0
  inventoryCache = ''
  inventoryExpires = 0
}

// ── Inventory-Context für den System-Prompt ─────────────────────────────────
/**
 * Liefert eine kompakte Übersicht aller relevanten Entities, die in den
 * System-Prompt injiziert wird. Damit kennt Gemini die echten entity_ids
 * und muss nicht raten.
 */
export async function getInventoryContext(cfg) {
  if (!cfg?.token) return ''
  if (Date.now() < inventoryExpires && inventoryCache) return inventoryCache

  try {
    const all = await listEntities(cfg)

    // Steuerbare Domains immer rein
    const controllable = ['light','switch','scene','script','automation','climate','media_player','cover','fan','vacuum','lock','input_boolean','input_number','input_select']
    // Aus Sensoren nur die relevanten (per device_class oder Name-Match)
    const sensorKeywords = ['temperature','humidity','door','window','motion','occupancy','presence','battery','power','energy','illuminance']

    const grouped = {}
    for (const e of all) {
      const domain = e.entity_id.split('.')[0]
      const id = e.entity_id.toLowerCase()
      const dc = (e.device_class || '').toLowerCase()

      let take = false
      if (controllable.includes(domain)) take = true
      else if (domain === 'sensor' || domain === 'binary_sensor') {
        take = sensorKeywords.some(k => dc.includes(k) || id.includes(k))
      }
      else if (domain === 'person' || domain === 'zone') take = true

      if (take) {
        if (!grouped[domain]) grouped[domain] = []
        grouped[domain].push(e)
      }
    }

    if (Object.keys(grouped).length === 0) return ''

    const lines = ['', 'HOME ASSISTANT — Verfügbare Entities (KOPIERE die entity_id 1:1, NIEMALS raten!):']
    for (const [domain, entities] of Object.entries(grouped)) {
      const sliced = entities.slice(0, 30)
      const more = entities.length - sliced.length
      const list = sliced.map(e => `  ${e.entity_id}${e.name && e.name !== e.entity_id ? ` — "${e.name}"` : ''}`).join('\n')
      lines.push(`[${domain}]\n${list}${more > 0 ? `\n  …+${more} weitere (per homeassistant_list domain="${domain}" auflisten)` : ''}`)
    }

    inventoryCache = '\n\n' + lines.join('\n\n')
    inventoryExpires = Date.now() + INVENTORY_TTL
    return inventoryCache
  } catch (e) {
    console.warn('[HA] inventory context failed:', e.message)
    return ''
  }
}

// ── Module für die Registry (Gemini-Tools) ──────────────────────────────────

function getCfg(ctx) {
  const settings = ctx?.settings || ctx?.getSettings?.() || {}
  return settings.homeassistant || {}
}

export const homeassistantModule = {
  name: 'homeassistant',
  description: 'Home Assistant: Sensoren lesen (Temperatur, Tür/Fenster, Strom, Anwesenheit) und Geräte steuern (Licht, Heizung, Szenen, Skripte, Automationen).',

  actions: {
    state: async ({ entity_id }, ctx) => {
      const cfg = getCfg(ctx)
      try {
        const s = await getState(cfg, entity_id)
        return {
          entity_id: s.entity_id,
          state: s.state,
          name: s.attributes?.friendly_name,
          unit: s.attributes?.unit_of_measurement,
          attributes: s.attributes
        }
      } catch (e) {
        // 404 → fuzzy-suche nach ähnlichen entity_ids als Hinweis
        if (/404/.test(e.message) || /not found/i.test(e.message)) {
          const parts = String(entity_id).toLowerCase().split(/[._]/).filter(Boolean)
          const all = await listEntities(cfg)
          const candidates = all
            .map(en => ({
              en,
              hits: parts.reduce((n, p) => n + (en.entity_id.toLowerCase().includes(p) || (en.name||'').toLowerCase().includes(p) ? 1 : 0), 0)
            }))
            .filter(x => x.hits > 0)
            .sort((a, b) => b.hits - a.hits)
            .slice(0, 8)
            .map(x => x.en)
          throw new Error(`Entity "${entity_id}" nicht gefunden. Ähnliche IDs: ${candidates.map(c => c.entity_id).join(', ') || 'keine'}. Nutze homeassistant_list zum Suchen.`)
        }
        throw e
      }
    },

    list: async ({ domain, query } = {}, ctx) => {
      const cfg = getCfg(ctx)
      let entities = await listEntities(cfg, domain || null)
      if (query) {
        const q = String(query).toLowerCase()
        entities = entities.filter(e =>
          e.entity_id.toLowerCase().includes(q) ||
          (e.name && e.name.toLowerCase().includes(q))
        )
      }
      // Begrenzen, damit der LLM-Context nicht explodiert
      return { count: entities.length, entities: entities.slice(0, 60) }
    },

    open: async ({} = {}, ctx) => {
      const cfg = getCfg(ctx)
      // Tailscale bevorzugen, weil die URL überall funktioniert (zu Hause + unterwegs).
      // Fallback auf LAN, falls Tailscale nicht konfiguriert ist.
      const url = normalize(cfg.remoteUrl) || normalize(cfg.lanUrl)
      if (!url) throw new Error('Keine Home-Assistant-URL konfiguriert (Tailscale oder LAN).')
      await new Promise((resolve, reject) => {
        execFile('open', ['-a', 'Google Chrome', url], (err) => {
          if (err) reject(err); else resolve()
        })
      })
      return { ok: true, opened: url }
    },

    call: async ({ domain, service, entity_id, data } = {}, ctx) => {
      const cfg = getCfg(ctx)

      // Pre-Flight: wenn entity_id mitgeschickt wurde, prüfen ob sie existiert.
      // Verhindert sowohl "geht still durch ohne Wirkung" als auch
      // post-call State-Race (HA-State-Cache hängt 200-500ms hinterher).
      if (entity_id) {
        try {
          await getState(cfg, entity_id)
        } catch (e) {
          if (/404|not found/i.test(e.message)) {
            const parts = String(entity_id).toLowerCase().split(/[._]/).filter(Boolean)
            const all = await listEntities(cfg, domain)
            const candidates = all
              .map(en => ({
                en,
                hits: parts.reduce((n, p) => n + (en.entity_id.toLowerCase().includes(p) || (en.name||'').toLowerCase().includes(p) ? 1 : 0), 0)
              }))
              .filter(x => x.hits > 0)
              .sort((a, b) => b.hits - a.hits)
              .slice(0, 8)
              .map(x => x.en)
            throw new Error(`Entity "${entity_id}" existiert nicht in Domain "${domain}". Treffer: ${candidates.map(c => `${c.entity_id} (${c.name})`).join(', ') || 'keine'}.`)
          }
          throw e
        }
      }

      const payload = { ...(data || {}) }
      if (entity_id) payload.entity_id = entity_id
      const result = await callService(cfg, domain, service, payload)
      const changed = Array.isArray(result) ? result.map(r => r.entity_id) : []

      // Aktion ist zugestellt — wir vertrauen dem Service-Call, anstatt
      // den State sofort wieder zu lesen (der wäre möglicherweise stale).
      return { ok: true, action: `${domain}.${service}`, entity_id, changed }
    }
  },

  tools: [
    {
      name: 'homeassistant_open',
      description: 'Öffnet das Home Assistant Web-UI in Google Chrome. Nutze das, wenn Alex sagt "öffne Home Assistant", "zeig mir Home Assistant", "mach HA auf", "Home Assistant aufmachen" o.ä. Nutzt automatisch die Tailscale-URL falls konfiguriert (funktioniert sowohl im LAN als auch unterwegs), sonst LAN-URL.',
      parameters: {
        type: 'object',
        properties: {}
      }
    },
    {
      name: 'homeassistant_state',
      description: 'Aktuellen State einer EXISTIERENDEN Home-Assistant-Entity holen. WICHTIG: NIEMALS entity_ids raten oder erfinden! Wenn du nicht 100% sicher bist welche entity_id Alex meint, RUFE ZUERST homeassistant_list AUF. Eine erfundene entity_id liefert 404 oder ändert nichts.',
      parameters: {
        type: 'object',
        properties: {
          entity_id: { type: 'string', description: 'Vollständige, BEKANNTE Entity-ID — vorher per homeassistant_list verifiziert.' }
        },
        required: ['entity_id']
      }
    },
    {
      name: 'homeassistant_list',
      description: 'Entities suchen oder auflisten. IMMER zuerst aufrufen wenn du eine entity_id brauchst und sie nicht im System-Context steht. Nutze "query" für Substring-Suche (z.B. query="kueche" findet alles mit "kueche" oder "küche" im Namen) oder "domain" zum Filtern (light, sensor, switch, climate, scene, script, automation, media_player, person, binary_sensor).',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string', description: 'Optional: HA-Domain (light, sensor, switch, scene, script, automation, climate, media_player, person, binary_sensor, ...).' },
          query:  { type: 'string', description: 'Optional: Substring-Suche im entity_id oder friendly_name.' }
        }
      }
    },
    {
      name: 'homeassistant_call',
      description: 'Service-Call AUSFÜHREN — Geräte schalten, Szenen aktivieren, Skripte/Automationen triggern. PFLICHTAUFRUF bei jedem Schalt-Wunsch von Alex (auch wenn dasselbe gerade eben gemacht wurde — jeder Befehl = neuer Call). NIEMALS einen State-Wechsel behaupten ohne diesen Call gemacht zu haben. WICHTIG: entity_id muss EXISTIEREN — vorher per homeassistant_list verifizieren. Beispiele: domain=light service=turn_off entity_id=light.kueche; domain=climate service=set_temperature entity_id=climate.wohnzimmer data={"temperature":21}; domain=scene service=turn_on entity_id=scene.gemuetlich; domain=script service=morning_routine.',
      parameters: {
        type: 'object',
        properties: {
          domain:    { type: 'string', description: 'Service-Domain (light, switch, climate, scene, script, automation, media_player, ...).' },
          service:   { type: 'string', description: 'Service-Name (turn_on, turn_off, toggle, set_temperature, trigger, ...).' },
          entity_id: { type: 'string', description: 'VERIFIZIERTE Entity-ID (per homeassistant_list geprüft). Leer lassen wenn Service ohne Entity läuft (z. B. domain=script service=<scriptname>).' },
          data:      { type: 'object', description: 'Optional: zusätzliche Service-Parameter (z. B. {"brightness":200} für Licht oder {"temperature":21} für Heizung).' }
        },
        required: ['domain', 'service']
      }
    }
  ]
}
