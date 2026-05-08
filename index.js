const path = require('path');
const { launchPersistentBrowser, DEFAULT_PROFILE } = require('./lib/browser');
const { createServer } = require('./lib/server');

const DEFAULT_PORT = 8765;
const DEFAULT_INTERVAL_MINUTES = 50;

function printHelp() {
  console.log([
    '',
    'M365 Copilot Relay',
    '',
    '  node index.js --headless       Off-screen relay (use start.cmd)',
    '  node index.js --no-headless    Visible browser (use debug.cmd for login)',
    '',
    'Options:',
    '  --port <n>         Relay port (default: ' + DEFAULT_PORT + ')',
    '  --profile <dir>    Browser profile dir (default: ./profile)',
    '  --headless          Run off-screen (hidden window)',
    '  --no-headless       Show browser window for interactive login',
    '  --interval <min>    Session keepalive refresh (default: ' + DEFAULT_INTERVAL_MINUTES + ')',
    '',
  ].join('\n'));
}

function parseArgs(argv) {
  const a = {
    profile: DEFAULT_PROFILE,
    relayPort: DEFAULT_PORT,
    headless: true,
    interval: DEFAULT_INTERVAL_MINUTES,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--port': a.relayPort = parseInt(argv[++i]) || DEFAULT_PORT; break;
      case '--profile': a.profile = argv[++i]; break;
      case '--headless': a.headless = true; break;
      case '--no-headless': a.headless = false; break;
      case '--interval': a.interval = parseInt(argv[++i]) || DEFAULT_INTERVAL_MINUTES; break;
      case '--help': case '-h': a.help = true; break;
    }
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); return; }

  console.log('M365 Copilot Relay');
  console.log('Profile: ' + args.profile);
  console.log('Mode: ' + (args.headless ? 'off-screen' : 'visible'));
  console.log('');

  const ctx = await launchPersistentBrowser(args.profile, args.headless);
  args.ctx = ctx;

  const wss = createServer(args);

  process.on('SIGINT', function() {
    console.log('\nShutting down...');
    wss.close();
    process.exit(0);
  });

  console.log('Relay: ws://127.0.0.1:' + args.relayPort);
  console.log('Waiting for WebSocket connections...\n');
}

if (require.main === module) {
  main().catch(function(err) {
    console.error('Fatal: ' + err.message);
    process.exit(1);
  });
}

module.exports = { parseArgs, printHelp };
