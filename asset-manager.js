/**
 * asset-manager.js - 全局资源管理中心
 */
const AssetManager = {
    /** 与 asset-catalog-types.js 共用清单（运行端 editorAssetTypes 供自检） */
    get editorAssetTypes() {
        return AssetCatalogTypes.all();
    },

    /** 当前项目 JSON 内嵌的资源（导出携带，运行/编辑加载时合并） */
    projectEmbedded: null,
    previewUrlCache: {},
    _warnedLibraryQuotaNoPersist: false,

    library: AssetCatalogTypes.emptyLibrary(),

    init() {
        this.library = StorageManager.loadLibrary();
        this.ensureOfficialAssetLibraryEntries();
    },

    ensureOfficialAssetLibraryEntries() {
        const officialAssets = {
            particles: [
                { name: '樱花', path: 'assets/particles/樱花.png' },
                { name: '红叶', path: 'assets/particles/红叶.png' },
                { name: '黄叶', path: 'assets/particles/黄叶.png' }
            ]
        };
        let changed = false;

        Object.entries(officialAssets).forEach(([type, rows]) => {
            if (!Array.isArray(this.library[type])) {
                this.library[type] = [];
                changed = true;
            }
            rows.forEach(row => {
                const existing = this.library[type].find(a => a && a.name === row.name);
                if (!existing) {
                    this.library[type].push({ name: row.name, path: row.path });
                    changed = true;
                    return;
                }
                if (existing.path !== row.path || existing.src) {
                    existing.path = row.path;
                    delete existing.src;
                    changed = true;
                }
            });
        });

        if (changed) {
            try {
                StorageManager.saveLibrary(this.library);
            } catch (err) {
                console.warn('保存官方资源登记失败', err);
            }
        }
    },

    clearProjectEmbedded() {
        this.projectEmbedded = null;
    },

    applyProjectEmbedded(embed) {
        this.projectEmbedded = AssetCatalogTypes.normalizeEmbedded(embed);
    },

    /**
     * 把项目 JSON 里的 embeddedAssetLibrary 条目合并进浏览器全局库（localStorage），
     * 按别名去重：全局已有同名则跳过。先尝试含 data URL 的完整写入；若配额不足则退回为仅合并带磁盘 path 的条目。
     * 用于：打开带内嵌快照的项目后自动同步；或用户手动点「合并到全局库」。
     * @returns {{ added: number, skippedExisting: number, quota: boolean }}
     */
    mergeEmbeddedCatalogIntoGlobalLibrary(embed) {
        const result = { added: 0, skippedExisting: 0, quota: false };
        if (!embed || typeof embed !== 'object') return result;
        const types = AssetCatalogTypes.all();
        const hasName = (type, name) => !!(name && (this.library[type] || []).some(a => a.name === name));

        const mergePass = pathOnly => {
            let passAdded = 0;
            let passSkip = 0;
            types.forEach(type => {
                const rows = embed[type];
                if (!Array.isArray(rows)) return;
                if (!this.library[type]) this.library[type] = [];
                const list = this.library[type];
                rows.forEach(row => {
                    if (!row || !row.name) return;
                    if (hasName(type, row.name)) {
                        passSkip++;
                        return;
                    }
                    const path = String(row.path || '').trim();
                    const src = row.src != null ? String(row.src).trim() : '';
                    if (pathOnly) {
                        if (!path) return;
                        list.push({ name: row.name, path });
                        passAdded++;
                    } else if (path) {
                        list.push({ name: row.name, path });
                        passAdded++;
                    } else if (src) {
                        list.push({ name: row.name, path: '', src });
                        passAdded++;
                    } else {
                        list.push({ name: row.name, path: '' });
                        passAdded++;
                    }
                });
            });
            return { passAdded, passSkip };
        };

        let r = mergePass(false);
        result.added = r.passAdded;
        result.skippedExisting = r.passSkip;
        try {
            StorageManager.saveLibrary(this.library);
            return result;
        } catch (err) {
            const quota = err && (err.name === 'QuotaExceededError' || err.code === 22);
            result.quota = !!quota;
            this.init();
            if (!quota) return result;
            r = mergePass(true);
            result.added = r.passAdded;
            result.skippedExisting = r.passSkip;
            try {
                StorageManager.saveLibrary(this.library);
                result.quota = false;
            } catch {
                this.init();
                result.added = 0;
                result.skippedExisting = 0;
                result.quota = true;
            }
            return result;
        }
    },

    /**
     * 收集项目中实际用到的资源，用于写入 JSON（含 data URL 时任意环境可显示）
     */
    collectCharacterSpriteAliases(project) {
        const set = new Set();
        if (!project) return set;
        (project.characterRoster || []).forEach(c => {
            Object.values(c.expressions || {}).forEach(ex => {
                if (ex && ex.spriteAsset) set.add(ex.spriteAsset);
            });
        });
        (project.scenes || []).forEach(s => {
            if (s.character && s.character.url) set.add(s.character.url);
            const ro = (project.characterRoster || []).find(x => x.id === s.characterRef);
            if (ro && ro.expressions) {
                const roKeys = Object.keys(ro.expressions).filter(k => !k.startsWith('__pending_'));
                const key = s.expression || ro.defaultExpression || roKeys[0];
                const slot = ro.expressions[key];
                if (slot && slot.spriteAsset) set.add(slot.spriteAsset);
            }
        });
        return set;
    },

    assetTypeToExtensions(type) {
        return AssetCatalogTypes.extensions(type);
    },

    assetNameToFileCandidates(name, type) {
        const raw = String(name || '').trim();
        if (!raw) return [];
        const baseNames = [
            raw,
            raw.replace(/\s+\(/g, '_('),
            raw.replace(/\s+/g, '_')
        ];
        const seen = new Set();
        const out = [];
        const hasExt = /\.[a-z0-9]{2,5}$/i.test(raw);
        baseNames.forEach(base => {
            if (!base || seen.has(base)) return;
            seen.add(base);
            if (hasExt) {
                out.push(base);
                return;
            }
            this.assetTypeToExtensions(type).forEach(ext => out.push(`${base}.${ext}`));
        });
        return out;
    },

    projectAssetPathExists(relPath) {
        const rel = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
        if (!rel || !/^assets\//i.test(rel)) return false;
        const fs = typeof DirectoryMemory !== 'undefined' && DirectoryMemory._getNativeFs ? DirectoryMemory._getNativeFs() : null;
        const path = typeof DirectoryMemory !== 'undefined' && DirectoryMemory._getNativePath ? DirectoryMemory._getNativePath() : null;
        if (!fs || !path) return false;
        const roots = [];
        try {
            if (typeof process !== 'undefined' && process.cwd) roots.push(process.cwd());
        } catch {}
        if (typeof DirectoryMemory !== 'undefined' && DirectoryMemory._nativeProjectRootHandle && DirectoryMemory._nativeProjectRootHandle.nativePath) {
            roots.push(DirectoryMemory._nativeProjectRootHandle.nativePath);
        }
        if (typeof DirectoryMemory !== 'undefined' && DirectoryMemory.DEFAULT_PROJECT_ROOT_PATH) {
            roots.push(DirectoryMemory.DEFAULT_PROJECT_ROOT_PATH);
        }
        for (const root of [...new Set(roots.filter(Boolean))]) {
            try {
                if (fs.existsSync(path.join(root, ...rel.split('/')))) return true;
            } catch {}
        }
        return false;
    },

    inferProjectAssetRow(type, name) {
        const clean = String(name || '').trim();
        const sub = this.assetTypeToSubdir(type);
        if (!clean || !sub) return null;
        const candidates = this.assetNameToFileCandidates(clean, type).map(file => `assets/${sub}/${file}`);
        const existing = candidates.find(p => this.projectAssetPathExists(p));
        return { name: clean, path: existing || candidates[0] || '' };
    },

    buildEmbeddedSnapshotForProject(project) {
        if (!project || !project.scenes) return null;
        const prevEmbedded = this.projectEmbedded;
        this.applyProjectEmbedded(project.embeddedAssetLibrary || null);
        try {
        const out = {};
        let any = false;
        const addRow = (type, asset) => {
            if (!asset || !asset.name) return;
            const row = { name: asset.name, path: this.normalizeAssetPath(type, String(asset.path || '').trim()) };
            if (asset.src) row.src = asset.src;
            if (!row.path && !row.src) return;
            if (row.path && typeof DirectoryMemory !== 'undefined' && DirectoryMemory.getProjectRootDirectory) {
                // Disk existence is checked asynchronously before saving; keep only project-style paths here.
                if (!/^assets\//i.test(row.path)) return;
            }
            if (!out[type]) out[type] = [];
            const idx = out[type].findIndex(a => a && a.name === row.name);
            if (idx >= 0) out[type][idx] = { ...out[type][idx], ...row };
            else out[type].push(row);
            any = true;
        };
        if (project.embeddedAssetLibrary && typeof project.embeddedAssetLibrary === 'object') {
            AssetCatalogTypes.all().forEach(type => {
                (project.embeddedAssetLibrary[type] || []).forEach(row => addRow(type, row));
            });
        }
        const used = AssetCatalogTypes.emptyUsedSets();
        project.scenes.forEach(s => {
            if (s.background && s.background.url) used.backgrounds.add(s.background.url);
            if (s.storyGraphic && s.storyGraphic.url) used.storyGraphics.add(s.storyGraphic.url);
            if (s.music && s.music.url) used.music.add(s.music.url);
            (s.steps || []).forEach(st => {
                if (st && st.type === 'cg' && st.cgMusicAlias) used.music.add(st.cgMusicAlias);
                if (st && st.type === 'cg' && st.cg && st.cg.url) used.storyGraphics.add(st.cg.url);
                const sfx = st && st.soundAlias != null ? String(st.soundAlias).trim() : '';
                if (sfx) used.sounds.add(sfx);
            });
            const ef = s.effects || {};
            if (typeof StoryEffectsRegistry !== 'undefined' && StoryEffectsRegistry.collectParticleAliasesFromSceneEffects) {
                StoryEffectsRegistry.collectParticleAliasesFromSceneEffects(ef).forEach(a => used.particles.add(a));
            } else {
                const builtins = new Set([
                    'starryNight',
                    'goldenBokeh',
                    'softGlow',
                    'heartBubbles',
                    'rainFine',
                    'coldBlue'
                ]);
                (ef.overlays || []).forEach(id => {
                    if (id && !builtins.has(id)) used.particles.add(id);
                });
                if (ef.combo === 'combo_passionate') used.particles.add('樱花');
            }
            if (ef.dramatic) used.sounds.add(ef.dramatic);
        });
        (project.graphicReadingModules || []).forEach(m => {
            if (!m || typeof m !== 'object') return;
            if (m.cgMusicAlias) used.music.add(m.cgMusicAlias);
            (m.images || []).forEach(img => {
                if (img && img.alias) used.storyGraphics.add(img.alias);
            });
        });
        (project.hiddenMapModules || []).forEach(m => {
            if (!m || typeof m !== 'object') return;
            if (m.foundSoundAlias) used.sounds.add(m.foundSoundAlias);
            if (m.imageAlias) used.backgrounds.add(m.imageAlias);
        });
        (project.itemLibrary || []).forEach(item => {
            if (item && item.iconAlias) used.items.add(item.iconAlias);
        });
        if (typeof CustomUiConfig !== 'undefined' && CustomUiConfig.collectStoryGraphicAliases) {
            CustomUiConfig.collectStoryGraphicAliases(project).forEach(a => used.storyGraphics.add(a));
        }
        this.collectCharacterSpriteAliases(project).forEach(a => used.characters.add(a));
        AssetCatalogTypes.all().forEach(type => {
            const names = used[type];
            if (!names || !names.size) return;
            const merged = this.getMergedAssetRows(type);
            names.forEach(name => {
                const asset = merged.find(a => a.name === name) || this.inferProjectAssetRow(type, name);
                addRow(type, asset);
            });
        });
        return any ? out : null;
        } finally {
            this.applyProjectEmbedded(prevEmbedded);
        }
    },

    repairProjectEmbedded(project) {
        if (!project || typeof project !== 'object') return project;
        const prevEmbedded = this.projectEmbedded;
        const existing = project.embeddedAssetLibrary || null;
        this.applyProjectEmbedded(existing);
        try {
            const repaired = this.buildEmbeddedSnapshotForProject(project);
            if (repaired) {
                project.embeddedAssetLibrary = repaired;
                this.applyProjectEmbedded(repaired);
            } else if (!project.embeddedAssetLibrary) {
                project.embeddedAssetLibrary = AssetCatalogTypes.emptyEmbedded();
                this.applyProjectEmbedded(project.embeddedAssetLibrary);
            }
        } finally {
            if (!project.embeddedAssetLibrary) this.applyProjectEmbedded(prevEmbedded);
        }
        return project;
    },

    registerAsset(type, name, path, src) {
        if (!this.library[type]) this.library[type] = [];
        const asset = { name, path };
        if (src) asset.src = src;
        const idx = this.library[type].findIndex(a => a.name === name);
        const oldAsset = idx >= 0 ? this.library[type][idx] : null;
        if (idx >= 0) this.library[type][idx] = asset;
        else this.library[type].push(asset);
        try {
            StorageManager.saveLibrary(this.library);
        } catch (err) {
            const quota = err && (err.name === 'QuotaExceededError' || err.code === 22);
            // 磁盘写入场景（src 为空）下，即便 localStorage 爆满，也保留内存中的资源登记，避免上传流程被 QUOTA 卡死
            if (quota && !src) {
                if (!this._warnedLibraryQuotaNoPersist) {
                    this._warnedLibraryQuotaNoPersist = true;
                    alert('浏览器本地缓存已满：资源已写入项目 assets 目录，但本地资源索引无法持久化。建议稍后清理站点存储。');
                }
                return;
            }
            if (idx >= 0 && oldAsset) this.library[type][idx] = oldAsset;
            else if (idx < 0) this.library[type] = this.library[type].filter(a => a.name !== name);
            if (quota) throw new Error('QUOTA');
            throw err;
        }
    },

    removeAsset(type, name, projectData) {
        if (!this.library[type]) this.library[type] = [];
        this.library[type] = this.library[type].filter(a => a.name !== name);
        if (this.projectEmbedded && this.projectEmbedded[type]) {
            this.projectEmbedded[type] = this.projectEmbedded[type].filter(a => a.name !== name);
        }
        if (projectData && projectData.embeddedAssetLibrary && Array.isArray(projectData.embeddedAssetLibrary[type])) {
            projectData.embeddedAssetLibrary[type] = projectData.embeddedAssetLibrary[type].filter(a => a.name !== name);
        }
        StorageManager.saveLibrary(this.library);
    },

    /**
     * 仅更新磁盘型资源的 path（不改别名），同步 projectData.embeddedAssetLibrary、内存库与 projectEmbedded。
     * 用于「检查并清理」前自动修正 png/webp 更名、序号变化等导致的错位。
     */
    patchAssetPath(type, name, newPath, projectData) {
        const p = String(newPath || '')
            .replace(/\\/g, '/')
            .trim();
        if (!p || !name) return false;
        if (projectData && projectData.embeddedAssetLibrary && Array.isArray(projectData.embeddedAssetLibrary[type])) {
            const row = projectData.embeddedAssetLibrary[type].find(a => a && a.name === name);
            if (row) row.path = p;
        }
        if (this.projectEmbedded && Array.isArray(this.projectEmbedded[type])) {
            const row2 = this.projectEmbedded[type].find(a => a && a.name === name);
            if (row2) row2.path = p;
        }
        if (this.library[type]) {
            const row3 = this.library[type].find(a => a && a.name === name);
            if (row3) row3.path = p;
        }
        try {
            StorageManager.saveLibrary(this.library);
        } catch {
            /* 与 registerAsset 一致：磁盘 path 时 localStorage 满可忽略 */
        }
        return true;
    },

    assetTypeToSubdir(type) {
        return AssetCatalogTypes.subdir(type);
    },

    isPortableAssetPath(path) {
        const s = String(path || '').trim();
        if (!s) return false;
        return (
            s.startsWith('data:') ||
            s.startsWith('blob:') ||
            /^https?:\/\//i.test(s) ||
            /^assets\//i.test(s) ||
            /^\/assets\//i.test(s)
        );
    },

    normalizeAssetPath(type, path) {
        const s = String(path || '').replace(/\\/g, '/').trim();
        if (!s || this.isPortableAssetPath(s)) return s;
        if (s.includes('/')) return s;
        const sub = this.assetTypeToSubdir(type);
        return sub ? `assets/${sub}/${s}` : s;
    },

    getPath(type, name) {
        if (!name) return null;
        const cacheKey = `${type}:${name}`;
        if (this.previewUrlCache && this.previewUrlCache[cacheKey]) return this.previewUrlCache[cacheKey];
        const pick = row => {
            if (!row) return null;
            const src = row.src != null ? String(row.src).trim() : '';
            if (src) return src;
            const path = row.path != null ? String(row.path).trim() : '';
            return this.normalizeAssetPath(type, path) || null;
        };
        if (this.projectEmbedded && Array.isArray(this.projectEmbedded[type])) {
            const hit = this.projectEmbedded[type].find(a => a.name === name);
            const u = pick(hit);
            return u || null;
        }
        if (!this.library[type]) {
            if (this.projectEmbedded && this.projectEmbedded[type]) {
                const hit = this.projectEmbedded[type].find(a => a.name === name);
                return pick(hit);
            }
            return null;
        }
        const asset = this.library[type].find(a => a.name === name);
        const fromLibrary = pick(asset);
        if (fromLibrary) return fromLibrary;
        if (this.projectEmbedded && this.projectEmbedded[type]) {
            const hit = this.projectEmbedded[type].find(a => a.name === name);
            return pick(hit);
        }
        return null;
    },

    rememberPreviewUrl(type, name, file) {
        if (!type || !name || !file || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return '';
        const key = `${type}:${name}`;
        if (this.previewUrlCache && this.previewUrlCache[key]) {
            try { URL.revokeObjectURL(this.previewUrlCache[key]); } catch {}
        }
        const url = URL.createObjectURL(file);
        this.previewUrlCache[key] = url;
        return url;
    },

    async resolveProjectAssetUrl(type, name) {
        const cached = this.getPath(type, name);
        if (!cached || cached.startsWith('data:') || cached.startsWith('blob:') || /^https?:\/\//i.test(cached)) return cached;
        const rel = this.normalizeAssetPath(type, cached).replace(/^\/+/, '').replace(/\\/g, '/');
        if (!/^assets\//i.test(rel)) return cached;
        const key = `${type}:${name}`;
        if (this.previewUrlCache && this.previewUrlCache[key]) return this.previewUrlCache[key];
        if (typeof DirectoryMemory === 'undefined' || !DirectoryMemory.getProjectRootDirectory) return cached;
        const root = await DirectoryMemory.getProjectRootDirectory();
        if (!root) return cached;
        try {
            let dir = root;
            const parts = rel.split('/').filter(Boolean);
            for (let i = 0; i < parts.length - 1; i++) {
                dir = await dir.getDirectoryHandle(parts[i], { create: false });
            }
            const fh = await dir.getFileHandle(parts[parts.length - 1], { create: false });
            const file = await fh.getFile();
            return this.rememberPreviewUrl(type, name, file) || cached;
        } catch (e) {
            console.warn('AssetManager.resolveProjectAssetUrl failed', rel, e);
            return cached;
        }
    },

    /**
     * 运行端 / 预览用：解析为可赋给 img.src / Audio 的 URL。
     * 与 getPath 一致（不对相对路径做 encodeURI）：本地静态服对「已编码的 UTF-8 路径」常无法映射到含中文的真实文件名，反而导致 404。
     */
    resolveMediaUrl(type, name) {
        return this.getPath(type, name);
    },

    /** 视频 URL：粒子图若登记成 mp4 等，不能赋给 img.src */
    isVideoLikeMediaUrl(u) {
        if (!u) return false;
        const s = String(u).toLowerCase();
        return /\.(mp4|webm|ogg|mov|m4v|avi)(\?|#|$)/i.test(s) || s.startsWith('data:video');
    },

    /**
     * 内置粒子约定名（樱花/黄叶/红叶）的常见别名：繁体、英文文件名等。
     * 资源库条目名与约定名不一致时仍可解析到图。
     */
    PARTICLE_IMAGE_ALIAS_TRIES: {
        '红叶': ['红叶', '红葉', 'RED_LEAF', 'red_leaf', 'RedLeaf', 'redleaf'],
        '黄叶': ['黄叶', '黃葉', 'YELLOW_LEAF', 'yellow_leaf', 'YellowLeaf', 'yellowleaf'],
        '樱花': ['樱花', '櫻花', 'sakura', 'SAKURA', 'Sakura', 'sakura_leaf']
    },

    expandParticleImageAliases(primaryName) {
        const key = String(primaryName || '').trim();
        const extra = this.PARTICLE_IMAGE_ALIAS_TRIES[key] || [];
        return [...new Set([key, ...extra].filter(Boolean))];
    },

    /** 返回可给 <img> 的粒子图 URL；跳过视频；按别名列表依次尝试（含项目内嵌） */
    resolveParticleImageUrl(primaryAlias) {
        const names = this.expandParticleImageAliases(primaryAlias);
        for (let i = 0; i < names.length; i++) {
            const u = this.getPath('particles', names[i]);
            if (u && !this.isVideoLikeMediaUrl(u)) return u;
        }
        return null;
    },

    assetNameExists(type, name) {
        if (this.projectEmbedded && Array.isArray(this.projectEmbedded[type])) {
            return this.projectEmbedded[type].some(a => a && a.name === name);
        }
        return false;
    },

    /** 编辑器下拉用：先全局库（localStorage）再并上 projectEmbedded；勿与「仅 episode.json 内嵌表」混为一谈。 */
    getList(type) {
        const seen = new Set();
        const out = [];
        if (this.projectEmbedded && Array.isArray(this.projectEmbedded[type])) {
            this.projectEmbedded[type].forEach(a => {
                if (a.name && !seen.has(a.name)) {
                    seen.add(a.name);
                    out.push(a.name);
                }
            });
        }
        return out;
    },

    /** 合并本地库与项目内嵌条目（用于列表展示、清理校验；避免仅内嵌时 library 为空） */
    getMergedAssetRows(type) {
        const mergeTwo = (a, b) => {
            if (!b || !b.name) return a || null;
            if (!a) {
                const o = { name: b.name, path: b.path || '' };
                if (b.src) o.src = b.src;
                return o;
            }
            const path = String(a.path || '').trim() || String(b.path || '').trim();
            const src = String(a.src || '').trim() || String(b.src || '').trim();
            const o = { name: a.name || b.name, path };
            if (src) o.src = src;
            return o;
        };
        const byName = new Map();
        const add = row => {
            if (!row || !row.name) return;
            const prev = byName.get(row.name);
            byName.set(row.name, mergeTwo(prev, row));
        };
        if (this.projectEmbedded && Array.isArray(this.projectEmbedded[type])) {
            this.projectEmbedded[type].forEach(add);
        }
        if (this.library && Array.isArray(this.library[type])) {
            this.library[type].forEach(add);
        }
        return [...byName.values()];
    },

    /** 运行端启动自检：核对内嵌资源表里的各类别名是否都能解析出路径（仅 console 警告，不阻断游戏） */
    async auditEmbeddedAssetsForRuntime(opts = {}) {
        const types = AssetCatalogTypes.all();
        const missing = [];
        const fetchCheck = opts.fetchCheck !== false && typeof fetch === 'function';
        for (let ti = 0; ti < types.length; ti++) {
            const type = types[ti];
            const rows =
                (this.projectEmbedded && Array.isArray(this.projectEmbedded[type]) && this.projectEmbedded[type]) || [];
            for (let ri = 0; ri < rows.length; ri++) {
                const row = rows[ri];
                if (!row || !row.name) continue;
                const url = this.getPath(type, row.name);
                if (!url) {
                    missing.push({ type, name: row.name, reason: '无法解析路径' });
                    continue;
                }
                if (!fetchCheck || /^data:|^blob:|^https?:\/\//i.test(url)) continue;
                try {
                    const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
                    if (!res.ok) missing.push({ type, name: row.name, url, reason: `读取失败 HTTP ${res.status}` });
                } catch (e) {
                    missing.push({ type, name: row.name, url, reason: '网络读取失败' });
                }
            }
        }
        if (missing.length && typeof console !== 'undefined' && console.warn) {
            console.warn('[AssetManager] 内嵌资源自检发现缺失或无法读取的条目：', missing);
        }
        return missing;
    }
};
