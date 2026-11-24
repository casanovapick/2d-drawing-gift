const CACHE_NAME = 'kawaii-gachapon-offline-v2';

const VOICE_FILES = [
  'd_0', 'd_1', 'd_2', 'd_3', 'd_4', 'd_5', 'd_6', 'd_7', 'd_8', 'd_9',
  'u_et', 'u_sip', 'u_yisip', 'u_roi',
  'w_mailaek', 'w_kha', 'w_bai', 'w_luk',
  'voice_on',
  'pour_a1', 'pour_a2', 'pour_b1', 'pour_b2',
  'few_last', 'few_n1', 'few_n2',
  'crank_1', 'crank_2', 'crank_3', 'crank_4',
  'wait_1', 'wait_2', 'rev_pre_1', 'rev_pre_2', 'rev_pre_3', 'rev_pre_4',
  'wait_3', 'rev_rep',
  'rev_out_1', 'rev_out_2', 'rev_out_3', 'rev_out_4',
  'ret_1', 'ret_2',
  'fin_1', 'fin_2',
  'poke_setup', 'poke_done', 'poke_1', 'poke_2', 'poke_3',
  'poke_lat_1', 'poke_lat_2', 'poke_lat_3',
].map((k) => `./assets/voice/${k}.mp3`);

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/styles/main.css',
  './src/main.js',
  './src/state/gameStore.js',
  './src/audio/soundEngine.js',
  './src/audio/offlineVoiceClips.js',
  './src/audio/mascotVoice.js',
  './src/components/gachaponMachine.js',
  './src/components/chibiMascot.js',
  './src/components/confettiOverlay.js',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/mascot/idle_closed.webp',
  './assets/mascot/talk_open.webp',
  './assets/mascot/starry_closed.webp',
  './assets/mascot/starry_open.webp',
  './assets/mascot/cheering_closed.webp',
  './assets/mascot/cheering_open.webp',
  ...VOICE_FILES,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response && response.status === 200 && event.request.url.startsWith(self.location.origin)) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html') || caches.match('./');
          }
          return undefined;
        });
    })
  );
});
