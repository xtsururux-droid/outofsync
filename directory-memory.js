/**
 * directory-memory.js - 按资源类型持久化「上次使用的文件夹」(FileSystemDirectoryHandle)
 * 需 https / localhost；file:// 下会静默失败并回退为仅 showOpenFilePicker 的 id。
 */
const DirectoryMemory = {
    DB_NAME: 'storyengine_directory_memory',
    STORE: 'handles',
    DB_VERSION: 1,
    DEFAULT_PROJECT_ROOT_PATH: 'E:\\gaa\\games\\BU',

    /** 项目根目录（含 assets 写入权限），用于把资源落到磁盘、避免 localStorage 爆满 */
    PROJECT_ROOT_KEY: 'storyengine-project-root',
    activeProjectKey: '',
    activeProjectKeys: [],

    _dbPromise: null,
    _nativeProjectRootHandle: null,

    _getNativeFs() {
        try {
            if (typeof require !== 'function') return null;
            return require('fs');
        } catch {
            return null;
        }
    },

    _getNativePath() {
        try {
            if (typeof require !== 'function') return null;
            return require('path');
        } catch {
            return null;
        }
    },

    _makeNativeFileHandle(filePath, name) {
        const fs = this._getNativeFs();
        if (!fs) return null;
        return {
            kind: 'file',
            name,
            async getFile() {
                const bytes = await fs.promises.readFile(filePath);
                return new File([bytes], name);
            },
            async createWritable() {
                const chunks = [];
                return {
                    async write(data) {
                        if (data instanceof ArrayBuffer) chunks.push(Buffer.from(data));
                        else if (ArrayBuffer.isView(data)) chunks.push(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
                        else if (data && data.arrayBuffer) chunks.push(Buffer.from(await data.arrayBuffer()));
                        else chunks.push(Buffer.from(String(data)));
                    },
                    async close() {
                        await fs.promises.writeFile(filePath, Buffer.concat(chunks));
                    }
                };
            }
        };
    },

    _makeNativeDirectoryHandle(dirPath) {
        const fs = this._getNativeFs();
        const path = this._getNativePath();
        if (!fs || !path) return null;
        const self = this;
        return {
            kind: 'directory',
            name: path.basename(dirPath),
            nativePath: dirPath,
            async queryPermission() {
                return 'granted';
            },
            async requestPermission() {
                return 'granted';
            },
            async getDirectoryHandle(name, opts = {}) {
                const child = path.join(dirPath, String(name || ''));
                const rel = path.relative(dirPath, child);
                if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('目录路径无效');
                if (opts.create) await fs.promises.mkdir(child, { recursive: true });
                const st = await fs.promises.stat(child);
                if (!st.isDirectory()) throw new Error('不是文件夹：' + child);
                return self._makeNativeDirectoryHandle(child);
            },
            async getFileHandle(name, opts = {}) {
                const child = path.join(dirPath, String(name || ''));
                const rel = path.relative(dirPath, child);
                if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('文件路径无效');
                if (opts.create) {
                    await fs.promises.mkdir(path.dirname(child), { recursive: true });
                    const h = await fs.promises.open(child, 'a');
                    await h.close();
                }
                const st = await fs.promises.stat(child);
                if (!st.isFile()) throw new Error('不是文件：' + child);
                return self._makeNativeFileHandle(child, path.basename(child));
            },
            async *entries() {
                const list = await fs.promises.readdir(dirPath, { withFileTypes: true });
                for (const item of list) {
                    const child = path.join(dirPath, item.name);
                    if (item.isDirectory()) yield [item.name, self._makeNativeDirectoryHandle(child)];
                    else if (item.isFile()) yield [item.name, self._makeNativeFileHandle(child, item.name)];
                }
            }
        };
    },

    async getDefaultProjectRootDirectory() {
        if (this._nativeProjectRootHandle) return this._nativeProjectRootHandle;
        const fs = this._getNativeFs();
        if (!fs) return null;
        try {
            const st = await fs.promises.stat(this.DEFAULT_PROJECT_ROOT_PATH);
            if (!st.isDirectory()) return null;
            this._nativeProjectRootHandle = this._makeNativeDirectoryHandle(this.DEFAULT_PROJECT_ROOT_PATH);
            return this._nativeProjectRootHandle;
        } catch {
            return null;
        }
    },

    _openDb() {
        if (this._dbPromise) return this._dbPromise;
        this._dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(this.DB_NAME, this.DB_VERSION);
            req.onerror = () => reject(req.error);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(this.STORE)) {
                    db.createObjectStore(this.STORE);
                }
            };
            req.onsuccess = () => resolve(req.result);
        });
        return this._dbPromise;
    },

    async saveDirectoryForAssetType(type, directoryHandle) {
        try {
            const db = await this._openDb();
            await new Promise((resolve, reject) => {
                const tx = db.transaction(this.STORE, 'readwrite');
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
                tx.objectStore(this.STORE).put(directoryHandle, type);
            });
        } catch (e) {
            console.warn('DirectoryMemory.saveDirectoryForAssetType', e);
        }
    },

    async saveStartInHandle(key, handle) {
        if (!key || !handle) return;
        try {
            const db = await this._openDb();
            await new Promise((resolve, reject) => {
                const tx = db.transaction(this.STORE, 'readwrite');
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
                tx.objectStore(this.STORE).put(handle, key);
            });
        } catch (e) {
            console.warn('DirectoryMemory.saveStartInHandle', e);
        }
    },

    async getStartInHandle(key) {
        if (!key) return null;
        try {
            const db = await this._openDb();
            return await new Promise((resolve, reject) => {
                const tx = db.transaction(this.STORE, 'readonly');
                tx.onerror = () => reject(tx.error);
                const req = tx.objectStore(this.STORE).get(key);
                req.onsuccess = () => resolve(req.result || null);
            });
        } catch (e) {
            return null;
        }
    },

    async getDirectoryForAssetType(type) {
        try {
            const db = await this._openDb();
            return await new Promise((resolve, reject) => {
                const tx = db.transaction(this.STORE, 'readonly');
                tx.onerror = () => reject(tx.error);
                const req = tx.objectStore(this.STORE).get(type);
                req.onsuccess = () => resolve(req.result || null);
            });
        } catch (e) {
            return null;
        }
    },

    async ensureReadPermission(dirHandle) {
        if (!dirHandle || !dirHandle.queryPermission) return false;
        const opts = { mode: 'read' };
        let state = await dirHandle.queryPermission(opts);
        if (state === 'granted') return true;
        state = await dirHandle.requestPermission(opts);
        return state === 'granted';
    },

    /** 供 showOpenFilePicker 的 startIn 使用 */
    async getStartInDirectoryHandle(type) {
        const h = await this.getDirectoryForAssetType(type);
        if (!h) return undefined;
        const ok = await this.ensureReadPermission(h);
        return ok ? h : undefined;
    },

    async getStartInHandleWithFallback(keys = []) {
        for (const key of keys) {
            const h = await this.getStartInHandle(key);
            if (!h) continue;
            const ok = await this.ensureReadPermission(h);
            if (ok) return h;
        }
        return undefined;
    },

    async saveProjectRootDirectory(directoryHandle) {
        if (!directoryHandle) return;
        try {
            const db = await this._openDb();
            await new Promise((resolve, reject) => {
                const tx = db.transaction(this.STORE, 'readwrite');
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
                const store = tx.objectStore(this.STORE);
                store.put(directoryHandle, this.PROJECT_ROOT_KEY);
                (this.activeProjectKeys && this.activeProjectKeys.length ? this.activeProjectKeys : [this.activeProjectKey])
                    .filter(Boolean)
                    .forEach(key => store.put(directoryHandle, `${this.PROJECT_ROOT_KEY}:${key}`));
            });
        } catch (e) {
            console.warn('DirectoryMemory.saveProjectRootDirectory', e);
        }
    },

    setActiveProjectKey(key) {
        this.activeProjectKey = String(key || '').trim().toLowerCase();
        this.activeProjectKeys = this.activeProjectKey ? [this.activeProjectKey] : [];
    },

    setActiveProjectKeys(keys) {
        const clean = [...new Set((keys || []).map(k => String(k || '').trim().toLowerCase()).filter(Boolean))];
        this.activeProjectKeys = clean;
        this.activeProjectKey = clean[0] || '';
    },

    async getProjectRootDirectoryHandle() {
        try {
            const db = await this._openDb();
            const projectKeys = this.activeProjectKeys && this.activeProjectKeys.length ? this.activeProjectKeys : (this.activeProjectKey ? [this.activeProjectKey] : []);
            const keys = projectKeys.length
                ? [...projectKeys.map(key => `${this.PROJECT_ROOT_KEY}:${key}`), this.PROJECT_ROOT_KEY]
                : [this.PROJECT_ROOT_KEY];
            for (const key of keys) {
                const hit = await new Promise((resolve, reject) => {
                    const tx = db.transaction(this.STORE, 'readonly');
                    tx.onerror = () => reject(tx.error);
                    const req = tx.objectStore(this.STORE).get(key);
                    req.onsuccess = () => resolve(req.result || null);
                });
                if (hit) return hit;
            }
            return null;
        } catch (e) {
            return null;
        }
    },

    async ensureProjectRootWritePermission(dirHandle) {
        if (!dirHandle || !dirHandle.queryPermission) return false;
        const opts = { mode: 'readwrite' };
        try {
            let state = await dirHandle.queryPermission(opts);
            if (state === 'granted') return true;
            state = await dirHandle.requestPermission(opts);
            return state === 'granted';
        } catch {
            return false;
        }
    },

    /** 已绑定且当前仍具备读写权限时返回句柄，否则 null */
    async getProjectRootDirectory() {
        const h = await this.getProjectRootDirectoryHandle();
        if (h) {
            const ok = await this.ensureProjectRootWritePermission(h);
            if (ok) return h;
        }
        return await this.getDefaultProjectRootDirectory();
    }
};
