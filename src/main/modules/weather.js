
// Geocode city name to lat/lon via Open-Meteo geocoding API.
// Robust gegen Eingaben wie "Lignano, Italien" – wir versuchen zuerst die
// volle Eingabe, dann nur den ersten Teil vor dem Komma.
async function geocodeCity(city) {
  if (!city || city.toLowerCase() === 'salzburg') {
    return { lat: 47.8095, lon: 13.0550, name: 'Salzburg' }
  }
  const candidates = [city.trim()]
  if (city.includes(',')) candidates.push(city.split(',')[0].trim())
  for (const q of candidates) {
    try {
      const res = await axios.get('https://geocoding-api.open-meteo.com/v1/search', {
        params: { name: q, count: 1, language: 'de', format: 'json' },
        timeout: 5000
      })
      const r = res.data.results?.[0]
      if (r) {
        return {
          lat: r.latitude, lon: r.longitude,
          name: r.name + (r.country ? ', ' + r.country : '')
        }
      }
    } catch (err) {
      console.error('[Weather] geocode failed for', q, ':', err.message)
    }
  }
  console.error('[Weather] geocode: keine Treffer für', city, '→ Fallback Salzburg')
  return { lat: 47.8095, lon: 13.0550, name: 'Salzburg (Fallback)' }
}

import axios from 'axios'

const WMO = {
  0:'Klarer Himmel', 1:'Überwiegend klar', 2:'Teilweise bewölkt', 3:'Bedeckt',
  45:'Nebel', 48:'Reifnebel', 51:'Leichter Nieselregen', 53:'Nieselregen',
  55:'Starker Nieselregen', 61:'Leichter Regen', 63:'Regen', 65:'Starker Regen',
  71:'Leichter Schnee', 73:'Schnee', 75:'Starker Schnee',
  80:'Regenschauer', 81:'Regenschauer', 82:'Starke Regenschauer',
  95:'Gewitter', 96:'Gewitter mit Hagel', 99:'Gewitter mit Hagel'
}

export const weatherModule = {
  name: 'weather',
  description: 'Wetter Salzburg: Aktuell, stündlich und Tagesvorhersage',

  actions: {
    getCurrent: async ({ city, detail = 'compact' } = {}) => {
      const loc = await geocodeCity(city)
      console.log('[Weather] getCurrent for:', loc.name, 'detail:', detail)
      try {
        const res = await axios.get(`https://wttr.in/${encodeURIComponent(loc.name.split(',')[0])}?format=j1`, {
          timeout: 8000,
          headers: { 'User-Agent': 'Lyra/1.0' }
        })
        const cur = res.data.current_condition?.[0]
        const day = res.data.weather?.[0]

        // Also get hourly from Open-Meteo for today
        const hourly = await getHourlyForecast(0, loc.lat, loc.lon, detail)

        return {
          ort: loc.name,
          temperature:  parseInt(cur?.temp_C),
          feelsLike:    parseInt(cur?.FeelsLikeC),
          condition:    cur?.weatherDesc?.[0]?.value || '',
          humidity:     parseInt(cur?.humidity),
          windKmh:      parseInt(cur?.windspeedKmph),
          todayMax:     parseInt(day?.maxtempC),
          todayMin:     parseInt(day?.mintempC),
          sunrise:      day?.astronomy?.[0]?.sunrise,
          sunset:       day?.astronomy?.[0]?.sunset,
          hourly_today: hourly,
          source:       'wttr.in + Open-Meteo'
        }
      } catch (err) {
        console.error('[Weather] wttr.in error:', err.message)
        return await getFallback(loc.lat, loc.lon)
      }
    },

    getForecast: async ({ days = 1, city, detail = 'compact' } = {}) => {
      // days=1 = morgen, days=2 = morgen+übermorgen, days=3 = die nächsten 3 Tage
      try {
        const loc = await geocodeCity(city)
        const wantedDays = Math.min(Math.max(parseInt(days) || 1, 1), 7)
        console.log('[Weather] getForecast for:', loc.name, 'days:', wantedDays, 'detail:', detail)
        // Open-Meteo: zuverlässig, weltweit, kostenlos.
        // forecast_days = wantedDays + 1 → Index 0 = heute, 1 = morgen, ...
        // Mit Retry, weil Open-Meteo gelegentlich Slow-Spikes hat.
        const res = await getWithRetry('https://api.open-meteo.com/v1/forecast', {
          params: {
            latitude:  loc.lat,
            longitude: loc.lon,
            daily:     'temperature_2m_max,temperature_2m_min,weathercode,sunrise,sunset,precipitation_probability_max',
            timezone:  'auto',
            forecast_days: wantedDays + 1
          },
          timeout: 15000
        }, 2)
        const d = res.data.daily
        if (!d?.time?.length) return { error: 'Keine Wetterdaten verfügbar' }

        const forecast = []
        for (let i = 1; i <= wantedDays; i++) {
          if (!d.time[i]) break
          const date = new Date(d.time[i])
          const hourly = await getHourlyForecast(i, loc.lat, loc.lon, detail)
          forecast.push({
            ort:       loc.name,
            datum:     date.toLocaleDateString('de-AT', { weekday:'long', day:'numeric', month:'long' }),
            max:       Math.round(d.temperature_2m_max[i]) + '°C',
            min:       Math.round(d.temperature_2m_min[i]) + '°C',
            condition: WMO[d.weathercode[i]] || 'unbekannt',
            regen_pct: (d.precipitation_probability_max?.[i] ?? 0) + '%',
            sunrise:   d.sunrise[i]?.split('T')[1] || '',
            sunset:    d.sunset[i]?.split('T')[1] || '',
            hourly
          })
        }
        return { forecast, source: 'Open-Meteo' }
      } catch (err) {
        console.error('[Weather] forecast error:', err.message)
        return { error: err.message }
      }
    }
  },

  tools: [
    {
      name: 'weather_getCurrent',
      description: 'Aktuelles Wetter. Liefert Min/Max, Bedingung und 4 Tageszeiten (morgens/mittags/nachmittags/abends). detail="hourly" NUR wenn Alex explizit "stündlich" oder "Tagesverlauf" sagt – sonst Default lassen, sonst wird die Antwort viel zu lang.',
      parameters: {
        type: 'object',
        properties: {
          city:   { type: 'string', description: 'Stadt (z.B. Wien, Lignano, Rom). Leer = Salzburg.' },
          detail: { type: 'string', description: '"compact" (Default, 4 Tageszeiten) oder "hourly" (alle 24 Stunden, NUR auf explizite Anfrage)' }
        }
      }
    },
    {
      name: 'weather_getForecast',
      description: 'Wettervorhersage. days=1 für morgen, days=2 für übermorgen, usw. detail="hourly" NUR auf explizite Anfrage – sonst kompakt mit 4 Tageszeiten.',
      parameters: {
        type: 'object',
        properties: {
          days:   { type: 'number', description: 'Zieltag: 1=morgen, 2=übermorgen, 3=in 3 Tagen' },
          city:   { type: 'string', description: 'Stadt (z.B. Wien, Lignano, Rom). Leer = Salzburg.' },
          detail: { type: 'string', description: '"compact" (Default, 4 Tageszeiten) oder "hourly" (alle 24 Stunden, NUR auf explizite Anfrage)' }
        }
      }
    }
  ]
}

