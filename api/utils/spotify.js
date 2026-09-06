const axios = require('axios');

/**
 * Get currently playing track from Spotify
 * @param {string} refreshToken - Spotify refresh token
 * @returns {Promise} Spotify track data or null
 */
async function getSpotifyCurrentlyListening(refreshToken) {
    const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
    const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

    if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET || !refreshToken) return null;

    try {
        // Get Access Token
        const tokenRes = await axios.post('https://accounts.spotify.com/api/token', new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken
        }), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64')
            }
        });

        const accessToken = tokenRes.data.access_token;

        // Get Current Track
        const trackRes = await axios.get('https://api.spotify.com/v1/me/player/currently-playing', {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (trackRes.status === 204 || !trackRes.data || !trackRes.data.is_playing) {
            return { isPlaying: false };
        }

        const track = trackRes.data.item;
        const progressMs = Math.max(0, Number(trackRes.data.progress_ms) || 0);
        const durationMs = Math.max(0, Number(track.duration_ms) || 0);

        return {
            isPlaying: true,
            title: track.name,
            artist: track.artists.map(a => a.name).join(', '),
            album: track.album.name,
            albumArt: track.album.images[0]?.url,
            url: track.external_urls.spotify,
            progressMs,
            durationMs
        };
    } catch (err) {
        console.error('[SPOTIFY] Fetch failed:', err.response?.data || err.message);
        return null;
    }
}

/**
 * Normalize Spotify embed URL
 * @param {string} url - Spotify URL
 * @returns {string} Normalized embed URL
 */
function normalizeSpotifyEmbedUrl(url) {
    if (!url || typeof url !== 'string') return '';
    url = url.trim();

    const uriTrackMatch = url.match(/^spotify:track:([A-Za-z0-9]+)$/);
    if (uriTrackMatch) return `https://open.spotify.com/embed/track/${uriTrackMatch[1]}`;

    const trackMatch = url.match(/^https?:\/\/open\.spotify\.com\/(?:embed\/)?track\/([A-Za-z0-9]+)(?:[/?].*)?$/);
    if (trackMatch) return `https://open.spotify.com/embed/track/${trackMatch[1]}`;

    const albumMatch = url.match(/^https?:\/\/open\.spotify\.com\/(?:embed\/)?album\/([A-Za-z0-9]+)(?:[/?].*)?$/);
    if (albumMatch) return `https://open.spotify.com/embed/album/${albumMatch[1]}`;

    const playlistMatch = url.match(/^https?:\/\/open\.spotify\.com\/(?:embed\/)?playlist\/([A-Za-z0-9]+)(?:[/?].*)?$/);
    if (playlistMatch) return `https://open.spotify.com/embed/playlist/${playlistMatch[1]}`;

    return url;
}

/**
 * Normalize SoundCloud embed URL
 * @param {string} url - SoundCloud URL
 * @returns {string} Normalized embed URL
 */
function normalizeSoundcloudEmbedUrl(url) {
    if (!url || typeof url !== 'string') return '';
    url = url.trim();

    if (url.includes('soundcloud.com')) {
        if (url.includes('w.soundcloud.com/player')) {
            return url;
        }
        return `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&color=%23ff5500&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false&visual=false`;
    }
    return '';
}

module.exports = {
    getSpotifyCurrentlyListening,
    normalizeSpotifyEmbedUrl,
    normalizeSoundcloudEmbedUrl
};
