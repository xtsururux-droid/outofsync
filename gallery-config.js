/**
 * gallery-config.js - gallery module data and runtime helpers.
 */
const GalleryConfig = {
    normalizeProject(project) {
        if (!project || typeof project !== 'object') return [];
        if (!Array.isArray(project.galleryModules)) project.galleryModules = [];
        project.galleryModules = project.galleryModules
            .filter(m => m && typeof m === 'object')
            .map((m, i) => this.normalizeModule(m, i));
        return project.galleryModules;
    },

    normalizeModule(m, index = 0) {
        const kind = m.kind === 'endingCg' ? 'endingCg' : 'character';
        const id =
            typeof m.id === 'string' && m.id.trim()
                ? m.id.trim()
                : `gal_${Date.now().toString(36)}_${index}`;
        const pageSize = kind === 'character' ? 10 : 6;
        const character = m.character && typeof m.character === 'object' ? m.character : {};
        const endingCg = m.endingCg && typeof m.endingCg === 'object' ? m.endingCg : {};
        const condition = character.condition && typeof character.condition === 'object' ? character.condition : null;
        return {
            id,
            name: typeof m.name === 'string' && m.name.trim() ? m.name.trim() : `长廊${index + 1}`,
            kind,
            pageSize,
            showLocked: m.showLocked !== false,
            character: {
                source: character.source === 'type' ? 'type' : 'all',
                typeIds: Array.isArray(character.typeIds) ? character.typeIds.map(x => String(x || '').trim()).filter(Boolean) : [],
                expressionKey: typeof character.expressionKey === 'string' ? character.expressionKey : '',
                condition: condition
                    ? {
                          type: condition.type === 'unified' ? 'unified' : 'unified',
                          key: typeof condition.key === 'string' ? condition.key : '玩家拥有',
                          op: ['==', '!=', '>', '>=', '<', '<='].includes(condition.op) ? condition.op : '==',
                          value: condition.value != null ? condition.value : 1
                      }
                    : { type: 'unified', key: '玩家拥有', op: '==', value: 1 }
            },
            endingCg: {
                source:
                    endingCg.source === 'randomDisplay' || endingCg.randomDisplayModuleId
                        ? 'randomDisplay'
                        : 'relationCg',
                sceneId: typeof endingCg.sceneId === 'string' ? endingCg.sceneId : '',
                stepId: typeof endingCg.stepId === 'string' ? endingCg.stepId : '',
                randomDisplayModuleId:
                    typeof endingCg.randomDisplayModuleId === 'string' ? endingCg.randomDisplayModuleId : '',
                itemIds: Array.isArray(endingCg.itemIds)
                    ? endingCg.itemIds.map(x => String(x || '').trim()).filter(Boolean)
                    : [],
                showUnknown: endingCg.showUnknown !== false
            }
        };
    },

    findModule(project, moduleId) {
        const id = String(moduleId || '').trim();
        if (!id) return null;
        const list = this.normalizeProject(project);
        return list.find(m => m && m.id === id) || null;
    },

    evalUnifiedCondition(ch, cond) {
        if (!ch || !cond || cond.type !== 'unified') return true;
        const charId = String(ch.id || '').trim();
        const key = String(cond.key || '').trim();
        if (!charId || !key || typeof GameState === 'undefined' || !GameState.getUnified) return false;
        const actual = GameState.getUnified(charId, key);
        const want = this._coerceComparable(cond.value);
        const got = this._coerceComparable(actual);
        const op = cond.op || '==';
        if (op === '!=') return got != want;
        if (op === '>') return Number(got) > Number(want);
        if (op === '>=') return Number(got) >= Number(want);
        if (op === '<') return Number(got) < Number(want);
        if (op === '<=') return Number(got) <= Number(want);
        return got == want;
    },

    _coerceComparable(value) {
        if (value === true) return 1;
        if (value === false) return 0;
        const s = String(value == null ? '' : value).trim();
        if (['是', 'true', 'TRUE', '1', 'yes', 'on'].includes(s)) return 1;
        if (['否', 'false', 'FALSE', '0', 'no', 'off'].includes(s)) return 0;
        const n = Number(s);
        return Number.isFinite(n) && s !== '' ? n : s;
    },

    characterSpriteUrl(ch, expressionKey = '') {
        if (!ch || !ch.expressions) return '';
        const keys = Object.keys(ch.expressions).filter(k => !String(k).startsWith('__pending_'));
        const key =
            (expressionKey && ch.expressions[expressionKey] && expressionKey) ||
            (ch.defaultExpression && ch.expressions[ch.defaultExpression] && ch.defaultExpression) ||
            keys[0];
        const slot = key ? ch.expressions[key] : null;
        const alias = slot && slot.spriteAsset ? String(slot.spriteAsset || '').trim() : '';
        if (!alias) return '';
        return typeof AssetManager !== 'undefined' && AssetManager.resolveMediaUrl
            ? AssetManager.resolveMediaUrl('characters', alias) || alias
            : typeof AssetManager !== 'undefined' && AssetManager.getPath
              ? AssetManager.getPath('characters', alias) || alias
              : alias;
    },

    listCharacterItems(project, module) {
        const m = this.normalizeModule(module || {});
        const roster = project && Array.isArray(project.characterRoster) ? project.characterRoster : [];
        return roster
            .filter(ch => {
                if (!ch || !ch.id) return false;
                if (m.character.source === 'type' && m.character.typeIds.length) {
                    if (!m.character.typeIds.includes(String(ch.characterTypeId || '').trim())) return false;
                }
                return this.evalUnifiedCondition(ch, m.character.condition);
            })
            .map(ch => ({
                id: ch.id,
                title: ch.name || ch.id,
                mediaType: 'image',
                src: this.characterSpriteUrl(ch, m.character.expressionKey),
                locked: false
            }));
    },

    unlockKey(moduleId, sourceRowId) {
        return `gallery_cg_unlocked_${String(moduleId || '').trim()}_${String(sourceRowId || '').trim()}`;
    },

    sourceUnlockKey(sceneId, stepId, sourceRowId) {
        return `gallery_cg_source_unlocked_${String(sceneId || '').trim()}_${String(stepId || '').trim()}_${String(sourceRowId || '').trim()}`;
    },

    listEndingCgItems(project, module) {
        const m = this.normalizeModule(module || {});
        const src = this.resolveEndingCgSource(project, m);
        if (!src || !src.step) return [];
        const rows = Array.isArray(src.step.cgVariableMap && src.step.cgVariableMap.relationRows)
            ? src.step.cgVariableMap.relationRows
            : [];
        return rows
            .filter(row => row && (row.sourceRowId || row.id))
            .map((row, index) => {
                const rowId = String(row.sourceRowId || row.id || '').trim();
                const unlocked =
                    typeof GameState !== 'undefined' && GameState.get
                        ? Number(GameState.get(this.unlockKey(m.id, rowId)) || 0) === 1 ||
                          Number(GameState.get(this.sourceUnlockKey(src.scene.id, src.step.id, rowId)) || 0) === 1
                        : false;
                const cg = row.cg && typeof row.cg === 'object' && row.cg.url ? row.cg : src.step.cg || {};
                return {
                    id: rowId,
                    title: row.label || `${row.a || ''} × ${row.b || ''}`.trim() || rowId,
                    subtitle: row.a && row.b ? `${row.a} × ${row.b}` : '',
                    mediaType: cg.mediaType || 'image',
                    src: this.resolveStoryGraphicUrl(cg && cg.url),
                    locked: !unlocked,
                    rawCg: cg,
                    sourceIndex: index
                };
            })
            .sort((a, b) => {
                if (!!a.locked !== !!b.locked) return a.locked ? 1 : -1;
                return (a.sourceIndex || 0) - (b.sourceIndex || 0);
            });
    },

    resolveStoryGraphicUrl(alias) {
        const name = String(alias || '').trim();
        if (!name) return '';
        return typeof AssetManager !== 'undefined' && AssetManager.resolveMediaUrl
            ? AssetManager.resolveMediaUrl('storyGraphics', name) || name
            : typeof AssetManager !== 'undefined' && AssetManager.getPath
              ? AssetManager.getPath('storyGraphics', name) || name
              : name;
    },

    listItems(project, module) {
        const m = this.normalizeModule(module || {});
        if (m.kind !== 'endingCg') return this.listCharacterItems(project, m);
        return m.endingCg && m.endingCg.source === 'randomDisplay'
            ? this.listRandomDisplayCgItems(project, m)
            : this.listEndingCgItems(project, m);
    },

    listRandomDisplayCgItems(project, module) {
        const m = this.normalizeModule(module || {});
        const moduleId = m.endingCg && m.endingCg.randomDisplayModuleId ? String(m.endingCg.randomDisplayModuleId).trim() : '';
        if (!moduleId || typeof RandomDisplayConfig === 'undefined') return [];
        const rdMod = RandomDisplayConfig.findModule(project, moduleId);
        if (!rdMod || !Array.isArray(rdMod.items)) return [];
        const allowIds =
            m.endingCg && Array.isArray(m.endingCg.itemIds) && m.endingCg.itemIds.length
                ? new Set(m.endingCg.itemIds.map(x => String(x || '').trim()).filter(Boolean))
                : null;
        const seenKey =
            typeof RandomDisplayConfig.seenVarKey === 'function'
                ? itemId => RandomDisplayConfig.seenVarKey(rdMod.id, itemId)
                : itemId => `rd_seen_${String(rdMod.id || '').replace(/[^\w]/g, '_')}_${String(itemId || '').replace(/[^\w]/g, '_')}`;
        const isSeen = itemId => {
            if (typeof GameState === 'undefined' || !GameState.get) return false;
            const raw = GameState.get(seenKey(itemId));
            if (raw === true) return true;
            const s = String(raw == null ? '' : raw).trim();
            return s === '1' || s.toLowerCase() === 'true' || s === '是';
        };
        return rdMod.items
            .filter(it => it && it.id && (!allowIds || allowIds.has(String(it.id).trim())))
            .map((it, index) => {
                const rowId = String(it.id || '').trim();
                const unlocked = isSeen(rowId);
                const alias = it.cgAlias != null ? String(it.cgAlias).trim() : '';
                return {
                    id: rowId,
                    title: it.title || rowId,
                    subtitle: it.typeName || '',
                    mediaType: 'image',
                    src: this.resolveStoryGraphicUrl(alias),
                    locked: !unlocked,
                    playbackKind: 'randomDisplay',
                    rdModuleId: rdMod.id,
                    rdItemId: rowId,
                    rdItem: it,
                    rdModule: rdMod,
                    sourceIndex: index
                };
            })
            .sort((a, b) => {
                if (!!a.locked !== !!b.locked) return a.locked ? 1 : -1;
                return (a.sourceIndex || 0) - (b.sourceIndex || 0);
            });
    },

    resolveEndingCgSource(project, module) {
        const m = this.normalizeModule(module || {});
        const scene = (project && Array.isArray(project.scenes) ? project.scenes : []).find(s => s && s.id === m.endingCg.sceneId);
        if (!scene || !Array.isArray(scene.steps)) return null;
        const step = scene.steps.find(st => st && st.id === m.endingCg.stepId) || null;
        return step ? { scene, step } : null;
    },

    recordCgUnlockFromStep(project, scene, originalStep, resolvedStep) {
        if (!project || !scene || !originalStep || originalStep.type !== 'cg') return;
        if (typeof GameState === 'undefined' || !GameState.set) return;
        const cfg = originalStep.cgVariableMap && typeof originalStep.cgVariableMap === 'object' ? originalStep.cgVariableMap : null;
        if (!cfg || cfg.mode !== 'relation') return;
        const table = (project.variableRelationTables || []).find(t => t && t.id === cfg.relationTableId);
        const rawA = table && table.varA ? GameState.get(String(table.varA).trim()) : '';
        const rawB = table && table.varB ? GameState.get(String(table.varB).trim()) : '';
        const row = this.findRelationCgRow(project, cfg, rawA, rawB);
        if (!row) return;
        const rowId = String(row.sourceRowId || row.id || '').trim();
        if (!rowId) return;
        GameState.set(this.sourceUnlockKey(scene.id, originalStep.id, rowId), 1);
        this.normalizeProject(project);
        const modules = (project.galleryModules || []).filter(m => {
            if (!m || m.kind !== 'endingCg') return false;
            return m.endingCg && m.endingCg.sceneId === scene.id && m.endingCg.stepId === originalStep.id;
        });
        modules.forEach(m => {
            GameState.set(this.unlockKey(m.id, rowId), 1);
        });
    },

    findRelationCgRow(project, cfg, rawA, rawB) {
        const table = (project.variableRelationTables || []).find(t => t && t.id === cfg.relationTableId);
        if (!table) return null;
        const setA = this._candidateNames(project, rawA);
        const setB = this._candidateNames(project, rawB);
        const sourceRow = (table.rows || []).find(r => r && setA.has(String(r.a || '').trim()) && setB.has(String(r.b || '').trim()));
        if (!sourceRow) return null;
        const sid = String(sourceRow.id || '').trim();
        return (cfg.relationRows || []).find(r => {
            if (!r) return false;
            if (sid && String(r.sourceRowId || '').trim() === sid) return true;
            return String(r.a || '').trim() === String(sourceRow.a || '').trim() && String(r.b || '').trim() === String(sourceRow.b || '').trim();
        }) || null;
    },

    _candidateNames(project, value) {
        const out = new Set();
        const v = String(value == null ? '' : value).trim();
        if (v) out.add(v);
        const roster = project && Array.isArray(project.characterRoster) ? project.characterRoster : [];
        const ch = roster.find(c => c && (String(c.id || '').trim() === v || String(c.name || '').trim() === v));
        if (ch) {
            if (ch.id) out.add(String(ch.id).trim());
            if (ch.name) out.add(String(ch.name).trim());
        }
        return out;
    }
};

if (typeof window !== 'undefined') {
    window.GalleryConfig = GalleryConfig;
}
