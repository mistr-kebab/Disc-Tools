const cors = require('cors');

const allowedOrigins = ["https://admin.disc-tools.de", 'https://disc-tools.de', 'https://www.disc-tools.de', 'https://api.disc-tools.de', 'https://dash.disc-tools.de'];

const corsOptions = {
    origin: (origin, callback) => {
        if (!origin) {
            return callback(null, true);
        }
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        console.warn(`[SECURITY] Blocked CORS request from: ${origin}`);
        callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
};

module.exports = cors(corsOptions);
