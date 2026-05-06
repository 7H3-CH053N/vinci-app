import { BrowserWindow } from 'electron'
import { createServer } from 'http'
import axios from 'axios'

const REDIRECT_PORT = 3847
const REDIRECT_URI  = `http://localhost:${REDIRECT_PORT}/oauth/callback`

const SCOPES = {
  calendar: [
    'https://www.googleapis.com/auth/calendar.readonly'
  ],
  mail: [
    'https://www.googleapis.com/auth/gmail.readonly'
  ]
}

export async function startGoogleOAuth(googleConfig, service, parentWin) {
  const { clientId, clientSecret } = googleConfig
  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth: Client ID und Client Secret fehlen in den Einstellungen.')
  }

  const scopes = SCOPES[service]
  if (!scopes) throw new Error(`Unbekannter Service: ${service}`)

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', scopes.join(' '))
  authUrl.searchParams.set('access_type', 'offline')
  authUrl.searchParams.set('prompt', 'consent')

  // Get the auth code via local server
  const code = await waitForOAuthCode(authUrl.toString(), parentWin)

  // Exchange code for tokens
  const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code'
  })

  return {
    accessToken: tokenResponse.data.access_token,
    refreshToken: tokenResponse.data.refresh_token,
    expiresAt: Date.now() + (tokenResponse.data.expires_in * 1000)
  }
}

async function waitForOAuthCode(authUrl, parentWin) {
  return new Promise((resolve, reject) => {
    // Local server to receive callback
    const server = createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost')
      const code = url.searchParams.get('code')
      const error = url.searchParams.get('error')

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      if (code) {
        res.end('<html><body style="background:#0C0D10;color:#F59E0B;font-family:monospace;padding:40px"><h2>✓ Lyra verbunden</h2><p>Du kannst dieses Fenster schließen.</p></body></html>')
        server.close()
        authWin?.close()
        resolve(code)
      } else {
        res.end('<html><body style="background:#0C0D10;color:#ef4444;font-family:monospace;padding:40px"><h2>✗ Fehler</h2><p>' + (error || 'Unbekannter Fehler') + '</p></body></html>')
        server.close()
        authWin?.close()
        reject(new Error(error || 'OAuth cancelled'))
      }
    })

    server.listen(REDIRECT_PORT)

    // Open auth in a Lyra-styled window
    let authWin = new BrowserWindow({
      width: 500,
      height: 650,
      parent: parentWin,
      modal: true,
      webPreferences: { nodeIntegration: false }
    })

    authWin.loadURL(authUrl)
    authWin.on('closed', () => {
      server.close()
      reject(new Error('OAuth window closed'))
    })
  })
}

export async function refreshAccessToken(googleConfig, refreshToken) {
  const response = await axios.post('https://oauth2.googleapis.com/token', {
    client_id: googleConfig.clientId,
    client_secret: googleConfig.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  })

  return {
    accessToken: response.data.access_token,
    expiresAt: Date.now() + (response.data.expires_in * 1000)
  }
}

export async function getValidToken(service, ctx) {
  const { settings, tokens, saveTokens } = ctx
  const serviceTokens = tokens?.[service]

  if (!serviceTokens) {
    throw new Error(`Nicht verbunden mit ${service}. Bitte in Einstellungen → Verbindungen autorisieren.`)
  }

  // Refresh if expired (with 60s buffer)
  if (serviceTokens.expiresAt - 60000 < Date.now()) {
    const refreshed = await refreshAccessToken(settings.google, serviceTokens.refreshToken)
    const updated = { ...tokens, [service]: { ...serviceTokens, ...refreshed } }
    saveTokens(updated)
    return refreshed.accessToken
  }

  return serviceTokens.accessToken
}
