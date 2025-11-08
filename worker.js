const { getDBConnection } = require('./dbHandler.js');
const { exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');

const execPromise = util.promisify(exec);
const STOP_FILE = path.resolve(process.cwd(), '.stop_workers');

let isShuttingDown = false;

async function registerWorker(db) {
    try {
        await db.run(
            `INSERT OR REPLACE INTO workers (pid, hostname, started_at, last_heartbeat)
             VALUES (?, ?, datetime('now'), datetime('now'))`,
            process.pid, os.hostname()
        );
    } catch (e) { console.error("Heartbeat register failed:", e.message); }
}

async function sendHeartbeat(db) {
    try {
        await db.run("UPDATE workers SET last_heartbeat = datetime('now') WHERE pid = ?", process.pid);
    } catch (e) { /* ignore */ }
}

async function unregisterWorker() {
    let db;
    try {
        db = await getDBConnection();
        await db.run("DELETE FROM workers WHERE pid = ?", process.pid);
    } catch (e) { /* ignore */ } finally { if (db) await db.close(); }
}

async function getConfigValue(db, key, defaultValue) {
    try {
        const result = await db.get("SELECT value FROM config WHERE key = ?", key);
        if (!result) return defaultValue;
        const intVal = parseInt(result.value, 10);
        return isNaN(intVal) ? result.value : intVal;
    } catch (e) { return defaultValue; }
}

async function handleJobFailure(db, job, errorMessage) {
    const newAttempts = job.attempts + 1;
    if (newAttempts >= job.max_retries) {
        console.log(`Job '${job.id}' failed max retries. Moving to DLQ.`);
        await db.run(`UPDATE jobs SET state = 'dead', last_error = ?, updated_at = datetime('now') WHERE id = ?`, errorMessage, job.id);
    } else {
        const backoffBase = await getConfigValue(db, 'backoff_base', 2);
        const delaySeconds = Math.pow(backoffBase, newAttempts);
        console.log(`Job '${job.id}' failed. Retrying in ${delaySeconds}s (Attempt ${newAttempts}).`);
        await db.run(
            `UPDATE jobs SET state = 'pending', attempts = ?, last_error = ?, next_run_time = datetime('now', '+' || ? || ' seconds'), updated_at = datetime('now') WHERE id = ?`,
            newAttempts, errorMessage, delaySeconds, job.id
        );
    }
}

async function startWorker() {
    console.log(`Worker [${process.pid}] starting...`);
    process.on('SIGINT', () => { isShuttingDown = true; });
    process.on('SIGTERM', () => { isShuttingDown = true; });

    let lastHeartbeatTime = 0;

    while (!isShuttingDown) {
        if (fs.existsSync(STOP_FILE)) { console.log("Stop file detected. Shutting down..."); break; }

        let db;
        let job = null;

        try {
            db = await getDBConnection();

            const now = Date.now();
            if (now - lastHeartbeatTime > 5000) {
                if (lastHeartbeatTime === 0) await registerWorker(db);
                else await sendHeartbeat(db);
                lastHeartbeatTime = now;
            }

            await db.exec("BEGIN IMMEDIATE");
            const jobRow = await db.get(`SELECT id FROM jobs WHERE state = 'pending' AND next_run_time <= datetime('now') ORDER BY created_at ASC LIMIT 1`);
            if (jobRow) {
                await db.run("UPDATE jobs SET state = 'processing', updated_at = datetime('now') WHERE id = ?", jobRow.id);
                await db.exec("COMMIT");
                job = await db.get("SELECT * FROM jobs WHERE id = ?", jobRow.id);
            } else {
                await db.exec("COMMIT");
            }
        } catch (e) {
            if (e.code !== 'SQLITE_BUSY') console.error(`Error polling: ${e.message}`);
            if (db) try { await db.exec("ROLLBACK"); } catch (e) {}
        }
        
        if (job) {
            try {
                // NEW: Get configured timeout
                const timeoutMs = await getConfigValue(db, 'job_timeout_ms', 30000);
                console.log(`Worker [${process.pid}] executing job '${job.id}' (timeout: ${timeoutMs}ms): ${job.command}`);
                
                // NEW: Use configured timeout
                const { stdout } = await execPromise(job.command, { timeout: timeoutMs });
                
                console.log(`Job '${job.id}' completed.`);
                await db.run("UPDATE jobs SET state = 'completed', updated_at = datetime('now'), last_error = NULL WHERE id = ?", job.id);
            } catch (error) {
                // Handle timeout specifically for better error messages
                let errorMessage = error.stderr || error.message || "Unknown error";
                if (error.killed && error.signal === 'SIGTERM') {
                     errorMessage = `Job timed out after ${await getConfigValue(db, 'job_timeout_ms', 30000)}ms`;
                }
                console.log(`Job '${job.id}' failed: ${errorMessage}`);
                await handleJobFailure(db, job, errorMessage);
            }
        } else {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        if (db) try { await db.close(); } catch (e) {}
    }
    await unregisterWorker();
    console.log(`Worker [${process.pid}] shutdown complete.`);
    process.exit(0);
}

if (require.main === module) {
    startWorker().catch(err => { console.error("FATAL:", err); process.exit(1); });
}