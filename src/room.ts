const ROOM_QUERY_PARAM = "room";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CryptoWithUuid = Crypto & { randomUUID?: () => string };

const randomBytes = (size: number): Uint8Array => {
  const bytes = new Uint8Array(size);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < size; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return bytes;
};

export const createUuid = (): string => {
  const cryptoApi = typeof crypto !== "undefined" ? (crypto as CryptoWithUuid) : undefined;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }

  // RFC 4122 v4 fallback for browsers without crypto.randomUUID.
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
};

/**
 * Room id comes from the `room` query param and must be a UUID.
 * When the param is missing or invalid, a random UUID is generated and
 * written back to the URL so the room can be shared and survives reloads.
 */
export const resolveRoomId = (): string => {
  const url = new URL(window.location.href);
  const roomFromUrl = url.searchParams.get(ROOM_QUERY_PARAM);

  if (roomFromUrl && UUID_RE.test(roomFromUrl)) {
    return roomFromUrl.toLowerCase();
  }

  const roomId = createUuid();
  url.searchParams.set(ROOM_QUERY_PARAM, roomId);
  window.history.replaceState(window.history.state, "", url.toString());
  return roomId;
};
