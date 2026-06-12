const WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:8765');
let state = 'connecting';
let fullText = '';
let startTime = Date.now();

ws.on('open', () => {
  console.log('CONNECTED at', Date.now() - startTime, 'ms');
  ws.send(JSON.stringify({type:'new', model:'gpt-5.5-think-deeper'}));
});

ws.on('message', (d) => {
  try {
    const msg = JSON.parse(d.toString());
    if (msg.type === 'ready') {
      console.log('READY at', Date.now() - startTime, 'ms');
      state = 'ready';
      ws.send(JSON.stringify({type:'chat', text:'Say hello and confirm what model you are'}));
      console.log('SENT at', Date.now() - startTime, 'ms');
    }
    if (msg.type === 'sent') { console.log('ACK at', Date.now() - startTime, 'ms'); }
    if (msg.type === 'delta') {
      process.stdout.write(msg.text);
      fullText += msg.text;
    }
    if (msg.type === 'message') {
      console.log('\nMESSAGE at', Date.now() - startTime, 'ms');
      fullText = msg.text;
    }
    if (msg.type === 'done') {
      console.log('\nDONE at', Date.now() - startTime, 'ms');
      console.log('\n--- FULL TEXT ---');
      console.log(fullText);
      ws.close();
    }
    if (msg.type === 'error') {
      console.log('ERROR:', msg.message);
      if (msg.code === 'AUTH_REQUIRED') ws.close();
    }
  } catch(e) { console.log('PARSE ERROR:', e.message); }
});

ws.on('error', (e) => console.log('WS ERROR:', e.message));
ws.on('close', (c) => { console.log('CLOSED:', c); process.exit(0); });

setTimeout(() => { console.log('\nTIMEOUT after', Date.now() - startTime); ws.close(); }, 55000);
