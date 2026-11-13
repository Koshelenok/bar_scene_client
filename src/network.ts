export type Position = [number, number, number];

/**
 * The server hub is a plain relay: it forwards whatever string it gets to
 * every connected client. Rooms are therefore separated on the client side by
 * filtering messages by `room`.
 */
export type RoomMessageKind = "hello" | "presence" | "position";

export type RoomMessage = {
  v: typeof PROTOCOL_VERSION;
  room: string;
  kind: RoomMessageKind;
  position: Position;
};

export const PROTOCOL_VERSION = 1;

const isPosition = (value: unknown): value is Position =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every(item => typeof item === "number" && Number.isFinite(item));

export const parseRoomMessage = (raw: string): RoomMessage | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;

  const message = parsed as Partial<RoomMessage>;
  if (message.v !== PROTOCOL_VERSION) return null;
  if (typeof message.room !== "string" || !message.room) return null;
  if (message.kind !== "hello" && message.kind !== "presence" && message.kind !== "position") return null;
  if (!isPosition(message.position)) return null;

  return message as RoomMessage;
};
