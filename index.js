require('dotenv').config();
const express = require('express');

const app = express();

// ----- KONFIGURACJA SPOTIFY -----
const clientId = process.env.SPOTIFY_CLIENT_ID;
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
const redirectUri =
  process.env.SPOTIFY_REDIRECT_URI || 'http://127.0.0.1:8888/callback';

if (!clientId || !clientSecret || !redirectUri) {
  console.warn(
    'Brakuje SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET / SPOTIFY_REDIRECT_URI w zmiennych środowiskowych.'
  );
}

const SCOPES = [
  'user-read-currently-playing',
  'user-read-playback-state',
].join(' ');

// ----- PROSTE PRZECHOWYWANIE TOKENÓW W PAMIĘCI -----
let accessToken = null;
let refreshToken = null;
let tokenExpiresAt = 0;

// ----- POMOCNICZE -----
function toBase64(str) {
  return Buffer.from(str).toString('base64');
}

async function refreshAccessToken() {
  if (!refreshToken) {
    throw new Error('Brak refresh tokena');
  }

  const body = new URLSearchParams();
  body.append('grant_type', 'refresh_token');
  body.append('refresh_token', refreshToken);

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + toBase64(`${clientId}:${clientSecret}`),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error('Błąd odświeżania tokena: ' + text);
  }

  const data = await res.json();
  accessToken = data.access_token;
  const expiresInSec = data.expires_in || 3600;
  tokenExpiresAt = Date.now() + (expiresInSec - 60) * 1000; // mały zapas
}

async function ensureAccessToken() {
  if (!accessToken || Date.now() > tokenExpiresAt) {
    await refreshAccessToken();
  }
}

// ----- ROUTES -----

// Prosty root – przekierowanie na widget
app.get('/', (req, res) => {
  res.redirect('/widget');
});

// Logowanie do Spotify
app.get('/login', (req, res) => {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: SCOPES,
    redirect_uri: redirectUri,
  });

  const url = `https://accounts.spotify.com/authorize?${params.toString()}`;
  res.redirect(url);
});

