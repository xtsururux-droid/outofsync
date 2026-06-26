/**
 * storage-manager.js - 资源存取管理器 (增强版)
 */
const StorageManager = {
    // 1. 项目 JSON 的导入导出
    async loadProjectFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try { resolve(JSON.parse(e.target.result)); } 
                catch (err) { reject("JSON 格式错误"); }
            };
            reader.onerror = () => reject("文件读取失败");
            reader.readAsText(file);
        });
    },

    /** 与导出一致：含内嵌资源快照 */
    buildProjectJsonString(data, opts = {}) {
        const embedded =
            typeof AssetManager !== 'undefined' && AssetManager.buildEmbeddedSnapshotForProject
                ? AssetManager.buildEmbeddedSnapshotForProject(data)
                : null;
        const payload = { ...data };
        delete payload.__projectFileName;
        if (payload.buildConfig && typeof payload.buildConfig === 'object') {
            payload.buildConfig = { ...payload.buildConfig };
            delete payload.buildConfig.publishMode;
            if (!Object.keys(payload.buildConfig).length) delete payload.buildConfig;
        }
        if (embedded) payload.embeddedAssetLibrary = embedded;
        else delete payload.embeddedAssetLibrary;
        return JSON.stringify(payload, null, 4);
    },

    exportProject(data, opts = {}) {
        const text = this.buildProjectJsonString(data, opts);
        const blob = new Blob([text], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const base = String((data && data.projectName) || 'episode')
            .replace(/[\\/:*?"<>|]+/g, '_')
            .trim()
            .slice(0, 120);
        const fileName = `${base || 'episode'}_exported.json`;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
        return { ok: true, fileName };
    },

    /**
     * 让用户选择保存路径并写入 JSON（Chrome/Edge 等支持 showSaveFilePicker）。
     * @returns {Promise<{ ok: boolean, reason?: string }>}
     */
    async saveProjectWithFilePicker(data, opts = {}) {
        if (typeof window.showSaveFilePicker !== 'function') {
            return { ok: false, reason: 'unsupported' };
        }
        const text = this.buildProjectJsonString(data, opts);
        const base = String((data && data.projectName) || 'episode')
            .replace(/[\\/:*?"<>|]+/g, '_')
            .trim()
            .slice(0, 120);
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: `${base || 'episode'}.json`,
                types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }]
            });
            const w = await handle.createWritable();
            await w.write(text);
            await w.close();
            return { ok: true, fileName: handle.name || '' };
        } catch (e) {
            if (e && e.name === 'AbortError') return { ok: false, reason: 'abort' };
            return { ok: false, reason: 'error', error: e };
        }
    },

    async saveProjectToFileHandle(data, handle) {
        if (!handle || typeof handle.createWritable !== 'function') {
            return { ok: false, reason: 'no-handle' };
        }
        try {
            if (typeof handle.queryPermission === 'function') {
                let perm = await handle.queryPermission({ mode: 'readwrite' });
                if (perm !== 'granted' && typeof handle.requestPermission === 'function') {
                    perm = await handle.requestPermission({ mode: 'readwrite' });
                }
                if (perm !== 'granted') return { ok: false, reason: 'permission' };
            }
            const text = this.buildProjectJsonString(data);
            const w = await handle.createWritable();
            await w.write(text);
            await w.close();
            return { ok: true };
        } catch (e) {
            if (e && e.name === 'AbortError') return { ok: false, reason: 'abort' };
            return { ok: false, reason: 'error', error: e };
        }
    },

    async saveProjectToDirectoryFile(data, directoryHandle, fileName) {
        if (!directoryHandle || typeof directoryHandle.getFileHandle !== 'function' || !fileName) {
            return { ok: false, reason: 'no-handle' };
        }
        try {
            if (typeof directoryHandle.queryPermission === 'function') {
                let perm = await directoryHandle.queryPermission({ mode: 'readwrite' });
                if (perm !== 'granted' && typeof directoryHandle.requestPermission === 'function') {
                    perm = await directoryHandle.requestPermission({ mode: 'readwrite' });
                }
                if (perm !== 'granted') return { ok: false, reason: 'permission' };
            }
            const handle = await directoryHandle.getFileHandle(fileName, { create: true });
            const result = await this.saveProjectToFileHandle(data, handle);
            if (result && result.ok) result.fileName = fileName;
            return result;
        } catch (e) {
            if (e && e.name === 'AbortError') return { ok: false, reason: 'abort' };
            return { ok: false, reason: 'error', error: e };
        }
    },

    readFileAsDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error || new Error('读取失败'));
            reader.readAsDataURL(file);
        });
    },

    readImageAsResizedDataURL(file, maxEdge = 1920, quality = 0.88, mimeType = 'image/webp') {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const img = new Image();
                img.onload = () => {
                    const w = img.naturalWidth || img.width;
                    const h = img.naturalHeight || img.height;
                    if (!w || !h) return reject(new Error('图片尺寸无效'));
                    const scale = Math.min(1, maxEdge / Math.max(w, h));
                    const tw = Math.max(1, Math.round(w * scale));
                    const th = Math.max(1, Math.round(h * scale));
                    const canvas = document.createElement('canvas');
                    canvas.width = tw;
                    canvas.height = th;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) return reject(new Error('无法创建画布上下文'));
                    ctx.drawImage(img, 0, 0, tw, th);
                    try {
                        resolve(canvas.toDataURL(mimeType, quality));
                    } catch (err) {
                        reject(err);
                    }
                };
                img.onerror = () => reject(new Error('图片解码失败'));
                img.src = reader.result;
            };
            reader.onerror = () => reject(reader.error || new Error('读取失败'));
            reader.readAsDataURL(file);
        });
    },

    async buildImageCompressionCandidates(file) {
        const attempts = [];
        const plans = [
            { maxEdge: 2048, quality: 0.9, mimeType: 'image/webp' },
            { maxEdge: 1600, quality: 0.86, mimeType: 'image/webp' },
            { maxEdge: 1280, quality: 0.82, mimeType: 'image/webp' },
            { maxEdge: 1024, quality: 0.78, mimeType: 'image/webp' },
            { maxEdge: 768, quality: 0.72, mimeType: 'image/webp' }
        ];
        for (const plan of plans) {
            try {
                const dataUrl = await this.readImageAsResizedDataURL(file, plan.maxEdge, plan.quality, plan.mimeType);
                if (dataUrl && !attempts.includes(dataUrl)) attempts.push(dataUrl);
            } catch (err) {
                console.warn('压缩尝试失败', plan, err);
            }
        }
        return attempts;
    },

    // 2. 全局资源库的持久化 (存储在 LocalStorage)
    saveLibrary(libraryData) {
        localStorage.setItem('storyengine_asset_library', JSON.stringify(libraryData));
    },

    loadLibrary() {
        const defaults = {
            characters: [],
            backgrounds: [],
            storyGraphics: [],
            sounds: [],
            music: [],
            particles: []
        };
        const raw = localStorage.getItem('storyengine_asset_library');
        if (!raw) return { ...defaults };
        try {
            const parsed = JSON.parse(raw);
            return { ...defaults, ...parsed };
        } catch {
            return { ...defaults };
        }
    },

    // 3. 游戏进度的保存
    saveProgress(key, value) {
        localStorage.setItem(`storyengine_progress_${key}`, JSON.stringify(value));
    },

    loadProgress(key) {
        const data = localStorage.getItem(`storyengine_progress_${key}`);
        return data ? JSON.parse(data) : null;
    }
};
