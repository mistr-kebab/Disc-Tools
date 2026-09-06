const express = require('express');
const axios = require('axios');
const router = express.Router();

const USER_AGENT = 'Disc-Tools/1.0';
const TIMEOUT = 10000;

const apiClient = axios.create({
    timeout: TIMEOUT,
    headers: { 'User-Agent': USER_AGENT }
});

router.get('/discord-status', async (req, res) => {
    try {
        const response = await apiClient.get('https://discordstatus.com/api/v2/summary.json');
        res.json(response.data);
    } catch (err) {
        res.status(502).json({ error: 'Failed to fetch Discord status' });
    }
});

router.get('/discord-gateway', async (req, res) => {
    try {
        const response = await apiClient.get('https://discord.com/api/v9/gateway');
        res.json(response.data);
    } catch (err) {
        res.status(502).json({ error: 'Failed to fetch Discord gateway' });
    }
});

router.get('/guild-widget/:guildId', async (req, res) => {
    const { guildId } = req.params;
    if (!/^\d{17,20}$/.test(guildId)) {
        return res.status(400).json({ error: 'Invalid Guild ID' });
    }
    try {
        const response = await apiClient.get(`https://discord.com/api/v10/guilds/${guildId}/widget.json`);
        res.status(response.status).json(response.data);
    } catch (err) {
        if (err.response) {
            return res.status(err.response.status).json(err.response.data);
        }
        res.status(502).json({ error: 'Failed to fetch guild widget' });
    }
});

router.get('/invite/:code', async (req, res) => {
    const { code } = req.params;
    if (!code || code.length < 1 || code.length > 20) {
        return res.status(400).json({ error: 'Invalid invite code' });
    }
    try {
        const response = await apiClient.get(
            `https://discord.com/api/v10/invites/${encodeURIComponent(code)}?with_counts=true&with_expiration=true`
        );
        res.status(response.status).json(response.data);
    } catch (err) {
        if (err.response) {
            return res.status(err.response.status).json(err.response.data);
        }
        res.status(502).json({ error: 'Failed to fetch invite' });
    }
});

module.exports = router;
