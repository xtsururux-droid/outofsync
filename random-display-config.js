/**
 * random-display-config.js — 随机展示模块（书介等）项目数据与抽条
 * 与 project.randomDisplayModules 一致；运行时由 SceneManager + UIManager 消费。
 */
const RandomDisplayConfig = {
    seenVarKey(moduleId, itemId) {
        return `rd_seen_${String(moduleId || '').replace(/[^\w]/g, '_')}_${String(itemId || '').replace(/[^\w]/g, '_')}`;
    },

    normalizeProject(project) {
        if (!project || typeof project !== 'object') return;
        if (!Array.isArray(project.randomDisplayModules)) project.randomDisplayModules = [];
        project.randomDisplayModules = project.randomDisplayModules
            .filter(m => m && typeof m === 'object')
            .map((m, i) => this.normalizeModule(m, i));
    },

    normalizeModule(m, idx) {
        const id = m.id && String(m.id).trim() ? String(m.id).trim() : `rdmod_${idx + 1}`;
        const name = m.name != null ? String(m.name) : '';
        const lines = Math.floor(Number(m.narrationLinesPerPage));
        const narrationLinesPerPage = Number.isFinite(lines) && lines >= 1 ? Math.min(80, lines) : 6;
        const nfp = Math.floor(Number(m.narrationFontPx));
        const narrationFontPx = Number.isFinite(nfp) && nfp >= 8 ? Math.min(48, nfp) : 16;
        const narrationColor = m.narrationColor != null && String(m.narrationColor).trim() ? String(m.narrationColor).trim() : '#e8e6e3';
        const nt = m.narrationTypewriterMsPerChar;
        const narrationTypewriterMsPerChar =
            nt === '' || nt === null || nt === undefined ? null : Number.isFinite(Number(nt)) && Number(nt) >= 0 ? Number(nt) : null;
        const cms = Math.floor(Number(m.copyMsPerChar));
        const copyMsPerChar = Number.isFinite(cms) && cms >= 0 ? Math.min(500, cms) : 35;
        const cfp = Math.floor(Number(m.copyFontPx));
        const copyFontPx = Number.isFinite(cfp) && cfp >= 8 ? Math.min(64, cfp) : 22;
        const copyColor = m.copyColor != null && String(m.copyColor).trim() ? String(m.copyColor).trim() : '#e8e6e3';
        const cr = String(m.copyRegion || 'full').toLowerCase();
        const copyRegion = cr === 'left' || cr === 'right' ? cr : 'full';
        const items = Array.isArray(m.items) ? m.items.filter(it => it && typeof it === 'object').map((it, ii) => this.normalizeItem(it, ii)) : [];
        const exhaustedMessage = m.exhaustedMessage != null ? String(m.exhaustedMessage) : '';
        let typeNames = [];
        if (Array.isArray(m.typeNames)) typeNames = m.typeNames.map(x => String(x || '').trim()).filter(Boolean);
        else if (Array.isArray(m.types)) typeNames = m.types.map(x => String((x && (x.name || x.title)) || x || '').trim()).filter(Boolean);
        items.forEach(it => {
            const t = it && it.typeName != null ? String(it.typeName).trim() : '';
            if (t) typeNames.push(t);
        });
        typeNames = [...new Set(typeNames)];
        return {
            ...m,
            id,
            name: name || id,
            typeNames,
            narrationLinesPerPage,
            narrationFontPx,
            narrationColor,
            narrationTypewriterMsPerChar,
            copyMsPerChar,
            copyFontPx,
            copyColor,
            copyRegion,
            exhaustedMessage,
            items
        };
    },

    normalizeItem(it, ii) {
        const id = it.id && String(it.id).trim() ? String(it.id).trim() : `rditem_${ii + 1}`;
        const title = it.title != null ? String(it.title) : '';
        const cgAlias = it.cgAlias != null ? String(it.cgAlias).trim() : '';
        const cgMusicAlias = it.cgMusicAlias != null ? String(it.cgMusicAlias).trim() : '';
        const typeName = it.typeName != null ? String(it.typeName).trim() : '';
        const highlight = it.highlight != null ? String(it.highlight) : '';
        let pages = [];
        if (Array.isArray(it.pages)) {
            pages = it.pages.map(p => String(p != null ? p : ''));
        } else if (typeof it.pages === 'string') {
            try {
                const parsed = JSON.parse(it.pages);
                if (Array.isArray(parsed)) pages = parsed.map(p => String(p != null ? p : ''));
            } catch {
                pages = [];
            }
        }
        pages = pages.map(p => p.replace(/\r\n/g, '\n'));
        let copyBody = it.copyBody != null ? String(it.copyBody).replace(/\r\n/g, '\n') : '';
        if (!String(copyBody).trim() && pages.length) copyBody = pages.filter(p => String(p || '').trim()).join('\n\n');
        const dramaticWrong = new Set(['打击', '愤怒', '闪电', '绝望', '混乱', '冰点', '崩塌']);
        let fxEntrance = it.fxEntrance != null ? String(it.fxEntrance).trim() : '';
        let fxAmbience = it.fxAmbience != null ? String(it.fxAmbience).trim() : '';
        let fxExit = it.fxExit != null ? String(it.fxExit).trim() : '';
        if (dramaticWrong.has(fxEntrance)) fxEntrance = '';
        if (dramaticWrong.has(fxAmbience)) fxAmbience = '';
        if (dramaticWrong.has(fxExit)) fxExit = '';
        const em = Math.floor(Number(it.fxEntranceMs));
        const xm = Math.floor(Number(it.fxExitMs));
        const fxEntranceMs =
            it.fxEntranceMs != null && it.fxEntranceMs !== '' && Number.isFinite(Number(it.fxEntranceMs)) && em >= 200
                ? Math.min(12000, em)
                : 3000;
        const fxExitMs =
            it.fxExitMs != null && it.fxExitMs !== '' && Number.isFinite(Number(it.fxExitMs)) && xm >= 200
                ? Math.min(12000, xm)
                : 3000;

        const T_ALL =
            typeof StoryFxCatalog !== 'undefined' && StoryFxCatalog.T ? StoryFxCatalog.T.ALL : '通用';
        const normalizeRdFxSpec = (raw, legacyEffect, defaultFamily) => {
            if (raw && typeof raw === 'object' && Number(raw.v) === 2) {
                const family = String(raw.family || '').trim();
                if (!family) return null;
                const effect = String(raw.effect || '').trim();
                const target =
                    raw.target == null || String(raw.target).trim() === ''
                        ? T_ALL
                        : String(raw.target).trim();
                return { v: 2, family, target, effect };
            }
            const leg = legacyEffect != null ? String(legacyEffect).trim() : '';
            if (!leg) return null;
            return { v: 2, family: defaultFamily, target: T_ALL, effect: leg };
        };
        let rdFxEntry = normalizeRdFxSpec(it.rdFxEntry, fxEntrance, 'rom_entry');
        let rdFxAmbient = normalizeRdFxSpec(it.rdFxAmbient, fxAmbience, 'rom_ambient');
        let rdFxExit = normalizeRdFxSpec(it.rdFxExit, fxExit, 'rom_exit');
        const hadExplicitEntry = it.rdFxEntry && typeof it.rdFxEntry === 'object' && Number(it.rdFxEntry.v) === 2;
        const hadExplicitAmb = it.rdFxAmbient && typeof it.rdFxAmbient === 'object' && Number(it.rdFxAmbient.v) === 2;
        const hadExplicitExit = it.rdFxExit && typeof it.rdFxExit === 'object' && Number(it.rdFxExit.v) === 2;
        if (!hadExplicitEntry && !String(fxEntrance || '').trim()) {
            rdFxEntry = { v: 2, family: 'rom_entry', target: T_ALL, effect: '晨曦揭幕' };
            fxEntrance = '晨曦揭幕';
        }
        if (!hadExplicitAmb && !String(fxAmbience || '').trim()) {
            rdFxAmbient = { v: 2, family: 'rom_ambient', target: T_ALL, effect: '柔光圣城' };
            fxAmbience = '柔光圣城';
        }
        if (!hadExplicitExit && !String(fxExit || '').trim()) {
            rdFxExit = { v: 2, family: 'rom_exit', target: T_ALL, effect: '涟漪消散' };
            fxExit = '涟漪消散';
        }
        if (rdFxEntry && rdFxEntry.family === 'rom_entry' && rdFxEntry.effect) fxEntrance = rdFxEntry.effect;
        if (rdFxAmbient && rdFxAmbient.family === 'rom_ambient' && rdFxAmbient.effect) fxAmbience = rdFxAmbient.effect;
        if (rdFxExit && rdFxExit.family === 'rom_exit' && rdFxExit.effect) fxExit = rdFxExit.effect;

        return {
            ...it,
            id,
            title,
            cgAlias,
            cgMusicAlias,
            typeName,
            highlight,
            pages,
            copyBody,
            fxEntrance,
            fxAmbience,
            fxExit,
            fxEntranceMs,
            fxExitMs,
            rdFxEntry,
            rdFxAmbient,
            rdFxExit
        };
    },

    listModules(project) {
        if (!project || !Array.isArray(project.randomDisplayModules)) return [];
        return project.randomDisplayModules.filter(Boolean);
    },

    findModule(project, moduleId) {
        if (!moduleId) return null;
        return this.listModules(project).find(m => m.id === moduleId) || null;
    },

    /**
     * @returns {{ module: object, item: object|null }}
     */
    pickModuleItem(project, step) {
        const module = this.findModule(project, step && step.randomDisplayModuleId);
        if (!module || !Array.isArray(module.items) || !module.items.length) {
            return { module: null, item: null };
        }
        const available = this.listAvailableItems(module);
        const mode = step && step.randomDisplayPickMode === 'randomAll' ? 'randomAll' : 'randomUnseen';
        const seenKey = qid => this.seenVarKey(module.id, qid);
        const unseen = available.filter(it => {
            if (!it || !it.id) return false;
            if (typeof GameState === 'undefined' || !GameState.get) return true;
            return Number(GameState.get(seenKey(it.id)) || 0) !== 1;
        });
        const pool = mode === 'randomAll' ? available.filter(it => it && it.id) : unseen.length ? unseen : [];
        if (!pool.length) return { module, item: null };
        const r = typeof GameState !== 'undefined' && GameState.random ? GameState.random() : Math.random();
        const ix = Math.max(0, Math.min(pool.length - 1, Math.floor(r * pool.length)));
        return { module, item: pool[ix] };
    },

    listAvailableItems(module) {
        const items = module && Array.isArray(module.items) ? module.items : [];
        return items.filter(it => {
            if (!it || !it.id) return false;
            if (!it.condition) return true;
            if (typeof SceneManager === 'undefined' || typeof SceneManager.evalCondition !== 'function') return true;
            return SceneManager.evalCondition(it.condition);
        });
    },

    markItemSeen(module, item) {
        if (!module || !item || !item.id) return;
        if (typeof GameState !== 'undefined' && GameState.set) {
            GameState.set(this.seenVarKey(module.id, item.id), 1);
        }
    },

    ensureType(module, typeName) {
        if (!module) return false;
        const t = String(typeName || '').trim();
        if (!t) return false;
        if (!Array.isArray(module.typeNames)) module.typeNames = [];
        if (module.typeNames.includes(t)) return false;
        module.typeNames.push(t);
        return true;
    },

    removeType(module, typeName) {
        if (!module || !Array.isArray(module.typeNames)) return;
        const t = String(typeName || '').trim();
        module.typeNames = module.typeNames.filter(x => x !== t);
        if (Array.isArray(module.items)) {
            module.items.forEach(it => {
                if (it && it.typeName === t) it.typeName = '';
            });
        }
    }
};
