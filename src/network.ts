export type Position = [number, number, number];

/**
 * The server hub is a plain relay: it forwards whatever string it gets to
 * every connected client. Rooms are therefore separated on the client side by
 * filtering messages by `room`.
 */
export type PresenceKind = "join" | "hello" | "presence" | "position";

export type PresenceMessage = {
  v: typeof PROTOCOL_VERSION;
  room: string;
  kind: PresenceKind;
  position: Position;
};

export type OfferMessage = {
  v: typeof PROTOCOL_VERSION;
  room: string;
  kind: "webrtc-offer" | "webrtc-answer";
  to: string;
  description: RTCSessionDescriptionInit;
};

export type IceMessage = {
  v: typeof PROTOCOL_VERSION;
  room: string;
  kind: "webrtc-ice";
  to: string;
  candidate: RTCIceCandidateInit;
};

export type SignalMessage = OfferMessage | IceMessage;
export type RoomMessage = PresenceMessage | SignalMessage;

/** A signal message without the envelope fields, as built by the sender. */
export type OutgoingSignal =
  | { kind: "webrtc-offer" | "webrtc-answer"; to: string; description: RTCSessionDescriptionInit }
  | { kind: "webrtc-ice"; to: string; candidate: RTCIceCandidateInit };

export const PROTOCOL_VERSION = 1;

const isPosition = (value: unknown): value is Position =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every(item => typeof item === "number" && Number.isFinite(item));

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const isPresenceMessage = (message: RoomMessage): message is PresenceMessage =>
  message.kind === "join" ||
  message.kind === "hello" ||
  message.kind === "presence" ||
  message.kind === "position";

export const isSignalMessage = (message: RoomMessage): message is SignalMessage =>
  !isPresenceMessage(message);

export const parseRoomMessage = (raw: string): RoomMessage | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isObject(parsed)) return null;
  if (parsed.v !== PROTOCOL_VERSION) return null;
  if (typeof parsed.room !== "string" || !parsed.room) return null;

  if (
    parsed.kind === "join" ||
    parsed.kind === "hello" ||
    parsed.kind === "presence" ||
    parsed.kind === "position"
  ) {
    if (!isPosition(parsed.position)) return null;
    return parsed as PresenceMessage;
  }

  if (parsed.kind === "webrtc-offer" || parsed.kind === "webrtc-answer") {
    if (typeof parsed.to !== "string" || !parsed.to) return null;
    if (!isObject(parsed.description)) return null;
    if (typeof parsed.description.type !== "string") return null;
    return parsed as OfferMessage;
  }

  if (parsed.kind === "webrtc-ice") {
    if (typeof parsed.to !== "string" || !parsed.to) return null;
    if (!isObject(parsed.candidate)) return null;
    return parsed as IceMessage;
  }

  return null;
};
