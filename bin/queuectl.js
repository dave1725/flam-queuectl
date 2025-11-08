#!/usr/bin/env node
const { Command } = require('commander');  
const { initializeDB, getDBConnection } = require('../dbHandler');
const chalk = require('chalk'); // chalk@4 supports CommonJS

const program = new Command(); 

/**
 * @notice banner for queueCTL CLI
 * @dev I made this myself through trial and error
 */

function printBanner() {
    // Use chalk if available for cross-platform color support (esp. Windows)
    let chalkCyan, chalkRedBright;
    try {
        chalkCyan = (s) => chalk.cyan(s);
        chalkRedBright = (s) => chalk.redBright(s);
    } catch (e) {
        // fallback to raw ANSI sequences
        chalkCyan = (s) => '\x1b[36m' + s + '\x1b[0m';
        chalkRedBright = (s) => '\x1b[91m' + s + '\x1b[0m';
    }
    const left = [
        '  --------   ----    ---- ------------ ----    ---- ------------',
        ' **********  ****    **** ************ ****    **** ************',
        '----    ---- ----    ---- ----         ----    ---- ----         ',
        '***      *** ****    **** ************ ****    **** ************ ',
        '---   --  -- ----    ---- ------------ ----    ---- ------------ ',
        '****   ** ** ************ ****         ************ ****         ',
        ' ------ -- - ------------ ------------ ------------ ------------ ',
        '  ******* ** ************ ************ ************ ************  ',
        '\t\t\t\t\t[[ Author: Dave Meshak J ]]',
        '\t\t\t\t\t[[ License: GPL-3.0      ]]',
    ];

    const right = [
        '------------ ------------ ----',
        '************ ************ ****',
        '---          ------------ ----         ',
        '***              ****     ****',
        '---              ----     ----         ',
        '***              ****     ************ ',
        '------------     ----     ------------ ',
        '************     ****     ************ ',
       
    ];

    const lines = Math.max(left.length, right.length);
    const leftWidth = Math.max(...left.map(l => l.length));

    const out = [];
    for (let i = 0; i < lines; i++) {
        const l = (left[i] || '').padEnd(leftWidth, ' ');
        const r = (right[i] || '');
        out.push(chalkCyan(l) + chalkRedBright(r));
    }

    console.log(out.join('\n'));
}
async function ensureDBInitialized() {
    try {
        await initializeDB(true);
    } catch (error) {
        console.error('[-] Database initialization failed:', error);
        process.exit(1);
    }
}

program
    .name('queueCTL')
    .description('CLI to manage the job queue system')
    .version('1.0.0'); 

program
    .command('init')
    .description('Initialize the job queue database')
    .option('--silent', 'suppress non-error output')
    .action(async (opts) => {
        try {
            await initializeDB()
            console.log('[+] Database initialization complete.');
            process.exit(0);
        } catch (err) {
            console.error('[-] Database initialization failed:', err);
            process.exit(1);
        }
    });


// Enqueue Command
program
    .command('enqueue')
    .description('Enqueue a new job. Pass job details as a JSON string.')
    .argument('<json>', 'Job details in JSON format (e.g., \'{"id":"job1", "command":"sleep 2"}\')')
    .action(async (jsonStr) => {
        let db;
        try {
            await ensureDBInitialized();
            db = await getDBConnection();

            const jobData = JSON.parse(jsonStr);
            if (!jobData.id || !jobData.command) {
                throw new Error("Job must have 'id' and 'command' fields.");
            }

            console.log(`Attempting to enqueue job: ${jsonStr}`);

            // Accept either `max_attempts` or `max_retries` from input (backwards-compatible)
            const max_attempts = jobData.max_attempts !== undefined
                ? jobData.max_attempts
                : (jobData.max_retries !== undefined ? jobData.max_retries : null);

            // Use COALESCE to fall back to the config key `default_max_tries` (this key is inserted during DB init).
            // Also provide a literal '3' default as a final fallback so we never insert NULL into the NOT NULL column.
            const insertSql = `INSERT INTO jobs (id, command, max_attempts, state, created_at, updated_at, next_run_at)
                 VALUES (?, ?, CAST(COALESCE(?, (SELECT value FROM config WHERE key='default_max_tries'), '3') AS INTEGER), 'pending', datetime('now'), datetime('now'), datetime('now'))`;

            await db.run(insertSql, jobData.id, jobData.command, max_attempts);

            console.log(`Successfully enqueued job '${jobData.id}'.`);
        } catch (e) {
            console.error("Error enqueuing job:", e.message);
        } finally {
            if (db) await db.close();
        }
    });


// List Command ---
program
    .command('list')
    .description('List jobs by state')
    .requiredOption('--state <state>', 'Filter by job state (pending, processing, completed, failed, dead)')
    .action(async (options) => {
        let db;
        try {
            await ensureDBInitialized();
            db = await getDBConnection();
            const rows = await db.all("SELECT * FROM jobs WHERE state = ?", options.state);
            if (rows.length === 0) {
                console.log(`No jobs found in state '${options.state}'.`);
            } else {
                console.table(rows);
            }
        } catch (e) {
            console.error("Error listing jobs:", e.message);
        } finally {
            if (db) await db.close();
        }
    });



printBanner();
program.parse(process.argv);

