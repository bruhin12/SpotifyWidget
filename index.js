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

// Root – prosty ekran pomocniczy z linkami
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <meta charset="UTF-8" />
        <title>Spotify Widget</title>
        <style>
          body {
            background:#111;
            color:#fff;
            font-family: Arial, sans-serif;
            padding: 24px;
          }
          a {
            color:#1ed760;
            text-decoration:none;
            font-size:18px;
            display:inline-block;
            margin:8px 0;
          }
          a:hover { text-decoration:underline; }
        </style>
      </head>
      <body>
        <h2>Spotify Widget – panel serwera</h2>
        <p>
          1. <a href="/login">Zaloguj się do Spotify</a><br/>
          2. Potem otwórz <a href="/widget" target="_blank">/widget</a> (tego używasz w OBS).<br/>
        </p>
        <p style="margin-top:20px;opacity:0.7;font-size:13px;">
          Primary URL: ${redirectUri.replace('/callback', '')}
        </p>
      </body>
    </html>
  `);
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

  try {
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
        '<p>Możesz zamknąć to okno i wejść na <a href="/widget" style="color:#1ed760;">/widget</a>, a w OBS użyć tego samego adresu.</p>' +
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
    const artist = (item.artists || []).map((a) => a.name).join(', ');
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

// Widget – kompaktowa karta (już nigdy nie jest kompletnie pusto)
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
          opacity: 1;
          transform: translateY(0);
          pointer-events: auto;
          width: auto;
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
          background: #222;
          display:flex;
          align-items:center;
          justify-content:center;
          font-size:11px;
          color:#aaa;
        }

        .cover img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: none;
        }

        .cover.has-image img {
          display:block;
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

        .status-label {
          font-size: 10px;
          opacity: 0.8;
          margin-bottom: 2px;
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
        <div class="cover" id="cover-box">
          <img id="cover-img" src="" alt="">
          <span id="cover-placeholder">Brak</span>
        </div>

        <div class="info">
          <div class="top-label">Spotify</div>

          <div class="info-inner">
            <div class="status-label" id="status-label">Offline / nie zalogowano</div>
            <div class="title" id="title">Nic nie gra</div>
            <div class="artist" id="artist">Zaloguj się przez /login</div>

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
        const coverBoxEl = document.getElementById('cover-box');
        const coverImgEl = document.getElementById('cover-img');
        const coverPlaceholderEl = document.getElementById('cover-placeholder');
        const titleEl = document.getElementById('title');
        const artistEl = document.getElementById('artist');
        const statusLabelEl = document.getElementById('status-label');
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
            const res = await fetch('/current-track');
            const data = await res.json();

            if (!data.active) {
              // STAN OFFLINE / BRAK DANYCH
              statusLabelEl.textContent = 'Offline / brak odtwarzania';
              titleEl.textContent = 'Nic nie gra';
              artistEl.textContent = 'Zaloguj się przez /login i włącz muzykę';
              coverImgEl.src = '';
              coverBoxEl.classList.remove('has-image');
              coverPlaceholderEl.style.display = 'block';
              progressFillEl.style.width = '0%';
              currentTimeEl.textContent = '0:00';
              totalTimeEl.textContent = '0:00';
              return;
            }

            // STAN ON – coś gra lub jest zapauzowane
            statusLabelEl.textContent = data.playing ? 'Playing' : 'Paused';
            titleEl.textContent = data.title || '';
            artistEl.textContent = data.artist || '';

            if (data.cover) {
              coverImgEl.src = data.cover;
              coverBoxEl.classList.add('has-image');
              coverPlaceholderEl.style.display = 'none';
            } else {
              coverImgEl.src = '';
              coverBoxEl.classList.remove('has-image');
              coverPlaceholderEl.style.display = 'block';
            }

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
