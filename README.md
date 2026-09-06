<div align="center">
  <img src="https://disc-tools.de/static/assets/img/logo.png" alt="Disc-Tools Logo" width="80">
  <h1>Disc-Tools</h1>
  <p><strong>The ultimate collection of free Discord utilities</strong></p>
  <p>
    <a href="https://disc-tools.de">Website</a> •
    <a href="https://disc-tools.de/tools/">All Tools</a> •
    <a href="https://discord.gg/rtRs8rhj5u">Discord</a> •
    <a href="https://github.com/Disc-Tools/disc-tools.de">GitHub</a>
  </p>
</div>

## Overview

Disc-Tools is a web application providing free tools, guides and educational content for the Discord community. The frontend is built with vanilla HTML, CSS and JavaScript; the backend is a Node.js/Express API with PostgreSQL.

**Live at:** [disc-tools.de](https://disc-tools.de)

## Tools

Twelve utilities in three categories:

**Look things up**
- User Lookup — badges, account age and details for any user ID
- Username History — every past username and discriminator of an account
- Server Lookup — members, channels and invites via Discord's widget API
- Invite Lookup — guild info, member count, inviter and expiry of any invite
- Snowflake Decoder — creation date, worker, process and increment from any ID

**Create & format**
- Embed Builder — design embeds visually, export the ready JSON payload
- Markdown Generator — format messages with live preview and quick copy
- Timestamp Generator — all `<t:>` formats for any date and timezone
- Color Picker — role colors as HEX, RGB, HSL and integer values

**Manage & extract**
- Webhook Manager — send messages and delete webhooks without a bot
- Emoji Stealer — high-quality links for any emoji or sticker
- Avatar CDN — direct CDN links for any avatar, every size and format

> Tools launch progressively — new tools are announced on the site and in the Discord.

## Learn section

- **Guides** — step-by-step tutorials
- **Formatting Tips** — Discord markdown topics (bold, italic, code blocks, mentions, timestamps, …)
- **Shortcuts** — Discord keyboard shortcuts
- **Security Articles** — in-depth security content (phishing, token grabbers, account security)

## Pages

- **Team** — team members with roles from the Discord guild
- **Partners** — partner showcase + partner request system
- **Announcements** — site announcements
- **Premium** — premium subscription page
- **Profile** — user profile with linked accounts
- **GIFs** — community GIF gallery with upload and moderation
- **Legal** — privacy policy, terms of service, imprint
- **Status** — [status.disc-tools.de](https://status.disc-tools.de)

## Tech Stack

**Frontend**
- Vanilla HTML, CSS, JavaScript — no frameworks
- Self-hosted fonts (Inter) and Font Awesome icons
- Service worker for offline caching
- Open Graph / Twitter Cards / JSON-LD for rich embeds

**Backend**
- Node.js / Express 5
- PostgreSQL
- Discord OAuth2 with JWT sessions
- discord.js bot integration

## Project Structure

```
├── index.html                 # Home page
├── 404.html                   # Error page
├── about/                     # About page
├── admin/                     # OAuth-protected admin panel
├── announcements/             # Site announcements
├── api/                       # Express backend
│   ├── index.js               # Server entry point (port 3000)
│   ├── db.js                  # PostgreSQL connection pool
│   ├── middleware/            # Auth, CORS, rate limiting, VPN check
│   ├── routes/                # API route handlers
│   └── utils/                 # Discord, IP and Spotify helpers
├── blocked/                   # Banned / VPN blocked pages
├── gifs/                      # GIF gallery
├── guides/                    # Guides overview
├── learn/                     # Learn hub
├── legal/                     # Privacy policy, ToS, imprint
├── partner/                   # Partner showcase
├── premium/                   # Premium page
├── profile/                   # User profile
├── security-articles/         # Security content
├── success/                   # Post-login/logout pages
├── team/                      # Team page
├── tips/                      # Formatting + shortcuts
├── tools/                     # All tools grid
├── static/
│   ├── assets/img/            # Images and logos
│   ├── css/                   # Stylesheets
│   ├── fa-icons/              # Font Awesome
│   ├── fonts/                 # Self-hosted fonts
│   └── js/                    # Page scripts
├── sw.js                      # Service worker
├── sitemap.xml
└── robots.txt
```

## Getting Started

The frontend is fully static — serve the root directory with any static server:

```bash
git clone https://github.com/Disc-Tools/disc-tools.de.git
cd disc-tools.de
# e.g. with nginx, point `root` at this directory
```

**Backend:**

```bash
cd api
npm install
cp .env.example .env   # fill in your credentials
node index.js
```

### Environment Variables

The API reads its configuration from `api/.env`:

| Variable | Description |
|----------|-------------|
| `PORT` | API server port (default: 3000) |
| `HOST` | Bind address (default: 127.0.0.1) |
| `JWT_SECRET` | Secret for signing JWT tokens |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | Discord OAuth2 credentials |
| `DISCORD_REDIRECT_URI` | OAuth2 callback URL |
| `DISCORD_BOT_TOKEN` | Discord bot token |
| `GUILD_ID` | Discord guild ID |
| `DISCORD_INVITE` | Discord server invite link |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | PostgreSQL connection |
| `IP_HASH_SALT` | Salt for IP hashing |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` / `SPOTIFY_REDIRECT_URI` | Spotify OAuth |
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` / `TWITCH_REDIRECT_URI` | Twitch OAuth |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` / `GITHUB_REDIRECT_URI` | GitHub OAuth |
| `GIFS_INTERNAL_SECRET` | Internal secret for the GIFs service |

## Contributing

Contributions are welcome!

- Open an [issue](https://github.com/Disc-Tools/disc-tools.de/issues) for bugs or feature requests
- Submit a [pull request](https://github.com/Disc-Tools/disc-tools.de/pulls)
- Star the repo to show support

## License

This project is licensed under the [MIT License](LICENSE).

---

<div align="center">
  <p>Not affiliated with Discord Inc.</p>
</div>
