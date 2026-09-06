const { Pool } = require('pg');
const dotenv = require('dotenv');

dotenv.config();

const pool = new Pool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
    statement_timeout: 5000
});

pool.on('error', (err) => {
    console.error('[DB] Pool error on idle client:', err.message);
});

let queryCount = 0;

async function query(text, params) {
    const start = Date.now();
    queryCount++;
    const qid = queryCount;

    try {
        const res = await pool.query(text, params);
        const duration = Date.now() - start;
        if (duration > 1000) {
            console.warn(`[DB] Slow query #${qid} (${duration}ms): ${text.slice(0, 120)}`);
        } else {
            console.log(`[DB] Query #${qid} done in ${duration}ms`);
        }
        return res;
    } catch (error) {
        const duration = Date.now() - start;
        const isTimeout = error.message.includes('timeout');
        const isConnection = error.message.includes('connect') || error.message.includes('Connection');
        const level = isTimeout || isConnection ? 'error' : 'warn';

        console[level](`[DB] Query #${qid} failed after ${duration}ms:`, error.message);

        if (isConnection) {
            console.error('[DB] Connection lost – attempting to recover...');
        }

        throw error;
    }
}

async function getClient() {
    try {
        const client = await pool.connect();
        return client;
    } catch (error) {
        console.error('[DB] Failed to acquire client from pool:', error.message);
        throw error;
    }
}

async function healthCheck() {
    try {
        await pool.query('SELECT 1');
        return true;
    } catch {
        return false;
    }
}

module.exports = {
    query,
    getClient,
    pool,
    healthCheck
};
