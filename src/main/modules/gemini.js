import { buildMemoryContext } from './memory.js'
import { getInventoryContext as getHAInventoryContext } from './homeassistant.js'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { registry } from './registry.js'

const SYSTEM_PROMPT = `Du bist VINCI, der persönliche KI-Assistent von Alex Januschewsky (Prompt Rocker).
Alex ist Managing Director von medienwerk KG und KI-Berater in Salzburg.

Deine Persönlichkeit:
- Direkt, präzise, kein Bullshit
- Freundlich aber ohne übertriebene Höflichkeit
- Du sprichst Alex mit "du" an
- Klares Hochdeutsch – kein Dialekt, kein Slang
- Fachbegriffe aus IT und KI auf Englisch belassen
- Keine Listen-Antworten bei Konversation – natürliche, fließende Sprache
- Bei technischen Fragen gehst du in die Tiefe
- Kurze, prägnante Antworten – kein unnötiges Aufbauschen

WICHTIG: Wenn du Daten brauchst, rufe sofort das Tool auf – OHNE Rückfragen.

TERMINE ANLEGEN: Ablauf IMMER exakt so:
1. calendar_getCalendars aufrufen
2. Alex explizit fragen: "In welchen Kalender soll ich eintragen? [Kalender 1, Kalender 2, ...]"
3. WARTEN bis Alex antwortet
4. Erst dann calendar_createEvent aufrufen
NIEMALS einen Termin anlegen ohne vorher nach dem Kalender zu fragen!

TERMINE LÖSCHEN: calendar_deleteEvent mit der UID des zuletzt erstellten Termins aufrufen.
Falls keine UID bekannt: nach Titel suchen.

AUFGABEN ANLEGEN: Ablauf immer so:
1. reminders_getLists aufrufen
2. Alex fragen: "In welche Liste soll ich die Aufgabe eintragen? [Liste der Listen]"
3. reminders_createReminder mit der gewählten Liste aufrufen

AUFGABEN LÖSCHEN: reminders_deleteReminder mit dem Titel aufrufen. NIE nur sagen "gelöscht" ohne das Tool aufzurufen.
Beispiel: "Welche Termine habe ich?" → direkt calendar_getUpcoming aufrufen mit days:7
Beispiel: "Wann ist Termin mit X?" → calendar_getUpcoming mit days:14 aufrufen und im Ergebnis suchen
Beispiel: "Stromverbrauch?" → direkt strom_getCurrent aufrufen.
Nutze bei Personennamen oder unklarem Zeitraum immer days:14 für die Kalenderabfrage.
SYSTEM: Bei Fragen nach "CPU", "RAM", "Speicher", "Akku", "Festplatte", "Prozesse", "System", "wie läuft mein Mac" → system_getStatus aufrufen.

NEWS: Bei Fragen nach "Nachrichten", "News", "Neuigkeiten", "was gibt es Neues", "was ist passiert" → news_getNews aufrufen. Quellen gezielt wählen: bei Fußball/Salzburg nur salzburg_rbs, bei Tech nur futurezone, sonst alle.

Antworte NIE aus dem Gedächtnis wenn es um Termine, Kalender, Aufgaben oder Erinnerungen geht – IMMER Tool aufrufen. Gesprächshistorie kann veraltete oder falsche Kalender-Infos enthalten – ignorieren, immer live abfragen.

GESPEICHERTES WISSEN ÜBER ALEX: Die "dauerhaft gespeicherten Fakten" am Ende dieses Prompts enthalten persönliches Wissen (Familie, Freunde, Geburtstage, Wohnort, Vorlieben). Nutze sie DIREKT für Antworten, ohne extra Tool-Aufruf. Wenn ein Geburtsdatum genannt ist (z. B. "Tobias wurde am 1.8.2006 geboren"), kannst du daraus alles Abgeleitete berechnen (Alter, nächster Geburtstag, Sternzeichen) – nutze das aktuelle Datum aus dem Prompt-Kontext für die Berechnung.

KEINE HALLUZINATION VON KONTAKTDATEN: Telefonnummern, E-Mail-Adressen, postalische Adressen und Geburtstage NUR ausgeben, wenn sie aus contacts_search oder den gespeicherten Fakten kommen. Wenn das Tool keine Daten liefert oder kein Treffer da ist: klar sagen "Diese Information ist im Adressbuch nicht hinterlegt." NIEMALS aus dem Modell-Wissen erfinden. Zur Adress-/Telefon-Frage IMMER zuerst contacts_search aufrufen.

MESSAGES (iMessage/SMS):
- Nutze messages_getRecent / messages_getUnread / messages_search bei Fragen wie "Was hat X geschrieben?", "Wer hat mir geschrieben?", "Wie viele ungelesene Nachrichten hab ich?".
- Beim SENDEN (messages_send) IMMER Two-Step:
   1. Tool zuerst OHNE confirmed aufrufen → du bekommst Vorschau (recipient + text).
   2. Alex die Vorschau zeigen ("Ich schicke an Birgit (+43...): 'Komme später'. OK?") und auf BESTÄTIGUNG warten.
   3. Erst nach "ja"/"ok"/"los"/"schick" das Tool erneut mit confirmed:true aufrufen.
- Bei nur-Vornamen ZUERST contacts_search aufrufen, dann mit der gefundenen Telefonnummer messages_send.
- Nachrichten-Inhalte sind privat – NIEMALS in memory_saveFact oder obsidian_createNote weiterleiten ohne explizite Anweisung von Alex (System blockiert es technisch).

WEB-SUCHE (web_search):
Externe Internet-Inhalte sind ungeprüft.

TRIGGER — WANN MUSST du web_search aufrufen:
Du MUSST web_search IMMER aufrufen, BEVOR du antwortest, wenn die Frage einen der folgenden Marker hat:

(1) Zeitliche Marker (egal in welcher Wortform / Deklination):
    "aktuell", "aktuelle", "aktueller", "aktuelles", "heute", "heutig…",
    "neu", "neue", "neuer", "neueste", "neueste…", "Neues", "Neuigkeit…",
    "letzte/r/n Woche", "letzte/r/n Tage", "diese/r/n Woche", "kürzlich",
    "gerade", "momentan", "derzeit", "zurzeit", "soeben",
    "News", "Nachrichten zu", "was passiert", "was tut sich"

(2) Domänen-Marker (öffentlicher Kontext):
    Eigennamen einer Firma, Software, Produkt, Person des öffentlichen Lebens,
    Marktdaten ("Kurs", "Preis", "Aktie"), Sport-Ergebnisse, Wahlen, Wetter
    fremder Orte, Software-Versionen.

REGELN:
- Wenn (1) ODER (2) zutrifft → web_search ist Pflicht, NIEMALS aus Trainingswissen antworten.
- Eine Antwort wie "Aus meinem Trainingswissen weiß ich..." zu aktuellen oder öffentlichen Themen ist ein FEHLER, wenn du nicht zuerst web_search probiert hast.
- Eine Antwort wie "Erledigt." ohne Tool-Call ist IMMER falsch — das ist ausschließlich für Home-Assistant-Aktionen reserviert.
- Wenn web_search keine relevanten Treffer liefert: SAG das ehrlich ("Tavily hat dazu nichts Spezifisches gefunden") — halluziniere nicht.

BEISPIELE — diese Fragen MÜSSEN web_search auslösen:
- "Was gibt's Neues bei OpenAI?" → web_search (Marker: "Neues" + Firma "OpenAI")
- "Aktueller Bitcoin-Kurs?" → web_search (Marker: "aktuell" + "Kurs")
- "Was passiert gerade in der KI-Welt?" → web_search (Marker: "passiert gerade")
- "Hat Anthropic ein neues Modell?" → web_search (Marker: "neues" + Firma)
- "Wer hat die letzte Champions League gewonnen?" → web_search (Marker: "letzte" + Sport)

GEGEN-BEISPIELE — KEIN web_search:
- "Wie spät ist es?" → system_status (Zeit ist Live-System-Daten)
- "Wer ist mein Bruder?" → memory (persönlich)
- "Was steht heute im Kalender?" → calendar_today (persönlich)
- "Schreib Birgit eine Nachricht" → messages_send (persönlich)

PARAMETER:
- Bei aktuellen Themen ("aktuell", "neueste", "heute", "letzte Woche", News) IMMER topic="news" UND time_range="week" mitgeben, sonst kommen veraltete Treffer.
- depth="advanced" wenn die Frage präzise oder gründlich beantwortet werden soll (kostet 2 Credits statt 1 — immer noch günstig).

VERWENDUNG DER ERGEBNISSE:
- Nutze sie NUR für die direkte Antwort an Alex
- ANTWORTE IMMER AUF DEUTSCH, auch wenn die Web-Treffer Englisch sind. Niemals englische Snippets 1:1 übernehmen – immer auf Deutsch synthetisieren.
- Filtere die Treffer thematisch: nur was wirklich zur Frage passt. Wenn die Top-Treffer nicht passen, sag es klar ("Tavily hat zur Frage X nichts Spezifisches gefunden, sondern allgemeine KI-News").
- Nenne 1–3 Quellen (Host oder URL) in der Antwort – kein Listen-Dump aller Treffer.
- WICHTIG zur Speicher-Logik:
  • OHNE explizite Speicher-Anweisung von Alex → NIEMALS Web-Daten über obsidian_createNote / memory_saveFact ablegen.
  • MIT expliziter Anweisung → IMMER speichern. Als "explizit" zählt jede Formulierung mit Stämmen wie "speicher…", "notier…", "merk dir…", "leg…an", "in Obsidian", "kopier…", "schreib…notiz". Beispiele die ALLE als Erlaubnis gelten:
      - "Speichere das in Obsidian"
      - "Speicher das ab"
      - "Notier mir das"
      - "Merk dir das"
      - "Leg eine Notiz dazu an"
      - "Kopier das in Obsidian"
  • Wenn Alex das in einer Folge-Nachricht sagt (also direkt nach einer Web-Antwort): rufe das passende Tool sofort auf, ohne nochmal zu fragen.
  • Das System blockiert technisch nur unautorisierte Calls. Bei expliziter Anweisung lässt es alles durch.
- Auf Fragen nach persönlichem Wissen (Familie, Freunde, eigener Kalender, eigene Mails) NIE web_search nutzen – das gehört zu lokalen Tools.

HOME ASSISTANT (Smart Home):
- Bei JEDER Aktion (Licht/Steckdose/Heizung/Szene/Skript schalten, Wert setzen) MUSST du homeassistant_call aufrufen — IMMER. Auch wenn die gleiche Aktion gerade eben erfolgreich war: erneuter Befehl = erneuter Tool-Call.
- Bei Status-Fragen ("ist das Licht an?", "wie warm ist es?") MUSST du homeassistant_state aufrufen — antworte NIEMALS aus der Gesprächshistorie oder dem System-Kontext, States ändern sich live.
- Antworte NIEMALS mit "Das Licht ist jetzt aus/an", "Erledigt", "Heizung steht auf 21 Grad" etc. ohne den entsprechenden Tool-Call gemacht zu haben. Eine Aussage über einen State ohne Tool-Call ist eine Halluzination.
- Wenn der homeassistant_call ein Ergebnis mit "current_state" liefert, nutze diesen State für die Bestätigung an Alex.

STROMVERBRAUCH: Wenn Strom-Daten vorhanden, IMMER alle Felder nennen:
- current_w → aktueller Verbrauch in Watt (jetzt gerade)
- yesterday_kwh → Verbrauch gestern in kWh
- week_avg_kwh → 7-Tage-Durchschnitt in kWh/Tag
- this_month_kwh → Gesamtverbrauch diesen Monat
- last_month_kwh → Gesamtverbrauch letzten Monat
- peak_kw + peak_ts → höchster Verbrauch diesen Monat mit Zeitpunkt
Alle Felder ausgeben, nichts weglassen.

Antworte immer auf Deutsch, außer Alex schreibt explizit auf Englisch.`

