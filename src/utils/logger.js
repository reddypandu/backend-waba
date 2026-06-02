import fs from fs; export const logToFile = (msg) => { fs.appendFileSync(webhook_debug.log, new Date().toISOString() +  -  + msg + \n); };
