import React, { useState, useEffect, useCallback, useRef } from 'react';
import './WebSocketManager.css';

const WebSocketManager = () => {
  const [ws, setWs] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [error, setError] = useState(null);
  const [connectionStats, setConnectionStats] = useState({
    messagesSent: 0,
    messagesReceived: 0,
    lastPingTime: null,
    connectionTime: null,
    reconnectAttempts: 0,
    totalReconnects: 0,
    heartbeatStats: {
      sent: 0,
      received: 0,
      failed: 0,
      avgLatency: 0,
      lastLatency: 0
    }
  });
  const [connectionDetails, setConnectionDetails] = useState({
    protocol: '',
    url: '',
    timestamp: null,
    latency: null
  });
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [offlineQueue, setOfflineQueue] = useState([]);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [connectionHealth, setConnectionHealth] = useState('good'); // good, fair, poor
  const [heartbeatInterval, setHeartbeatInterval] = useState(30000); // 30 seconds
  
  const messagesEndRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const pingTimeoutRef = useRef(null);
  const healthCheckIntervalRef = useRef(null);
  const heartbeatHistoryRef = useRef([]);
  
  const maxReconnectAttempts = 10;
  const initialReconnectDelay = 1000; // 1 second
  const maxReconnectDelay = 30000; // 30 seconds
  const initialHeartbeatInterval = 30000; // 30 seconds
  const minHeartbeatInterval = 10000; // 10 seconds
  const maxHeartbeatInterval = 60000; // 60 seconds
  const pingTimeout = 5000; // 5 seconds
  const heartbeatHistorySize = 10; // Keep track of last 10 heartbeats

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Handle online/offline status
  useEffect(() => {
    const handleOnline = () => {
      console.log('Browser is online');
      setIsOnline(true);
      if (!isConnected && !isReconnecting) {
        connectWebSocket();
      }
    };

    const handleOffline = () => {
      console.log('Browser is offline');
      setIsOnline(false);
      setError('You are offline. Messages will be queued.');
      clearAllTimers();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [isConnected, isReconnecting]);

  const clearAllTimers = () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (pingTimeoutRef.current) {
      clearTimeout(pingTimeoutRef.current);
      pingTimeoutRef.current = null;
    }
    if (healthCheckIntervalRef.current) {
      clearInterval(healthCheckIntervalRef.current);
      healthCheckIntervalRef.current = null;
    }
  };

  const calculateReconnectDelay = () => {
    // Exponential backoff with jitter
    const exponentialDelay = Math.min(
      initialReconnectDelay * Math.pow(2, reconnectAttempts),
      maxReconnectDelay
    );
    // Add jitter (±20%) to prevent thundering herd problem
    const jitter = exponentialDelay * 0.2 * (Math.random() * 2 - 1);
    return Math.max(1000, exponentialDelay + jitter);
  };

  const updateHeartbeatInterval = (latency) => {
    // Adjust heartbeat interval based on latency
    // If latency is good, we can reduce frequency
    // If latency is poor, we should increase frequency
    let newInterval = heartbeatInterval;
    
    if (latency < 100) {
      // Good latency, can reduce frequency
      newInterval = Math.min(heartbeatInterval * 1.2, maxHeartbeatInterval);
    } else if (latency > 500) {
      // Poor latency, increase frequency
      newInterval = Math.max(heartbeatInterval * 0.8, minHeartbeatInterval);
    }
    
    // Only update if there's a significant change
    if (Math.abs(newInterval - heartbeatInterval) > 5000) {
      console.log(`Adjusting heartbeat interval from ${heartbeatInterval}ms to ${newInterval}ms`);
      setHeartbeatInterval(newInterval);
      
      // Restart the health check with the new interval
      if (healthCheckIntervalRef.current) {
        clearInterval(healthCheckIntervalRef.current);
        startHealthCheck();
      }
    }
  };

  const startHealthCheck = () => {
    if (healthCheckIntervalRef.current) {
      clearInterval(healthCheckIntervalRef.current);
    }

    healthCheckIntervalRef.current = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        const startTime = Date.now();
        
        // Send ping
        ws.send(JSON.stringify({ type: 'ping', timestamp: startTime }));
        
        // Update stats
        setConnectionStats(prev => ({
          ...prev,
          heartbeatStats: {
            ...prev.heartbeatStats,
            sent: prev.heartbeatStats.sent + 1
          }
        }));
        
        // Set timeout for pong response
        if (pingTimeoutRef.current) {
          clearTimeout(pingTimeoutRef.current);
        }
        
        pingTimeoutRef.current = setTimeout(() => {
          console.log('Ping timeout - connection may be unstable');
          setConnectionHealth('poor');
          setError('Connection health check failed. Reconnecting...');
          
          // Update stats
          setConnectionStats(prev => ({
            ...prev,
            heartbeatStats: {
              ...prev.heartbeatStats,
              failed: prev.heartbeatStats.failed + 1
            }
          }));
          
          // Add to history
          heartbeatHistoryRef.current.push({
            timestamp: new Date(),
            success: false,
            latency: null
          });
          
          // Trim history if needed
          if (heartbeatHistoryRef.current.length > heartbeatHistorySize) {
            heartbeatHistoryRef.current.shift();
          }
          
          ws.close();
        }, pingTimeout);
      }
    }, heartbeatInterval);
  };

  const handlePong = (latency) => {
    if (pingTimeoutRef.current) {
      clearTimeout(pingTimeoutRef.current);
    }
    
    // Update connection health based on latency
    if (latency < 100) {
      setConnectionHealth('good');
    } else if (latency < 500) {
      setConnectionHealth('fair');
    } else {
      setConnectionHealth('poor');
    }
    
    // Update connection details
    setConnectionDetails(prev => ({
      ...prev,
      latency: `${latency}ms`
    }));
    
    // Update heartbeat stats
    setConnectionStats(prev => {
      const newStats = {
        ...prev,
        heartbeatStats: {
          ...prev.heartbeatStats,
          received: prev.heartbeatStats.received + 1,
          lastLatency: latency,
          avgLatency: (prev.heartbeatStats.avgLatency * prev.heartbeatStats.received + latency) / 
                      (prev.heartbeatStats.received + 1)
        }
      };
      
      // Add to history
      heartbeatHistoryRef.current.push({
        timestamp: new Date(),
        success: true,
        latency: latency
      });
      
      // Trim history if needed
      if (heartbeatHistoryRef.current.length > heartbeatHistorySize) {
        heartbeatHistoryRef.current.shift();
      }
      
      return newStats;
    });
    
    // Adjust heartbeat interval based on latency
    updateHeartbeatInterval(latency);
  };

  const connectWebSocket = useCallback(() => {
    if (!navigator.onLine) {
      setError('Cannot connect: You are offline');
      return;
    }

    setIsReconnecting(true);
    const websocket = new WebSocket('ws://localhost:8080');

    websocket.onopen = () => {
      console.log('Connected to WebSocket server');
      setIsConnected(true);
      setError(null);
      setIsReconnecting(false);
      setReconnectAttempts(0);
      
      setConnectionDetails({
        protocol: websocket.protocol || 'No protocol',
        url: websocket.url,
        timestamp: new Date().toLocaleTimeString(),
        latency: null
      });
      
      setConnectionStats(prev => ({
        ...prev,
        connectionTime: new Date().toLocaleTimeString(),
        reconnectAttempts: 0,
        heartbeatStats: {
          sent: 0,
          received: 0,
          failed: 0,
          avgLatency: 0,
          lastLatency: 0
        }
      }));

      // Reset heartbeat interval to initial value
      setHeartbeatInterval(initialHeartbeatInterval);
      
      // Clear heartbeat history
      heartbeatHistoryRef.current = [];

      // Start health check
      startHealthCheck();

      // Process any queued messages
      if (offlineQueue.length > 0) {
        console.log(`Processing ${offlineQueue.length} queued messages`);
        offlineQueue.forEach(message => {
          websocket.send(message);
          setMessages(prev => [...prev, { text: message, type: 'sent' }]);
          setConnectionStats(prev => ({
            ...prev,
            messagesSent: prev.messagesSent + 1
          }));
        });
        setOfflineQueue([]);
      }
    };

    websocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'pong') {
          const latency = Date.now() - data.timestamp;
          handlePong(latency);
        } else {
          console.log('Received message:', event.data);
          setMessages(prev => [...prev, { text: event.data, type: 'received' }]);
          setConnectionStats(prev => ({
            ...prev,
            messagesReceived: prev.messagesReceived + 1
          }));
        }
      } catch (e) {
        // Not JSON, treat as regular message
        console.log('Received message:', event.data);
        setMessages(prev => [...prev, { text: event.data, type: 'received' }]);
        setConnectionStats(prev => ({
          ...prev,
          messagesReceived: prev.messagesReceived + 1
        }));
      }
    };

    websocket.onclose = (event) => {
      console.log('Disconnected from WebSocket server', event.code, event.reason);
      setIsConnected(false);
      setWs(null);
      
      // Clear health check interval
      if (healthCheckIntervalRef.current) {
        clearInterval(healthCheckIntervalRef.current);
        healthCheckIntervalRef.current = null;
      }
      
      // Attempt to reconnect if not manually closed and not offline
      if (navigator.onLine && reconnectAttempts < maxReconnectAttempts) {
        const newAttempts = reconnectAttempts + 1;
        setReconnectAttempts(newAttempts);
        setConnectionStats(prev => ({
          ...prev,
          reconnectAttempts: newAttempts,
          totalReconnects: prev.totalReconnects + 1
        }));
        
        const delay = calculateReconnectDelay();
        setError(`Connection lost. Reconnecting in ${Math.round(delay/1000)}s (attempt ${newAttempts}/${maxReconnectAttempts})...`);
        
        reconnectTimeoutRef.current = setTimeout(() => {
          connectWebSocket();
        }, delay);
      } else if (reconnectAttempts >= maxReconnectAttempts) {
        setError('Maximum reconnection attempts reached. Please try again later.');
        setIsReconnecting(false);
      }
    };

    websocket.onerror = (error) => {
      console.error('WebSocket error:', error);
      setError('Connection error occurred');
      setIsConnected(false);
    };

    setWs(websocket);
  }, [reconnectAttempts, offlineQueue, heartbeatInterval]);

  useEffect(() => {
    connectWebSocket();
    return () => {
      clearAllTimers();
      if (ws) {
        ws.close();
      }
    };
  }, [connectWebSocket]);

  const sendMessage = () => {
    if (!inputMessage.trim()) return;
    
    if (ws && ws.readyState === WebSocket.OPEN) {
      // Send immediately if connected
      ws.send(inputMessage);
      setMessages(prev => [...prev, { text: inputMessage, type: 'sent' }]);
      setConnectionStats(prev => ({
        ...prev,
        messagesSent: prev.messagesSent + 1
      }));
    } else {
      // Queue message if offline or disconnected
      setOfflineQueue(prev => [...prev, inputMessage]);
      setMessages(prev => [...prev, { 
        text: `${inputMessage} (queued - will send when connected)`, 
        type: 'queued' 
      }]);
    }
    
    setInputMessage('');
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      sendMessage();
    }
  };

  const formatTime = (date) => {
    return date ? new Date(date).toLocaleTimeString() : 'N/A';
  };

  const getConnectionStatus = () => {
    if (!navigator.onLine) return 'Offline';
    if (isReconnecting) return 'Reconnecting...';
    if (isConnected) return 'Connected';
    return 'Disconnected';
  };

  const getConnectionHealthClass = () => {
    if (!isConnected) return '';
    return `health-${connectionHealth}`;
  };

  const handleManualReconnect = () => {
    if (ws) {
      ws.close();
    }
    setReconnectAttempts(0);
    connectWebSocket();
  };

  const getHeartbeatSuccessRate = () => {
    const stats = connectionStats.heartbeatStats;
    if (stats.sent === 0) return 0;
    return Math.round((stats.received / stats.sent) * 100);
  };

  return (
    <div className="websocket-manager">
      <div className="connection-status">
        <h2>WebSocket Connection</h2>
        <div className={`status-indicator ${isConnected ? 'connected' : isReconnecting ? 'reconnecting' : 'disconnected'} ${getConnectionHealthClass()}`}>
          {getConnectionStatus()}
        </div>
        {error && <div className="error-message">{error}</div>}
        
        <div className="connection-details">
          <div className="detail-item">
            <span className="detail-label">Protocol:</span>
            <span className="detail-value">{connectionDetails.protocol}</span>
          </div>
          <div className="detail-item">
            <span className="detail-label">URL:</span>
            <span className="detail-value">{connectionDetails.url}</span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Connected at:</span>
            <span className="detail-value">{connectionDetails.timestamp || 'N/A'}</span>
          </div>
          {connectionDetails.latency && (
            <div className="detail-item">
              <span className="detail-label">Latency:</span>
              <span className="detail-value">{connectionDetails.latency}</span>
            </div>
          )}
        </div>

        <div className="connection-stats">
          <div className="stat-item">
            <span className="stat-label">Messages Sent:</span>
            <span className="stat-value">{connectionStats.messagesSent}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Messages Received:</span>
            <span className="stat-value">{connectionStats.messagesReceived}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Queued Messages:</span>
            <span className="stat-value">{offlineQueue.length}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Reconnection Attempts:</span>
            <span className="stat-value">{connectionStats.reconnectAttempts}</span>
          </div>
        </div>
        
        <div className="heartbeat-stats">
          <h3>Heartbeat Statistics</h3>
          <div className="heartbeat-grid">
            <div className="heartbeat-item">
              <span className="heartbeat-label">Interval:</span>
              <span className="heartbeat-value">{Math.round(heartbeatInterval / 1000)}s</span>
            </div>
            <div className="heartbeat-item">
              <span className="heartbeat-label">Success Rate:</span>
              <span className="heartbeat-value">{getHeartbeatSuccessRate()}%</span>
            </div>
            <div className="heartbeat-item">
              <span className="heartbeat-label">Avg Latency:</span>
              <span className="heartbeat-value">{Math.round(connectionStats.heartbeatStats.avgLatency)}ms</span>
            </div>
            <div className="heartbeat-item">
              <span className="heartbeat-label">Last Latency:</span>
              <span className="heartbeat-value">{connectionStats.heartbeatStats.lastLatency}ms</span>
            </div>
          </div>
        </div>
        
        {!isConnected && !isReconnecting && (
          <button 
            className="reconnect-button"
            onClick={handleManualReconnect}
            disabled={!navigator.onLine}
          >
            Reconnect Now
          </button>
        )}
      </div>

      <div className="message-container">
        <div className="messages">
          {messages.map((message, index) => (
            <div key={index} className={`message ${message.type}`}>
              {message.text}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="input-container">
        <input
          type="text"
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder={isConnected ? "Type a message..." : "Message will be queued..."}
          disabled={!navigator.onLine}
        />
        <button
          onClick={sendMessage}
          disabled={!inputMessage.trim() || !navigator.onLine}
        >
          Send
        </button>
      </div>
    </div>
  );
};

export default WebSocketManager; 