import { useState, useEffect } from 'react';
import * as signalR from '@microsoft/signalr';

const HUB_URL = process.env.REACT_APP_HUB_URL ?? 'ws://localhost:5201/chatHub';

type SignalRState = {
  connection: signalR.HubConnection | null;
  isConnected: boolean;
};

export function useSignalR(): SignalRState {
  const [connection, setConnection] = useState<signalR.HubConnection | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const conn = new signalR.HubConnectionBuilder()
      .withUrl(HUB_URL, {
        skipNegotiation: true,
        transport: signalR.HttpTransportType.WebSockets,
      })
      .withAutomaticReconnect()
      .build();

    conn.onreconnecting(() => setIsConnected(false));
    conn.onreconnected(() => setIsConnected(true));
    conn.onclose(() => setIsConnected(false));

    setConnection(conn);
  }, []);

  useEffect(() => {
    if (!connection) return;
    let cancelled = false;

    connection.start()
      .then(() => { if (!cancelled) setIsConnected(true); })
      .catch(e => console.error('Connection failed:', e));

    return () => {
      cancelled = true;
      setIsConnected(false);
      connection.stop();
    };
  }, [connection]);

  return { connection, isConnected };
}
