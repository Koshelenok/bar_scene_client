import React, { useState, useEffect } from 'react';
import * as signalR from '@microsoft/signalr';

function Chat() {
  const [connection, setConnection] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');

  // Подключение к серверу
  useEffect(() => {
    const newConnection = new signalR.HubConnectionBuilder()
      .withUrl('ws://localhost:5201/chatHub', { 
        skipNegotiation: true,
        transport: signalR.HttpTransportType.WebSockets
      })
      .withAutomaticReconnect()
      .build();
    // @ts-ignore
    setConnection(newConnection);
  }, []);

  // Обработка сообщений
  useEffect(() => {
    if (connection) {
      // @ts-ignore
      connection.start()
        .then(() => {
          console.log('Connected!');
          
          // Подписываемся на ReceiveMessage
          // @ts-ignore
          connection.on('ReceiveMessage', (user, message) => {
            // @ts-ignore
            setMessages(prev => [...prev, { user, message }]);
          });
        })
        // @ts-ignore
        .catch(e => console.log('Connection failed: ', e));
    }
  }, [connection]);

  const sendMessage = async () => {
    if (connection && input) {
      try {
        // @ts-ignore
        await connection.invoke('SendMessage', 'ReactUser #' + (Math.floor(Math.random() * 100000)), input);
        setInput('');
      } catch (e) {
        console.error(e);
      }
    }
  };

  return (
    <div>
      <h2>WebSocket Chat</h2>
      <input 
        value={input} 
        onChange={e => setInput(e.target.value)} 
        placeholder="Type message..."
      />
      <button onClick={sendMessage}>Send</button>
      
      <ul>
        {messages.map((msg, idx) => (
            // @ts-ignore
            <li key={idx}><b>{msg.user}:</b> {msg.message}</li>
        ))}
      </ul>
    </div>
  );
}

export default Chat;