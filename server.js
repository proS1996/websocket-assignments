const WebSocket = require("ws");
const http = require("http");

// Create HTTP server
const server = http.createServer();
const wss = new WebSocket.Server({ server });

// Heartbeat interval (30 seconds)
const HEARTBEAT_INTERVAL = 30000;
// Timeout for client response (5 seconds)
const CLIENT_TIMEOUT = 5000;

// Store active connections
const clients = new Map();

wss.on("connection", (ws) => {
  console.log("New client connected");

  // Set up heartbeat
  let heartbeatInterval;
  let timeout;

  const setupHeartbeat = () => {
    // Send ping every HEARTBEAT_INTERVAL
    heartbeatInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
        // Set timeout for client response
        timeout = setTimeout(() => {
          console.log("Client timeout - no response to ping");
          ws.terminate();
        }, CLIENT_TIMEOUT);
      }
    }, HEARTBEAT_INTERVAL);
  };

  // Respond to pong
  ws.on("pong", () => {
    console.log("Received pong from client");
    clearTimeout(timeout);
  });

  // Handle messages
  ws.on("message", (message) => {
    console.log(`Received: ${message}`);
    ws.send(`Echo: ${message}`);
  });

  // Handle close
  ws.on("close", () => {
    console.log("Client disconnected");
    clearInterval(heartbeatInterval);
    clearTimeout(timeout);
    clients.delete(ws);
  });

  // Handle errors
  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
    clearInterval(heartbeatInterval);
    clearTimeout(timeout);
    clients.delete(ws);
  });

  // Start heartbeat
  setupHeartbeat();

  // Store the connection
  clients.set(ws, {
    heartbeatInterval,
    timeout
  });

  // Send welcome message
  ws.send("Connected to WebSocket server");
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
