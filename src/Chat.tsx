import { useState, useEffect, useCallback } from 'react';
import { useSignalR } from './useSignalR';

type Message = { user: string; message: string };

const chatUserId = `ReactUser #${Math.floor(Math.random() * 100000)}`;

function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const connection = useSignalR();

  const onMessage = useCallback((user: string, message: string) => {
    setMessages(prev => [...prev, { user, message }]);
  }, []);

  useEffect(() => {
    if (!connection) return;
    connection.on('ReceiveMessage', onMessage);
    return () => connection.off('ReceiveMessage', onMessage);
  }, [connection, onMessage]);

  const sendMessage = async () => {
    if (!connection || !input) return;
    try {
      await connection.invoke('SendMessage', chatUserId, input);
      setInput('');
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div>
      <h2>WebSocket Chat</h2>
      <input value={input} onChange={e => setInput(e.target.value)} placeholder="Type message..." />
      <button onClick={sendMessage}>Send</button>
      <ul>
        {messages.map((msg, idx) => (
          <li key={`${msg.user}-${idx}`}><b>{msg.user}:</b> {msg.message}</li>
        ))}
      </ul>
    </div>
  );
}

export default Chat;
