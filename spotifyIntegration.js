// spotifyIntegration.js

// 1. Модул за автентикация (Authorization Code с PKCE)
const SpotifyAuth = (() => {
    const CLIENT_ID = '415ea275561548f0b7ae309c0bd57463';
    const REDIRECT_URI = 'http://127.0.0.1:5500/';
    const SCOPES = ['user-modify-playback-state'].join(' ');

    const generateRandomString = (length) => {
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        const values = crypto.getRandomValues(new Uint8Array(length));
        return values.reduce((acc, x) => acc + possible[x % possible.length], "");
    };

    const sha256 = async (plain) => {
        const encoder = new TextEncoder();
        const data = encoder.encode(plain);
        return window.crypto.subtle.digest('SHA-256', data);
    };

    const base64encode = (input) => {
        return btoa(String.fromCharCode(...new Uint8Array(input)))
            .replace(/=/g, '')
            .replace(/\+/g, '-')
            .replace(/\//g, '_');
    };

    const login = async () => {
        const codeVerifier = generateRandomString(64);
        window.localStorage.setItem('code_verifier', codeVerifier);

        const hashed = await sha256(codeVerifier);
        const codeChallenge = base64encode(hashed);

        const authUrl = new URL('https://accounts.spotify.com/authorize');
        authUrl.searchParams.append('client_id', CLIENT_ID);
        authUrl.searchParams.append('response_type', 'code'); // вече е 'code'
        authUrl.searchParams.append('redirect_uri', REDIRECT_URI);
        authUrl.searchParams.append('scope', SCOPES);
        authUrl.searchParams.append('code_challenge_method', 'S256');
        authUrl.searchParams.append('code_challenge', codeChallenge);

        // Пренасочваме браузъра
        window.location.href = authUrl.toString();
    };

    const getToken = async (code) => {
        const codeVerifier = localStorage.getItem('code_verifier');

        try {
            const body = await fetch('https://accounts.spotify.com/api/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    client_id: CLIENT_ID,
                    grant_type: 'authorization_code',
                    code: code,
                    redirect_uri: REDIRECT_URI,
                    code_verifier: codeVerifier,
                })
            });

            const response = await body.json();

            if (response.access_token) {
                localStorage.setItem('spotify_access_token', response.access_token);
                return response.access_token;
            }
        } catch (e) {
            console.error(e);
        }
        return null;
    };

    const initAuth = async () => {
        const urlParams = new URLSearchParams(window.location.search);
        let code = urlParams.get('code');

        if (code) {
            let token = await getToken(code);
            window.history.replaceState(null, null, window.location.pathname);
            return token;
        }

        return localStorage.getItem('spotify_access_token');
    };

    return {
        login,
        initAuth
    };
})();

// 2. Модул за управление на Spotify (API Calls)
const SpotifyController = (() => {
    const nextTrack = async (accessToken) => {
        if (!accessToken) {
            console.error('Липсва Access Token!');
            return;
        }

        try {
            const response = await fetch('https://api.spotify.com/v1/me/player/next', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok || response.status === 204) {
                console.log('Песента беше успешно превключена!');
            } else if (response.status === 403) {
                console.warn('Нямате права, или потребителят не е Premium.');
            } else if (response.status === 404) {
                console.warn('Няма активно Spotify устройство. Отвори Spotify някъде.');
            } else {
                const errorData = await response.json();
                console.error('Грешка при превключване:', errorData);
            }
        } catch (error) {
            console.error('Мрежовка грешка:', error);
        }
    };

    const pauseTrack = async (accessToken) => {
        if (!accessToken) return;
        try {
            const response = await fetch('https://api.spotify.com/v1/me/player/pause', {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            if (response.ok || response.status === 204) {
                console.log('Песента е на пауза!');
            }
        } catch (error) {
            console.error(error);
        }
    };

    const playTrack = async (accessToken) => {
        if (!accessToken) return;
        try {
            const response = await fetch('https://api.spotify.com/v1/me/player/play', {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            if (response.ok || response.status === 204) {
                console.log('Песента е пусната отново!');
            }
        } catch (error) {
            console.error(error);
        }
    };

    const previousTrack = async (accessToken) => {
        if (!accessToken) return;
        try {
            const response = await fetch('https://api.spotify.com/v1/me/player/previous', {
                method: 'POST', // Съобразно документацията на Spotify
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            if (response.ok || response.status === 204) {
                console.log('Върната предишна песен!');
            }
        } catch (error) {
            console.error(error);
        }
    };

    return {
        nextTrack,
        pauseTrack,
        playTrack,
        previousTrack
    };
})();

// 3. Интеграция 
let currentAccessToken = null;

async function bootstrapSpotify() {
    currentAccessToken = await SpotifyAuth.initAuth();
    // Уведомяваме интерфейса, че сме готови (ще го хванем в index.html)
    if (typeof window.onSpotifyReady === 'function') {
        window.onSpotifyReady(currentAccessToken);
    }
}

// Стартираме инициализацията едва когато страницата (и index.html) е напълно заредена!
document.addEventListener('DOMContentLoaded', bootstrapSpotify);

function proceedToLogin() {
    SpotifyAuth.login();
}

let canSwipe = true;
const COOLDOWN_MS = 2000;

let isMusicPaused = false; // Локален маркер (променлива), за да знаем дали сме спрели песента или я пускаме отново

function onFrameUpdate(gesture) {
    if (canSwipe) {
        if (gesture === 'RIGHT') {
            console.log('Засечен жест НАДЯСНО! Превключваме...');
            canSwipe = false;
            if (currentAccessToken) SpotifyController.nextTrack(currentAccessToken);
            setTimeout(() => { canSwipe = true; }, COOLDOWN_MS);
        }
        else if (gesture === 'LEFT') {
            console.log('Засечен жест НАЛЯВО! Превключваме...');
            canSwipe = false;
            if (currentAccessToken) SpotifyController.previousTrack(currentAccessToken);
            setTimeout(() => { canSwipe = true; }, COOLDOWN_MS);
        }
        else if (gesture === 'OPEN_PALM') {
            canSwipe = false; // Блокираме следващи жестове

            if (currentAccessToken) {
                if (!isMusicPaused) {
                    console.log('Засечена отворена длан! ПАУЗА...');
                    SpotifyController.pauseTrack(currentAccessToken);
                    isMusicPaused = true;
                } else {
                    console.log('Засечена отворена длан отново! ПУСКАНЕ (Play)...');
                    SpotifyController.playTrack(currentAccessToken);
                    isMusicPaused = false;
                }
            }
            // Заключваме камерата за точно 5 секунди преди да приеме нов жест на отворена длан (или посочване)!
            setTimeout(() => { canSwipe = true; }, 1500);
        }
    }
}
