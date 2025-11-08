#!/usr/bin/env node

const { Command } = require('commander');  
const { initializeDatabase } = require('../dbHandler');

const program = new Command(); 

/**
 * @notice banner for queueCTL CLI
 * @dev I made this myself through trial and error
 */

function printBanner() {
    // Use chalk if available for cross-platform color support (esp. Windows)
    let chalkCyan, chalkRedBright;
    try {
        const chalk = require('chalk'); // chalk@4 supports CommonJS
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
            await initializeDatabase ? initializeDatabase(opts.silent) : require('./dbHandler').initializeDB(opts.silent);
            console.log('[+] Database initialization complete.');
            process.exit(0);
        } catch (err) {
            console.error('[-] Database initialization failed:', err);
            process.exit(1);
        }
    });


printBanner();
program.parse(process.argv);

