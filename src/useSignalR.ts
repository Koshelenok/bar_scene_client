import { useState, useEffect } from 'react';
import * as signalR from '@microsoft/signalr';

const HUB_URL = process.env.REACT_APP_HUB_URL ?? 'ws://localhost:5201/chatHub';

export function useSignalR(): signalR.HubConnection | null {
  const [connection, setConnection] = useState<signalR.HubConnection | null>(null);

  useEffect(() => {
    const conn = new signalR.HubConnectionBuilder()
      .withUrl(HUB_URL, {
        skipNegotiation: true,
        transport: signalR.HttpTransportType.WebSockets,
      })
      .withAutomaticReconnect()
      .build();
    setConnection(conn);
  }, []);

  useEffect(() => {
    if (!connection) return;
    connection.start().catch(e => console.error('Connection failed:', e));
    return () => { connection.stop(); };
  }, [connection]);

  return connection;
}
