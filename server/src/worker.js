/**
 * Stand-alone background worker: delay timers and deadline monitoring.
 * Use it when the API runs on several servers (set RUN_BACKGROUND_JOBS=false on them).
 * Running more than one worker is safe too: a database lock lets only one work at a time.
 */
require('dotenv').config();
const startSlaMonitor = require('./cron/slaMonitor');

startSlaMonitor();
