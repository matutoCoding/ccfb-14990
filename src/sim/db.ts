// IndexedDB 工艺档案仓储：作品全部配置与打磨记录持久化
import type { Project } from './types.ts'

const DB_NAME = 'xipi-studio'
const DB_VERSION = 1
const STORE = 'projects'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('updatedAt', 'updatedAt')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode)
        const request = run(transaction.objectStore(STORE))
        request.onsuccess = () => {
          transaction.oncomplete = () => {
            db.close()
            resolve(request.result)
          }
        }
        request.onerror = () => {
          db.close()
          reject(request.error)
        }
      })
  )
}

export const projectRepo = {
  async list(): Promise<Project[]> {
    const all = await tx('readonly', (store) => store.getAll() as IDBRequest<Project[]>)
    return all.sort((a, b) => b.updatedAt - a.updatedAt)
  },

  async get(id: string): Promise<Project | undefined> {
    return tx('readonly', (store) => store.get(id) as IDBRequest<Project | undefined>)
  },

  async put(project: Project): Promise<void> {
    project.updatedAt = Date.now()
    await tx('readwrite', (store) => store.put(project))
  },

  async remove(id: string): Promise<void> {
    await tx('readwrite', (store) => store.delete(id))
  },

  async count(): Promise<number> {
    return tx('readonly', (store) => store.count())
  }
}