// Open-Meteo hourly forecast for a specific day offset.
// detail='compact' (default): 4 Tageszeiten (9/13/17/21 Uhr)
// detail='hourly': alle 24 Stunden
async function getHourlyForecast(dayOffset = 0, lat = 47.8095, lon = 13.0550, detail = 'compact') {
  try {
    const res = await getWithRetry('https://api.open-meteo.com/v1/forecast', {
      params: {
        latitude:  lat,
        longitude: lon,
        hourly:    'temperature_2m,apparent_temperature,weathercode,precipitation_probability',
        timezone:  'Europe/Vienna',
        forecast_days: dayOffset + 1
      },
      timeout: 15000
    }, 2)

    const h = res.data.hourly
    const startIdx = dayOffset * 24
    const result = []

    // Welche Stunden ausgeben?
    const wantedHours = detail === 'hourly'
      ? [...Array(24).keys()]            // 0..23
      : [9, 13, 17, 21]                  // morgens, mittags, nachmittags, abends
    const labels = {
      9:  'morgens',  13: 'mittags',
      17: 'nachmittags', 21: 'abends'
    }

    for (const h0 of wantedHours) {
      const i = startIdx + h0
      if (!h.time[i]) continue
      const hour = parseInt(h.time[i].split('T')[1])
      result.push({
        zeit:       detail === 'hourly'
                    ? `${String(hour).padStart(2,'0')}:00 Uhr`
                    : `${String(hour).padStart(2,'0')}:00 Uhr (${labels[h0] || ''})`,
        temp:       Math.round(h.temperature_2m[i]) + '°C',
        gefuehlt:   Math.round(h.apparent_temperature[i]) + '°C',
        condition:  WMO[h.weathercode[i]] || '',
        regen_pct:  h.precipitation_probability[i] + '%'
      })
    }
    return result
  } catch (err) {
    console.error('[Weather] Open-Meteo hourly error:', err.message)
    return []
  }
}

async function getFallback(lat = 47.8095, lon = 13.0550) {
  try {
    const res = await axios.get('https://api.open-meteo.com/v1/forecast', {
      params: {
        latitude: lat, longitude: lon,
        current:  'temperature_2m,apparent_temperature,weathercode,windspeed_10m',
        daily:    'temperature_2m_max,temperature_2m_min,weathercode',
        timezone: 'Europe/Vienna', forecast_days: 1
      },
      timeout: 8000
    })
    const c = res.data.current
    const d = res.data.daily
    const hourly = await getHourlyForecast(0, lat, lon)
    return {
      temperature:  Math.round(c.temperature_2m),
      feelsLike:    Math.round(c.apparent_temperature),
      condition:    WMO[c.weathercode] || '',
      todayMax:     Math.round(d.temperature_2m_max[0]),
      todayMin:     Math.round(d.temperature_2m_min[0]),
      hourly_today: hourly,
      source:       'Open-Meteo'
    }
  } catch (err) {
    return { error: err.message, available: false }
  }
}

// ── Retry-Helper ─────────────────────────────────────────────────────────────
// Versucht GET bis zu `attempts`-mal. Wartet zwischen Versuchen exponentiell
// (500ms → 1500ms). Nur Timeouts und 5xx-Errors lösen Retry aus.
async function getWithRetry(url, opts, attempts = 2) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      return await axios.get(url, opts)
    } catch (err) {
      lastErr = err
      const status = err.response?.status
      const isTimeout = err.code === 'ECONNABORTED' || /timeout/i.test(err.message || '')
      const isServerErr = status >= 500 && status < 600
      if (!isTimeout && !isServerErr) throw err          // Client-Fehler → nicht wiederholen
      if (i < attempts - 1) {
        const wait = 500 * Math.pow(3, i)                // 500ms, 1500ms
        console.warn(`[Weather] retry ${i+1}/${attempts-1} in ${wait}ms (${err.message})`)
        await new Promise(r => setTimeout(r, wait))
      }
    }
  }
  throw lastErr
}