// Callback po logowaniu
app.get('/callback', async (req, res) => {
  const code = req.query.code;
  const error = req.query.error;

  if (error) {
    return res
      .status(400)
      .send('Błąd logowania do Spotify: ' + String(error));
  }
  if (!code) {
    return res.status(400).send('Brak kodu autoryzacji z Spotify');
  }

  try:
  {
    const body = new URLSearchParams();
    body.append('grant_type', 'authorization_code');
    body.append('code', code);
    body.append('redirect_uri', redirectUri);

    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + toBase64(`${clientId}:${clientSecret}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      throw new Error('Błąd pobierania tokena: ' + text);
    }

    const data = await tokenRes.json();
    accessToken = data.access_token;
    refreshToken = data.refresh_token || refreshToken;
    const expiresInSec = data.expires_in || 3600;
    tokenExpiresAt = Date.now() + (expiresInSec - 60) * 1000;

    res.send(
      '<html><body style="background:#111;color:#fff;font-family:Arial;padding:20px;">' +
        '<h2>Zalogowano do Spotify ✅</h2>' +
        '<p>Możesz zamknąć to okno i włączyć streama.</p>' +
        '</body></html>'
    );
  } catch (err) {
    console.error(err);
    res.status(500).send('Błąd podczas logowania do Spotify.');
  }
});

// API: aktualny utwór / ostatnio odtwarzany (w tym pauza)
app.get('/current-track', async (req, res) => {
  if (!accessToken && !refreshToken) {
    return res.json({ active: false });
  }

  try {
    await ensureAccessToken();
  } catch (err) {
    console.error('Błąd ensureAccessToken:', err);
    return res.json({ active: false });
  }

  try {
    // /me/player zwraca też dane, gdy jest pauza
    const playerRes = await fetch('https://api.spotify.com/v1/me/player', {
      headers: {
        Authorization: 'Bearer ' + accessToken,
      },
    });

    if (playerRes.status === 204) {
      return res.json({ active: false });
    }
    if (!playerRes.ok) {
      const text = await playerRes.text();
      console.error('Błąd me/player:', text);
      return res.json({ active: false });
    }

    const data = await playerRes.json();
    if (!data || !data.item) {
      return res.json({ active: false });
    }

    const item = data.item;
    const title = item.name;
    const artist = (item.artists || [])
      .map((a) => a.name)
      .join(', ');
    const images = item.album && item.album.images ? item.album.images : [];
    const cover = images.length ? images[0].url : '';

    res.json({
      active: true,
      playing: Boolean(data.is_playing),
      title,
      artist,
      cover,
      progress_ms: data.progress_ms || 0,
      duration_ms: item.duration_ms || 0,
    });
  } catch (err) {
    console.error(err);
    res.json({ active: false });
  }
});

// Widget – kompaktowa karta
app.get('/widget', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="pl">
    <head>
      <meta charset="UTF-8" />
      <title>Spotify Now Playing</title>

      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&display=swap" rel="stylesheet">

      <style>
        * { box-sizing: border-box; }

        body {
          margin: 0;
          padding: 0;
          font-family: "Rajdhani", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          background: transparent;
          color: #ffffff;
        }

        .card {
          position: relative;
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 8px 10px;
          border-radius: 22px;
          overflow: hidden;
          background: #40373c;
          border: 1px solid rgba(0,0,0,0.9);
          box-shadow: 0 10px 24px rgba(0,0,0,0.8), 0 0 10px rgba(0,0,0,0.6);
          opacity: 0;
          transform: translateY(5px);
          transition: opacity 0.2s ease, transform 0.2s ease;
          pointer-events: none;
          width: auto;
        }

        .card.visible {
          opacity: 1;
          transform: translateY(0);
          pointer-events: auto;
        }

        .card::before {
          content: "";
          position: absolute;
          inset: 1px;
          border-radius: 21px;
          border: 1px solid rgba(255,255,255,0.04);
          pointer-events: none;
        }

        .cover {
          width: 70px;
          height: 70px;
          border-radius: 18px;
          overflow: hidden;
          flex-shrink: 0;
          box-shadow: 0 8px 18px rgba(0,0,0,0.8), 0 0 8px rgba(0,0,0,0.7);
        }

        .cover img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .info {
          display: flex;
          flex-direction: column;
          min-width: 0;
          flex: 0 0 auto;
        }

        .top-label {
          font-size: 10px;
          opacity: 0.8;
          margin-bottom: 2px;
          text-align: left;
        }

        .info-inner {
          width: 180px;
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .title {
          font-size: 18px;
          font-weight: 700;
          letter-spacing: 0.01em;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          text-align: center;
          text-shadow: 0 1px 3px rgba(0,0,0,0.9), 0 0 6px rgba(0,0,0,0.7);
        }

        .artist {
          font-size: 13px;
          font-weight: 500;
          opacity: 0.9;
          margin-top: 1px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          text-align: center;
          text-shadow: 0 1px 3px rgba(0,0,0,0.9), 0 0 6px rgba(0,0,0,0.7);
        }

        .progress-wrap {
          margin-top: 6px;
          width: 100%;
        }

        .progress-bar {
          width: 100%;
          height: 2px;
          border-radius: 999px;
          background: rgba(255,255,255,0.25);
          overflow: hidden;
        }

        .progress-fill {
          width: 0%;
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, #ffffff, #1ed760);
          box-shadow: 0 0 4px rgba(255,255,255,0.7);
          transition: width 0.2s ease-out;
        }

        .time-row {
          margin-top: 2px;
          font-size: 9px;
          opacity: 0.9;
          display: flex;
          justify-content: space-between;
          font-variant-numeric: tabular-nums;
          width: 100%;
        }
      </style>
    </head>
    <body>
      <div class="card" id="root">
        <div class="cover">
          <img id="cover-img" src="" alt="">
        </div>

        <div class="info">
          <div class="top-label">Spotify</div>

          <div class="info-inner">
            <div class="title" id="title"></div>
            <div class="artist" id="artist"></div>

            <div class="progress-wrap">
              <div class="progress-bar">
                <div class="progress-fill" id="progress-fill"></div>
              </div>
              <div class="time-row">
                <span id="current-time">0:00</span>
                <span id="total-time">0:00</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <script>
        const rootEl = document.getElementById('root');
        const coverEl = document.getElementById('cover-img');
        const titleEl = document.getElementById('title');
        const artistEl = document.getElementById('artist');
        const progressFillEl = document.getElementById('progress-fill');
        const currentTimeEl = document.getElementById('current-time');
        const totalTimeEl = document.getElementById('total-time');

        function formatTime(ms) {
          if (!ms || ms <= 0) return "0:00";
          const totalSeconds = Math.floor(ms / 1000);
          const m = Math.floor(totalSeconds / 60);
          const s = totalSeconds % 60;
          return m + ":" + (s < 10 ? "0" + s : s);
        }

        async function fetchTrack() {
          try {
            // WAŻNE: ścieżka względna, żeby działało na Renderze
            const res = await fetch('/current-track');
            const data = await res.json();

            if (!data.active) {
              rootEl.classList.remove('visible');
              titleEl.textContent = "";
              artistEl.textContent = "";
              coverEl.src = "";
              progressFillEl.style.width = "0%";
              currentTimeEl.textContent = "0:00";
              totalTimeEl.textContent = "0:00";
              return;
            }

            rootEl.classList.add('visible');

            titleEl.textContent = data.title || "";
            artistEl.textContent = data.artist || "";
            coverEl.src = data.cover || "";

            const duration = data.duration_ms || 0;
            const progress = data.progress_ms || 0;

            totalTimeEl.textContent = formatTime(duration);
            currentTimeEl.textContent = formatTime(progress);

            if (duration > 0) {
              const ratio = Math.max(0, Math.min(1, progress / duration));
              progressFillEl.style.width = (ratio * 100).toFixed(1) + "%";
            } else {
              progressFillEl.style.width = "0%";
            }

          } catch (e) {
            console.error(e);
          }
        }

        fetchTrack();
        setInterval(fetchTrack, 2000);
      </script>
    </body>
    </html>
  `);
});

// ----- START SERWERA -----
const PORT = process.env.PORT || 8888;
app.listen(PORT, () => {
  console.log('Server działa na porcie: ' + PORT);
});