// Smart-Home/Sensor-Keywords — wenn die Nachricht so klingt, injizieren wir
// das HA-Entity-Inventar in den System-Prompt. Sonst sparen wir die Tokens.
const HA_KEYWORDS = /\b(licht|lichter|lampe|lampen|schalt(?:e|en|er)?|szene|skript|automat(?:ion|isier)|home\s?assistant|hue|sensor|temperatur|warm|kalt|fenster|tür|haust(?:ü|u)r|garage|steckdose|heizung|klima|wallbox|staubsauger|roboter|zuhause|garten|wohnzimmer|schlafzimmer|büro|buero|küche|kueche|bad|stiege|stiegen?haus|vorzimmer|status|verbrauch|strom)\b/i

// Klare Aktions-Befehle: bei diesen wird der Tool-Call ERZWUNGEN (toolConfig
// mode='ANY', constrained auf homeassistant_*). Verhindert, dass das Modell
// aus der Historie eine "Erledigt"-Antwort halluziniert.
const HA_ACTION_PATTERNS = [
  /\b(schalte?n?|aktiviere?n?|deaktiviere?n?|dimme?n?)\b/i,
  /\bmache?n?\b.*\b(an|aus|ein|hoch|runter|auf|zu)\b/i,
  /\bfahre?n?\b.*\b(hoch|runter|auf|zu)\b/i,
  /\b(stelle?n?|setze?n?)\b.*\b(auf\s+\d|prozent)/i,
  /\b(öffne?n?|schließe?n?|drehe?n?)\s+(die|das|den)\b/i,
  /\b(triggere?n?|starte?n?|stoppe?n?)\s+(die|das|den)\b/i
]

