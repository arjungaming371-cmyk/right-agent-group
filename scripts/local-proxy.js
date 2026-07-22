// local-proxy.js — unifies the website (3000) and voicebot WebSocket (3002)
// behind ONE local port, so a single tunnel (this free ngrok account only
// allows one public hostname at a time — a second simultaneous tunnel
// silently collided with the first instead of erroring) can expose both.
// Same routing as nginx.conf's VPS config, just reimplemented with Node's
// built-in http/net instead of requiring nginx to be installed locally.
//
// Usage: node scripts/local-proxy.js [port]   (default port 3005)
// Route:  /voicebot* -> 127.0.0.1:3002 (raw pipe, handles the WS upgrade)
//         everything else -> 127.0.0.1:3000

const http = require("http")
const net = require("net")

const PORT = parseInt(process.argv[2] || "3005", 10)
const WEB_PORT = 3000
const VOICEBOT_PORT = 3002

function targetPort(url) {
  return url && url.startsWith("/voicebot") ? VOICEBOT_PORT : WEB_PORT
}

const server = http.createServer((req, res) => {
  const port = targetPort(req.url)
  const proxyReq = http.request(
    { host: "127.0.0.1", port, path: req.url, method: req.method, headers: req.headers },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers)
      proxyRes.pipe(res)
    }
  )
  proxyReq.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end("proxy error") })
  req.pipe(proxyReq)
})

// Raw socket pipe for the WebSocket upgrade handshake — simplest way to
// forward WS traffic without depending on the `ws` package understanding
// the frame protocol itself; the target server does that.
server.on("upgrade", (req, clientSocket, head) => {
  const port = targetPort(req.url)
  const proxySocket = net.connect(port, "127.0.0.1", () => {
    const headerLines = [`${req.method} ${req.url} HTTP/1.1`]
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      headerLines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`)
    }
    proxySocket.write(headerLines.join("\r\n") + "\r\n\r\n")
    if (head && head.length) proxySocket.write(head)
    clientSocket.pipe(proxySocket)
    proxySocket.pipe(clientSocket)
  })
  proxySocket.on("error", () => clientSocket.destroy())
  clientSocket.on("error", () => proxySocket.destroy())
})

server.listen(PORT, () => {
  console.log(`local-proxy: :${PORT} -> /voicebot* to :${VOICEBOT_PORT}, else :${WEB_PORT}`)
})
