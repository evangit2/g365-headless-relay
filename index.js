const path = require('path');
const { launchPersistentBrowser, DEFAULT_PROFILE } = require('./lib/browser');
const { createServer } = require('./lib/server');
const { startUiServer } = require('./lib/ui-server');

const DEFAULT_PORT = 8765;
const DEFAULT_INTERVAL_MINUTES = 50;

function printHelp() {
  console.log([
    '',
    'G365 M365 Copilot Relay — GPT 5.5 Think Deeper Edition',
    '',
    '  node index.js --headless       Off-screen relay (default)',
    '  node index.js --no-headless    Visible browser for login',
    '',
    'Options:',
    '  --port <n>         Relay WS port (default: ' + DEFAULT_PORT + ')',
    '  --ui-port <n>      Chat UI HTTP port (default: 3000)',
    '  --profile <dir>    Browser profile dir (default: ./profile)',
    '  --pool-size <n>    Pre-warmed page pool (default: 2)',
    '  --headless          Run off-screen (hidden window)',
    '  --no-headless       Show browser window for interactive login',
    '  --interval <min>    Session keepalive refresh (default: ' + DEFAULT_INTERVAL_MINUTES + ')',
    '  --no-ui             Don\'t start the chat UI server',
    '',
  ].join('\n'));
}

function parseArgs(argv) {
  const a = {
    profile: DEFAULT_PROFILE,
    relayPort: DEFAULT_PORT,
    uiPort: 3000,
    headless: true,
    interval: DEFAULT_INTERVAL_MINUTES,
    noUi: false,
    help: false,
    poolSize: 5, // default 5 warmed pages for instant connections
  };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--port': a.relayPort = parseInt(argv[++i]) || DEFAULT_PORT; break;
      case '--ui-port': a.uiPort = parseInt(argv[++i]) || 3000; break;
      case '--profile': a.profile = argv[++i]; break;
      case '--headless': a.headless = true; break;
      case '--no-headless': a.headless = false; break;
      case '--interval': a.interval = parseInt(argv[++i]) || DEFAULT_INTERVAL_MINUTES; break;
      case '--pool-size': a.poolSize = parseInt(argv[++i]) || 2; break;
      case '--no-ui': a.noUi = true; break;
      case '--help': case '-h': a.help = true; break;
    }
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); return; }

  console.log('╔═══════════════════════════════════════╗');
  console.log('║  G365 Copilot Relay                   ║');
  console.log('║  Default: GPT 5.5 Think Deeper        ║');
  console.log('╚═══════════════════════════════════════╝\n');
  console.log('Profile: ' + args.profile);
  console.log('Mode: ' + (args.headless ? 'off-screen' : 'visible'));
  console.log('');

  const ctx = await launchPersistentBrowser(args.profile, args.headless);
  args.ctx = ctx;

  const { wss, drain } = createServer(args);

  if (!args.noUi) {
    await startUiServer(args.uiPort);
  }

  process.on('SIGINT', function() {
    console.log('\nShutting down...');
    drain();
    wss.close();
    process.exit(0);
  });

  console.log('Relay WS: ws://127.0.0.1:' + args.relayPort);
  console.log('Waiting for connections...\n');
}

if (require.main === module) {
  main().catch(function(err) {
    console.error('Fatal: ' + err.message);
    process.exit(1);
  });
}

module.exports = { parseArgs, printHelp };
