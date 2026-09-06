const crypto = require('crypto');

if (!process.env.IP_HASH_SALT) {
    console.error('[FATAL] IP_HASH_SALT is not set. Cannot secure IP hashing. Exiting.');
    process.exit(1);
}
const IP_SALT = process.env.IP_HASH_SALT;

function hashIP(ip) {
    return crypto.createHmac('sha256', IP_SALT).update(ip).digest('hex');
}

function hashIPLegacy(ip) {
    return crypto.createHash('sha256').update(ip).digest('hex');
}

module.exports = { hashIP, hashIPLegacy };
