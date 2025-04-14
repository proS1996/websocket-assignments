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

// Error handling middleware
const handleError = (error, ws) => {
  console.error("WebSocket error:", error);
  if (ws) {
    const clientData = clients.get(ws);
    if (clientData) {
      clearInterval(clientData.heartbeatInterval);
      clearTimeout(clientData.timeout);
      clients.delete(ws);
    }
    try {
      ws.close();
    } catch (e) {
      console.error("Error closing connection:", e);
    }
  }
};

wss.on("connection", (ws) => {
  console.log("New client connected");

  // Set up heartbeat
  let heartbeatInterval;
  let timeout;

  const setupHeartbeat = () => {
    // Send ping every HEARTBEAT_INTERVAL
    heartbeatInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.ping();
          // Set timeout for client response
          timeout = setTimeout(() => {
            console.log("Client timeout - no response to ping");
            handleError(new Error("Client timeout"), ws);
          }, CLIENT_TIMEOUT);
        } catch (error) {
          handleError(error, ws);
        }
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
    try {
      console.log(`Received: ${message}`);
      ws.send(`Echo: ${message}`);
    } catch (error) {
      handleError(error, ws);
    }
  });

  // Handle close
  ws.on("close", () => {
    console.log("Client disconnected");
    const clientData = clients.get(ws);
    if (clientData) {
      clearInterval(clientData.heartbeatInterval);
      clearTimeout(clientData.timeout);
      clients.delete(ws);
    }
  });

  // Handle errors
  ws.on("error", (error) => {
    handleError(error, ws);
  });

  // Start heartbeat
  setupHeartbeat();

  // Store the connection
  clients.set(ws, {
    heartbeatInterval,
    timeout
  });

  // Send welcome message
  try {
    ws.send("Connected to WebSocket server");
  } catch (error) {
    handleError(error, ws);
  }
});

// Handle server errors
server.on("error", (error) => {
  console.error("Server error:", error);
});

// Handle server shutdown gracefully
const shutdown = () => {
  console.log("Shutting down server...");

  // Close all WebSocket connections
  wss.clients.forEach((client) => {
    try {
      client.close(1000, "Server shutting down");
    } catch (error) {
      console.error("Error closing client connection:", error);
    }
  });

  // Close the server
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });

  // Force shutdown after 5 seconds
  setTimeout(() => {
    console.error(
      "Could not close connections in time, forcefully shutting down"
    );
    process.exit(1);
  }, 5000);
};

// Handle process termination
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