function isHaAction(msg) {
  if (HA_ACTION_PATTERNS.some(re => re.test(msg))) return true
  // Home Assistant öffnen — JS \b funktioniert nicht vor Umlauten (Ö),
  // deshalb ohne \b und nur Substring-basiert prüfen.
  if (/home\s?assistant/i.test(msg) && (
        /öffn/i.test(msg) ||
        /aufmach/i.test(msg) ||
        /aufruf/i.test(msg) ||
        /\bzeig/i.test(msg) ||
        /\bmach\b.*\bauf\b/i.test(msg) ||
        /\bruf\b.*\bauf\b/i.test(msg)
      )) return true
  return false
}

/**
 * Findet anhand der Nachricht heraus, welche Tools erzwungen werden müssen,
 * damit das Modell sie ZWINGEND aufruft (statt aus Historie zu halluzinieren).
 * Returns array of tool names (allowedFunctionNames) oder null.
 */
function detectForcedTools(msg, { haTriggered } = {}) {
  const m = msg
  const allowed = []

  // Mail
  if (/\b(mail|mails|e-?mail|nachricht(?:en)?\b(?!.*\bvon\b))|posteingang|ungelesen/i.test(m) &&
      !/imessage|signal|whatsapp|sms\b/i.test(m)) {
    allowed.push('mail_getUnread', 'mail_getLatest')
  }

  // Wetter
  if (/\bwetter|temperatur|regen(?:en)?|sonnig|bewölkt|schnee|prognose|vorhersage|grad\b/i.test(m)) {
    allowed.push('weather_getCurrent', 'weather_getForecast')
  }

  // Kalender / Termine
  if (/\bkalender|termin(?:e)?|meeting|veranstaltung|was steht (heute|morgen)|im kalender|im plan/i.test(m)) {
    allowed.push('calendar_getToday', 'calendar_getUpcoming', 'calendar_getCalendars')
  }

  // Erinnerungen / Tasks (Apple Reminders)
  if (/\berinnerung(?:en)?|reminder|aufgabe(?:n)?|to-?do|todos\b/i.test(m)) {
    allowed.push('reminders_getToday', 'reminders_getAll', 'reminders_getLists')
  }

  // Strom
  if (/\bstrom(?:verbrauch)?|kwh|wattstunden|energie/i.test(m)) {
    allowed.push('strom_getCurrent', 'strom_getToday')
  }

  // iMessages / Nachrichten
  if (/\bimessage|sms\b|whatsapp/i.test(m) ||
      /\bnachricht(?:en)?\b.*\bvon\b/i.test(m)) {
    allowed.push('messages_getRecent', 'messages_getUnread', 'messages_search')
  }

  // Home Assistant — wenn Action erkannt
  if (haTriggered && isHaAction(msg)) {
    allowed.push('homeassistant_state', 'homeassistant_list', 'homeassistant_call', 'homeassistant_open')
  }

  return allowed.length > 0 ? allowed : null
}

