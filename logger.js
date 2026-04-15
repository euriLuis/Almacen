const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB before rotation

// Ensure logs directory exists
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Rotate log file if it exceeds MAX_FILE_SIZE
 */
function rotateLogFile() {
    if (fs.existsSync(LOG_FILE)) {
        const stats = fs.statSync(LOG_FILE);
        if (stats.size > MAX_FILE_SIZE) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const rotatedFile = path.join(LOG_DIR, `app-${timestamp}.log`);
            fs.renameSync(LOG_FILE, rotatedFile);
            writeLog('INFO', 'SYSTEM', `Log file rotated to ${rotatedFile}`);
        }
    }
}

/**
 * Format log entry
 */
function formatLogEntry(level, context, message) {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level}] [${context}] ${message}`;
}

/**
 * Write log entry to file
 */
function writeLog(level, context, message) {
    rotateLogFile();
    const entry = formatLogEntry(level, context, message) + '\n';
    fs.appendFileSync(LOG_FILE, entry, 'utf8');
}

/**
 * Log a request with details
 */
function request(method, url, body = null) {
    const msg = body ? `${method} ${url} - Body: ${JSON.stringify(body)}` : `${method} ${url}`;
    console.log(`📥 ${msg}`);
    writeLog('REQUEST', `${method}`, msg);
}

/**
 * Log a successful response
 */
function response(method, url, statusCode, duration = null) {
    const emoji = statusCode >= 200 && statusCode < 300 ? '✅' :
                  statusCode >= 400 && statusCode < 500 ? '⚠️' : '❌';
    const msg = `${emoji} ${method} ${url} - ${statusCode}${duration ? ` (${duration}ms)` : ''}`;
    console.log(msg);
    writeLog('RESPONSE', `${method} ${statusCode}`, msg);
}

/**
 * Log an error with context
 */
function error(context, message, details = null) {
    const fullMsg = message;
    if (details) {
        fullMsg += details instanceof Error ?
            ` | Stack: ${details.stack}` :
            ` | Details: ${JSON.stringify(details)}`;
    }
    console.error(`❌ [${context}] ${fullMsg}`);
    writeLog('ERROR', context, fullMsg);
}

/**
 * Log an action/mutation for audit trail
 */
function action(context, description, data = null) {
    const msg = data ? `${description} | Data: ${JSON.stringify(data)}` : description;
    console.log(`📝 [${context}] ${description}`);
    writeLog('ACTION', context, msg);
}

/**
 * Log a warning
 */
function warn(context, message, details = null) {
    const fullMsg = message;
    if (details) {
        fullMsg += ` | Details: ${JSON.stringify(details)}`;
    }
    console.warn(`⚠️ [${context}] ${fullMsg}`);
    writeLog('WARN', context, fullMsg);
}

/**
 * Log database operations
 */
function db(action, details) {
    const msg = `${action} | ${details}`;
    writeLog('DB', action, msg);
}

module.exports = {
    request,
    response,
    error,
    action,
    warn,
    db,
    LOG_FILE,
    LOG_DIR
};
