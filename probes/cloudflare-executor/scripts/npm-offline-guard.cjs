const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const tls = require('node:tls');
const dgram = require('node:dgram');
const dns = require('node:dns');
const { syncBuiltinESMExports } = require('node:module');

function deny() {
  process.stderr.write('{"_tag":"OfflineNetworkDenied"}\n');
  process.exit(76);
}
http.request = http.get = https.request = https.get = deny;
net.connect = net.createConnection = net.Socket.prototype.connect = tls.connect = deny;
dgram.createSocket = deny;
for (const key of ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'reverse']) {
  dns[key] = dns.promises[key] = deny;
}
syncBuiltinESMExports();
