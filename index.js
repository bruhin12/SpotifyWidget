const express = require('express');
const cors = require('cors');
const SpotifyWebApi = require('spotify-web-api-node');
const path = require('path');

console.log('Plik index.js się uruchomił');

const app = express();
app.use(cors());

const port = 8888;

// WKLEJ SWOJE DANE Z DASHBOARDU SPOTIFY:
const spotifyApi = new SpotifyWebApi({
  clientId: '6c2384e5a0a94eab9e9f85d60a58ea1a',
  clientSecret: '84af2d7c281a40df8ce83e59f1d9ee0b',
  redirectUri: 'http://127.0.0.1:8888/callback'
});

// 1. Logowanie do Spotify
app.get('/login', (req, res) => {
  const scopes = ['user-read-currently-playing', 'user-read-playback-state'];
  const authorizeURL = spotifyApi.createAuthorizeURL(scopes, 'some-state');
  res.redirect(authorizeURL);
});

// 2. Callback po logowaniu
app.get('/callback', async (req, res) => {
  const code = req.query.code || null;
  try {
    const data = await spotifyApi.authorizationCodeGrant(code);
    spotifyApi.setAccessToken(data.body['access_token']);
    spotifyApi.setRefreshToken(data.body['refresh_token']);
    res.send('Zalogowano do Spotify. Możesz zamknąć to okno i odpalić stream.');
  } catch (err) {
    console.error('Błąd w /callback:', err);
    res.status(500).send('Błąd logowania.');
  }
});

// 3. Odświeżanie tokena
async function ensureAccessToken() {
  try {
    const data = await spotifyApi.refreshAccessToken();
    spotifyApi.setAccessToken(data.body['access_token']);
  } catch (err) {
    console.error('Błąd odświeżania tokena', err);
  }
}

// 4. Endpoint z aktualnie graną piosenką
app.get('/current-track', async (req, res) => {
  try {
    const playback = await spotifyApi.getMyCurrentPlaybackState();

    // brak playbacku / brak utworu -> nic nie pokazujemy
    if (!playback.body || !playback.body.item) {
      return res.json({ active: false });
    }

    const item = playback.body.item;

    res.json({
      active: true,                              // jest jakiś utwór
      playing: playback.body.is_playing,         // true = gra, false = pauza
      title: item.name,
      artist: item.artists.map(a => a.name).join(', '),
      album: item.album.name,
      cover: item.album.images?.[0]?.url || null,
      progress_ms: playback.body.progress_ms ?? 0,
      duration_ms: item.duration_ms ?? 0
    });

  } catch (err) {
    console.error('Błąd w /current-track:', err);
    await ensureAccessToken();
    res.status(500).json({ error: 'Error fetching track' });
  }
});


// 5. Widget: kompaktowa karta, tytuł/wykonawca wyśrodkowane nad paskiem
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
        * {
          box-sizing: border-box;
        }

        body {
          margin: 0;
          padding: 0;
          font-family: "Rajdhani", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          background: transparent;
          color: #ffffff;
        }

        /* Mała, zbita karta, szerokość = treść */
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
          box-shadow:
            0 10px 24px rgba(0,0,0,0.8),
            0 0 10px rgba(0,0,0,0.6);

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

        /* Okładka */
        .cover {
          width: 70px;
          height: 70px;
          border-radius: 18px;
          overflow: hidden;
          flex-shrink: 0;
          box-shadow:
            0 8px 18px rgba(0,0,0,0.8),
            0 0 8px rgba(0,0,0,0.7);
        }

        .cover img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        /* Prawa strona – blok wyśrodkowany */
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

        /* Szerokość wspólna dla tytułu, artysty i paska */
        .info-inner {
          width: 180px;
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .title {
          font-size: 18px;              /* trochę większy */
          font-weight: 700;
          letter-spacing: 0.01em;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          text-align: center;           /* wyśrodkowany nad paskiem */
          text-shadow:
            0 1px 3px rgba(0,0,0,0.9),
            0 0 6px rgba(0,0,0,0.7);
        }

        .artist {
          font-size: 13px;              /* trochę większy */
          font-weight: 500;
          opacity: 0.9;
          margin-top: 1px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          text-align: center;           /* wyśrodkowany nad paskiem */
          text-shadow:
            0 1px 3px rgba(0,0,0,0.9),
            0 0 6px rgba(0,0,0,0.7);
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
            const res = await fetch('http://127.0.0.1:8888/current-track');
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



app.listen(port, () => {
  console.log(`Server działa na: http://127.0.0.1:${port}`);
  console.log(`Wejdź w przeglądarce na: http://127.0.0.1:${port}/login`);
});