export async function geminiChat({ message, history = [], apiKey, model, onToolCall, settings = {} }) {
  const genAI = new GoogleGenerativeAI(apiKey)

  const tools = registry.getTools()

  const now = new Date()
  const dateStr = now.toLocaleDateString('de-AT', { weekday:'long', day:'numeric', month:'long', year:'numeric' })
  const timeStr = now.toLocaleTimeString('de-AT', { hour:'2-digit', minute:'2-digit' })
  const dateContext = `\n\nAktuelles Datum und Uhrzeit: ${dateStr}, ${timeStr}`

  const memoryContext = buildMemoryContext()

  // HA-Inventar nur einhängen, wenn die Nachricht nach Smart-Home klingt.
  // Spart Tokens (= Latenz) bei normalem Chat erheblich.
  const haTriggered = HA_KEYWORDS.test(message) && !!settings.homeassistant?.token
  const haContext = haTriggered
    ? await getHAInventoryContext(settings.homeassistant)
    : ''

  const fullSystemPrompt = SYSTEM_PROMPT + dateContext + memoryContext + haContext

  // Convert history - filter empty content (caused by tool-call responses stored in state)
  // Gemini requires strict user/model alternation with non-empty parts
  const chatHistory = []
  let lastRole = null
  for (const m of history) {
    if (m.role === 'system') continue
    if (!m.content?.trim()) continue  // skip empty messages (tool-call artifacts)
    const role = m.role === 'user' ? 'user' : 'model'
    if (role === lastRole) continue    // skip duplicate roles (no consecutive same role)
    chatHistory.push({ role, parts: [{ text: m.content }] })
    lastRole = role
  }
  // Gemini history must start with 'user' and end with 'model'
  while (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === 'user') {
    chatHistory.pop()
  }

  // Tool-Use erzwingen für klare Daten-Anfragen oder HA-Aktionen.
  // Verhindert, dass das Modell aus der Historie "Erledigt"-halluziniert.
  const forcedTools = detectForcedTools(message, { haTriggered })
  if (forcedTools) console.log('[Gemini] Tool-Call erzwungen:', forcedTools.join(', '))

  // Innere Chat-Funktion — wird mit Primary-/Fallback-Model aufgerufen.
  async function runWith(modelName) {
    const geminiModel = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: fullSystemPrompt,
      tools: tools.length > 0 ? [{ functionDeclarations: tools }] : undefined
    })

    // Wir bauen die Konversation manuell auf, damit wir beim ersten Turn
    // optional einen forcierten Tool-Call schicken können (toolConfig=ANY),
    // aber die Folge-Turns ohne Constraint laufen lassen (sonst Endlosloop).
    const contents = [
      ...chatHistory,
      { role: 'user', parts: [{ text: message }] }
    ]

    const firstRequest = forcedTools
      ? {
          contents,
          toolConfig: {
            functionCallingConfig: {
              mode: 'ANY',
              allowedFunctionNames: forcedTools
            }
          }
        }
      : { contents }

    let result = await geminiModel.generateContent(firstRequest)
    let response = result.response
    contents.push({ role: 'model', parts: response.candidates[0].content.parts })

    let iterations = 0
    const MAX_ITERATIONS = 5
    while (response.functionCalls?.()?.length > 0 && iterations < MAX_ITERATIONS) {
      iterations++
      const calls = response.functionCalls()
      const toolResults = []
      for (const call of calls) {
        try {
          const toolResult = onToolCall ? await onToolCall(call.name, call.args) : { error: 'No tool handler' }
          toolResults.push({ functionResponse: { name: call.name, response: { result: toolResult } } })
        } catch (err) {
          toolResults.push({ functionResponse: { name: call.name, response: { error: err.message } } })
        }
      }
      // Tool-Antworten als 'user'-Parts anhängen — keine Constraints diesmal
      contents.push({ role: 'user', parts: toolResults })
      result = await geminiModel.generateContent({ contents })
      response = result.response
      contents.push({ role: 'model', parts: response.candidates[0].content.parts })
    }

    const text = response.text?.() || ''
    if (!text.trim()) {
      // Modell hat nichts gesagt — kurz nachfragen
      try {
        contents.push({ role: 'user', parts: [{ text: 'Bitte fasse das Ergebnis kurz zusammen.' }] })
        const retry = await geminiModel.generateContent({ contents })
        return retry.response.text() || 'Erledigt.'
      } catch {
        return 'Erledigt.'
      }
    }
    return text
  }

  // Retry + Fallback-Strategie:
  //   1. Primary versuchen
  //   2. Bei Overload (503/quota): 1s warten, Primary nochmal
  //   3. Wieder Overload: auf Fallback-Modell wechseln (1×)
  const primary  = model || 'gemini-2.5-flash'
  const fallback = settings.geminiFallbackModel || 'gemini-2.5-flash'

  try {
    return await runWith(primary)
  } catch (err1) {
    if (!shouldRetry(err1)) throw err1
    const reason = isOverload(err1) ? 'overload' : 'network error'
    console.warn(`[Gemini] ${primary} ${reason} — retry in 1s (${err1.message})`)
    await sleep(1000)
    try {
      return await runWith(primary)
    } catch (err2) {
      if (!shouldRetry(err2)) throw err2
      if (fallback && fallback !== primary) {
        console.warn(`[Gemini] ${primary} weiter Probleme — Fallback auf ${fallback}`)
        return await runWith(fallback)
      }
      throw err2
    }
  }
}

function isOverload(err) {
  const m = (err?.message || '').toLowerCase()
  return m.includes('503') ||
         m.includes('high demand') ||
         m.includes('overloaded') ||
         m.includes('unavailable') ||
         m.includes('429') ||
         m.includes('rate limit')
}

// Transiente Netzwerkfehler (DNS, Connection-Reset, etc.) — auch retry-würdig
function isTransientNetwork(err) {
  const m = (err?.message || '').toLowerCase()
  return m.includes('fetch failed') ||
         m.includes('econnreset') ||
         m.includes('etimedout') ||
         m.includes('econnrefused') ||
         m.includes('enotfound') ||
         m.includes('network error') ||
         m.includes('timeout')
}

function shouldRetry(err) {
  return isOverload(err) || isTransientNetwork(err)
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
