import type { Position } from "./network";

const DB_NAME = "bar_scene";
const DB_VERSION = 1;
const STORE_NAME = "rooms";

/** Saved rooms older than this are removed by `pruneStaleRooms`. */
export const ROOM_TTL_MS = 60 * 60 * 1000;

type RoomRecord = {
  roomId: string;
  position: Position;
  createdAt: number;
  updatedAt: number;
};

let dbPromise: Promise<IDBDatabase> | null = null;

const isPosition = (value: unknown): value is Position =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every(item => typeof item === "number" && Number.isFinite(item));

const openDb = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "roomId" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
};

const withStore = async <T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
  fallback: T
): Promise<T> => {
  if (typeof indexedDB === "undefined") return fallback;

  try {
    const db = await openDb();
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const request = action(transaction.objectStore(STORE_NAME));

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch (e) {
    console.warn("IndexedDB error", e);
    return fallback;
  }
};

/** Last known position of this user in the given room. */
export const loadRoomPosition = async (roomId: string): Promise<Position | null> => {
  const record = await withStore<RoomRecord | undefined>(
    "readonly",
    store => store.get(roomId),
    undefined
  );

  if (!record || !isPosition(record.position)) return null;

  // Do not restore a room that has already outlived its TTL, even if the
  // background prune has not deleted it yet.
  const createdAt = typeof record.createdAt === "number" ? record.createdAt : 0;
  return Date.now() - createdAt > ROOM_TTL_MS ? null : record.position;
};

/**
 * Upserts the position for a room. `createdAt` is preserved on updates so the
 * room still expires an hour after it was first added.
 */
export const saveRoomPosition = async (roomId: string, position: Position): Promise<void> => {
  if (typeof indexedDB === "undefined") return;

  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(roomId);

      request.onsuccess = () => {
        const existing = request.result as RoomRecord | undefined;
        const now = Date.now();
        const record: RoomRecord = {
          roomId,
          position: [...position] as Position,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };
        store.put(record);
      };

      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
  } catch (e) {
    console.warn("Failed to save room position", e);
  }
};

/** Deletes rooms that were added more than `ROOM_TTL_MS` ago. Returns the count. */
export const pruneStaleRooms = async (now = Date.now()): Promise<number> => {
  if (typeof indexedDB === "undefined") return 0;

  try {
    const db = await openDb();

    return await new Promise<number>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.openCursor();
      let removed = 0;

      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;

        const record = cursor.value as Partial<RoomRecord>;
        const createdAt = typeof record.createdAt === "number" ? record.createdAt : 0;

        if (now - createdAt > ROOM_TTL_MS) {
          cursor.delete();
          removed += 1;
        }

        cursor.continue();
      };

      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve(removed);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch (e) {
    console.warn("Failed to prune stale rooms", e);
    return 0;
  }
};
