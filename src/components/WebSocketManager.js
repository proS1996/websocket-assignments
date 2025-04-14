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
    connectionTime: null
  });
  const [connectionDetails, setConnectionDetails] = useState({
    protocol: '',
    url: '',
    timestamp: null
  });
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [offlineQueue, setOfflineQueue] = useState([]);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  
  const messagesEndRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const maxReconnectAttempts = 5;
  const reconnectDelay = 3000; // 3 seconds

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
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [isConnected, isReconnecting]);

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
        timestamp: new Date().toLocaleTimeString()
      });
      
      setConnectionStats(prev => ({
        ...prev,
        connectionTime: new Date().toLocaleTimeString()
      }));

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
      console.log('Received message:', event.data);
      setMessages(prev => [...prev, { text: event.data, type: 'received' }]);
      setConnectionStats(prev => ({
        ...prev,
        messagesReceived: prev.messagesReceived + 1
      }));
    };

    websocket.onclose = () => {
      console.log('Disconnected from WebSocket server');
      setIsConnected(false);
      setWs(null);
      
      // Attempt to reconnect if not manually closed and not offline
      if (navigator.onLine && reconnectAttempts < maxReconnectAttempts) {
        setReconnectAttempts(prev => prev + 1);
        setError(`Connection lost. Reconnecting (attempt ${reconnectAttempts + 1}/${maxReconnectAttempts})...`);
        
        reconnectTimeoutRef.current = setTimeout(() => {
          connectWebSocket();
        }, reconnectDelay);
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
  }, [reconnectAttempts, offlineQueue]);

  useEffect(() => {
    connectWebSocket();
    return () => {
      if (ws) {
        ws.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
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

  return (
    <div className="websocket-manager">
      <div className="connection-status">
        <h2>WebSocket Connection</h2>
        <div className={`status-indicator ${isConnected ? 'connected' : isReconnecting ? 'reconnecting' : 'disconnected'}`}>
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
        </div>
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