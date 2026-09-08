/**
 * C-9: Offline Sync — IndexedDB queue for offline edits
 * When offline, writes are queued and replayed when connection restores.
 */

const DB_NAME    = "prowosma_offline";
const DB_VERSION = 1;
const STORE_NAME = "pending_requests";

let db = null;

async function openDB() {
  if (db) return db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(STORE_NAME)) {
        const store = d.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
        store.createIndex("timestamp", "timestamp");
      }
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror   = () => reject(req.error);
  });
}

export async function queueRequest(method, url, data) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = database.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req   = store.add({ method, url, data, timestamp: Date.now() });
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

export async function getPendingRequests() {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = database.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req   = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

export async function deletePendingRequest(id) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = database.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req   = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

/**
 * Replay all queued offline requests when connection restores.
 * Called by useOnlineStatus hook.
 */
export async function replayQueue(clientInstance) {
  const pending = await getPendingRequests();
  if (pending.length === 0) return 0;

  let replayed = 0;
  for (const item of pending) {
    try {
      await clientInstance.request({
        method: item.method,
        url:    item.url,
        data:   item.data,
      });
      await deletePendingRequest(item.id);
      replayed++;
    } catch (e) {
      console.warn("[OfflineSync] Failed to replay:", item.url, e.message);
    }
  }
  return replayed;
}

/**
 * Hook: monitors online/offline state and replays queue on reconnect.
 */
export function useOnlineStatus(clientInstance) {
  const [online, setOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const goOnline = async () => {
      setOnline(true);
      const replayed = await replayQueue(clientInstance);
      if (replayed > 0) {
        console.log(`[OfflineSync] Replayed ${replayed} queued requests`);
      }
      getPendingRequests().then(p => setPendingCount(p.length));
    };
    const goOffline = () => setOnline(false);

    window.addEventListener("online",  goOnline);
    window.addEventListener("offline", goOffline);
    getPendingRequests().then(p => setPendingCount(p.length));

    return () => {
      window.removeEventListener("online",  goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [clientInstance]);

  return { online, pendingCount };
}

// Need useState for the hook
import { useState, useEffect } from "react";
