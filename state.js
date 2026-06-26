/**
 * state.js - 游戏全局状态管理
 */
const GameState = {
    // 变量池：存储好感度、开关等
    variables: {
        player_name: "旅人",
        affection: 50,       // 初始好感度
        has_seen_letter: false // 是否看过信件
    },

    runtimeConfig: {},
    debugLog: [],

    _log(type, detail) {
        try {
            let sceneId = '';
            let stepIndex = '';
            let stepId = '';
            let stepLabel = '';
            let stepType = '';
            if (typeof SceneManager !== 'undefined') {
                sceneId = SceneManager.currentSceneId || '';
                stepIndex = Number.isFinite(Number(SceneManager.currentStepIndex)) ? Number(SceneManager.currentStepIndex) : '';
                const step = SceneManager.getCurrentStep ? SceneManager.getCurrentStep() : null;
                stepId = step && step.id ? String(step.id) : '';
                stepLabel = step && step.labelSuffix ? String(step.labelSuffix) : '';
                stepType = step && step.type ? String(step.type) : '';
            }
            this.debugLog.push({ t: Date.now(), type, detail, sceneId, stepIndex, stepId, stepLabel, stepType });
            if (this.debugLog.length > 400) this.debugLog.splice(0, this.debugLog.length - 400);
        } catch {}
    },

    /** 角色属性（隐藏，不在游戏 UI 展示） */
    characters: {
        /** [charId]: { unified:{}, relations:{ [targetId]: { affection:number } } } */
    },
    sceneAppearances: {},
    stepAppearances: {},
    /** 步骤片段 id → 是否已出现过（进入片段首步时置 1） */
    fragmentAppearances: {},
    /** 选项/随机「权重调整」累计增量：key = sceneId\x1elabelSuffix\x1estepType\x1eitemIndex */
    randomWeightDeltas: {},
    loveGroups: {},
    loveGroupMembership: {},

    _weightAdjKey(sceneId, labelSuffix, stepType, itemIndex) {
        return `${String(sceneId || '')}\x1e${String(labelSuffix || '')}\x1e${stepType}\x1e${Number(itemIndex)}`;
    },

    /** @param {Array<{sceneId:string,labelSuffix:string,stepType?:string,itemIndex:number,delta:number}>} list */
    applyWeightAdjustments(list) {
        if (!Array.isArray(list)) return;
        list.forEach(adj => {
            if (!adj || adj.sceneId == null || adj.labelSuffix == null || adj.itemIndex == null) return;
            const st = adj.stepType === 'choice' ? 'choice' : 'random';
            const k = this._weightAdjKey(adj.sceneId, adj.labelSuffix, st, adj.itemIndex);
            const d = Number(adj.delta);
            if (!Number.isFinite(d) || d === 0) return;
            this.randomWeightDeltas[k] = (this.randomWeightDeltas[k] || 0) + d;
        });
    },

    getRandomWeightAdjustment(sceneId, labelSuffix, itemIndex) {
        const k = this._weightAdjKey(sceneId, labelSuffix, 'random', itemIndex);
        const v = this.randomWeightDeltas[k];
        return Number.isFinite(v) ? v : 0;
    },

    clamp01_100(n) {
        const x = Number(n);
        if (!Number.isFinite(x)) return 0;
        return Math.max(0, Math.min(100, Math.round(x)));
    },

    random() {
        return Math.random();
    },

    /** 初始化角色属性：统一属性 + 关系属性 + 存在 */
    initCharacterState(project) {
        this.sceneAppearances = {};
        this.stepAppearances = {};
        this.fragmentAppearances = {};
        this.randomWeightDeltas = {};
        this.loveGroups = {};
        this.loveGroupMembership = {};
        this.characters = {};
        this._projectData = project || null;
        const roster = (project && project.characterRoster) || [];
        const unifiedDefs = (project && project.unifiedAttributes) || [];
        const relDefs = (project && project.relationAttributes) || {};
        const defaults = {};
        unifiedDefs.forEach(d => {
            if (!d || !d.key) return;
            defaults[d.key] = d.type === 'bool' ? !!d.default : Number(d.default) || 0;
        });
        // 系统保留统一属性：存在
        defaults['存在'] = true;

        roster.forEach(c => {
            const id = c.id;
            if (!id) return;
            const base = { unified: { ...defaults }, relations: {} };
            // 单角色覆盖统一初始值
            if (c.unifiedOverrides && typeof c.unifiedOverrides === 'object') {
                Object.keys(c.unifiedOverrides).forEach(k => {
                    base.unified[k] = c.unifiedOverrides[k];
                });
            }
            // 关系初始值（只做 affection）
            const map = relDefs[id] || {};
            Object.keys(map).forEach(targetId => {
                const row = map[targetId];
                const v = row && row.affection != null ? row.affection : 0;
                base.relations[targetId] = { affection: this.clamp01_100(v) };
            });
            this.characters[id] = base;
        });
        const scenes = (project && project.scenes) || [];
        scenes.forEach(scene => {
            if (!scene || !scene.id) return;
            const seen = Number(scene.appearedValue) ? 1 : 0;
            this.sceneAppearances[scene.id] = seen;
            this.set(`scene_seen_${scene.id}`, seen);
            (scene.steps || []).forEach(step => {
                if (!step || !step.id) return;
                const stepSeen = Number(step.appearedValue) ? 1 : 0;
                this.stepAppearances[step.id] = stepSeen;
                this.set(`step_seen_${step.id}`, stepSeen);
            });
        });
        // 新游戏：清空随机展示 / 话题池「已见过」标记
        Object.keys(this.variables).forEach(k => {
            const key = String(k);
            if (key.startsWith('rd_seen_') || key.startsWith('tp_seen_')) delete this.variables[k];
        });
    },

    markSceneAppeared(sceneId) {
        if (!sceneId) return;
        this.sceneAppearances[sceneId] = 1;
        this.set(`scene_seen_${sceneId}`, 1);
    },

    markStepAppeared(stepId) {
        if (!stepId) return;
        this.stepAppearances[stepId] = 1;
        this.set(`step_seen_${stepId}`, 1);
    },

    markFragmentAppeared(fragmentId) {
        if (!fragmentId) return;
        if (!this.fragmentAppearances) this.fragmentAppearances = {};
        this.fragmentAppearances[fragmentId] = 1;
        this.set(`fragment_seen_${fragmentId}`, 1);
    },

    setAppearance(targetType, targetId, value) {
        const v = Number(value) ? 1 : 0;
        if (targetType === 'scene') {
            if (!targetId) return;
            this.sceneAppearances[targetId] = v;
            this.set(`scene_seen_${targetId}`, v);
            return;
        }
        if (targetType === 'fragment' || targetType === 'stepFragment') {
            if (!targetId) return;
            if (!this.fragmentAppearances) this.fragmentAppearances = {};
            this.fragmentAppearances[targetId] = v;
            this.set(`fragment_seen_${targetId}`, v);
            return;
        }
        if (!targetId) return;
        this.stepAppearances[targetId] = v;
        this.set(`step_seen_${targetId}`, v);
    },

    getRelationAffection(fromId, toId) {
        const c = this.characters[fromId];
        if (!c || !c.relations || !c.relations[toId]) return 0;
        return this.clamp01_100(c.relations[toId].affection);
    },

    addRelationAffection(fromId, toId, delta) {
        if (!fromId || !toId || fromId === toId) return;
        if (!this.characters[fromId]) this.characters[fromId] = { unified: { 存在: true }, relations: {} };
        const c = this.characters[fromId];
        if (!c.relations[toId]) c.relations[toId] = { affection: 0 };
        const prev = this.clamp01_100(c.relations[toId].affection || 0);
        const next = this.clamp01_100(prev + (Number(delta) || 0));
        c.relations[toId].affection = next;
        this._log('relation', { from: fromId, to: toId, prev, next, delta: Number(delta) || 0 });
    },

    setRelationAffection(fromId, toId, value) {
        if (!fromId || !toId || fromId === toId) return;
        if (!this.characters[fromId]) this.characters[fromId] = { unified: { 瀛樺湪: true }, relations: {} };
        const c = this.characters[fromId];
        if (!c.relations[toId]) c.relations[toId] = { affection: 0 };
        const prev = this.clamp01_100(c.relations[toId].affection || 0);
        const next = this.clamp01_100(value);
        c.relations[toId].affection = next;
        this._log('relation', { from: fromId, to: toId, prev, next, op: 'set' });
    },

    getUnified(charId, key) {
        this.ensureCharacterUnified(charId, key);
        const c = this.characters[charId];
        if (!c || !c.unified) return null;
        return c.unified[key];
    },

    setUnified(charId, key, val) {
        if (!charId || !key) return;
        this.ensureCharacterUnified(charId, key);
        if (!this.characters[charId]) this.characters[charId] = { unified: { 存在: true }, relations: {} };
        const prev = this.characters[charId].unified[key];
        this.characters[charId].unified[key] = val;
        this._log('unified', { charId, key, prev, next: val });
    },

    resolveCharacterRef(ref) {
        let v = String(ref || '').trim();
        const m = v.match(/^\{([^}]+)\}$/);
        if (m && typeof this.get === 'function') v = String(this.get(String(m[1] || '').trim()) || '').trim();
        if (!v) return '';
        const project = this._projectData || (typeof SceneManager !== 'undefined' ? SceneManager.storyData : null);
        const roster = (project && project.characterRoster) || [];
        const hit =
            roster.find(c => c && String(c.id || '').trim() === v) ||
            roster.find(c => c && String(c.name || '').trim() === v);
        return hit ? hit.id : v;
    },

    getUnifiedInitialValue(charId, key) {
        const project = this._projectData || (typeof SceneManager !== 'undefined' ? SceneManager.storyData : null);
        if (key === '存在') return true;
        const defs = (project && project.unifiedAttributes) || [];
        const def = defs.find(d => d && d.key === key);
        let value = def ? (def.type === 'bool' ? !!def.default : Number(def.default) || 0) : 0;
        const roster = (project && project.characterRoster) || [];
        const ch = roster.find(c => c && c.id === charId);
        if (ch && ch.unifiedOverrides && Object.prototype.hasOwnProperty.call(ch.unifiedOverrides, key)) {
            value = ch.unifiedOverrides[key];
        }
        return value;
    },

    ensureCharacterUnified(charId, key) {
        if (!charId) return;
        if (!this.characters[charId]) this.characters[charId] = { unified: {}, relations: {} };
        if (!this.characters[charId].unified) this.characters[charId].unified = {};
        if (!Object.prototype.hasOwnProperty.call(this.characters[charId].unified, '存在')) {
            this.characters[charId].unified['存在'] = this.getUnifiedInitialValue(charId, '存在');
        }
        if (key && !Object.prototype.hasOwnProperty.call(this.characters[charId].unified, key)) {
            this.characters[charId].unified[key] = this.getUnifiedInitialValue(charId, key);
        }
    },

    applyEffects(effects) {
        const list = Array.isArray(effects) ? effects : [];
        let touchedAttrOrRelation = false;
        list.forEach(e => {
            if (!e || typeof e !== 'object') return;
            if (e.kind === 'var') {
                const cur = Number(this.get(e.var)) || 0;
                if (e.op === 'add') this.set(e.var, cur + (Number(e.val) || 0));
                else if (e.op === 'mul') {
                    const m = Number(e.val);
                    this.set(e.var, Number.isFinite(m) ? cur * m : cur);
                } else if (e.op === 'set') this.set(e.var, e.val);
                return;
            }
            if (e.kind === 'relation') {
                const fromId = this.resolveCharacterRef(e.from);
                const toId = this.resolveCharacterRef(e.to);
                if (e.op === 'set') this.setRelationAffection(fromId, toId, e.delta);
                else this.addRelationAffection(fromId, toId, e.delta);
                touchedAttrOrRelation = true;
                return;
            }
            if (e.kind === 'unified') {
                const charId = this.resolveCharacterRef(e.charId);
                if (e.op === 'set') this.setUnified(charId, e.key, e.val);
                else if (e.op === 'add') {
                    const cur = Number(this.getUnified(charId, e.key)) || 0;
                    this.setUnified(charId, e.key, cur + (Number(e.val) || 0));
                } else if (e.op === 'mul') {
                    const cur = Number(this.getUnified(charId, e.key)) || 0;
                    const m = Number(e.val);
                    this.setUnified(charId, e.key, Number.isFinite(m) ? cur * m : cur);
                }
                touchedAttrOrRelation = true;
                return;
            }
            if (e.kind === 'loveGroup') {
                if (typeof LoveGroupManager !== 'undefined' && LoveGroupManager.applyEffect) {
                    const res = LoveGroupManager.applyEffect(e);
                    this._log('loveGroup', { effect: e, result: res });
                    touchedAttrOrRelation = true;
                }
                return;
            }
            if (e.kind === 'appearance') {
                const tt = e.targetType;
                if (tt === 'stepFragment' || tt === 'fragment') {
                    const fid = e.fragmentId || e.targetId || '';
                    if (fid) this.setAppearance('fragment', fid, e.val);
                    return;
                }
                const isScene = tt === 'scene';
                let id = '';
                if (isScene) id = e.sceneId || e.targetId || '';
                else {
                    id = e.targetId || '';
                    if (
                        e.sceneId &&
                        typeof SceneManager !== 'undefined' &&
                        SceneManager.resolveStepIdFromSceneLabel
                    ) {
                        const suf = e.labelSuffix != null ? String(e.labelSuffix) : '';
                        const resolved = SceneManager.resolveStepIdFromSceneLabel(e.sceneId, suf);
                        if (resolved) id = resolved;
                    }
                }
                this.setAppearance(isScene ? 'scene' : 'step', id, e.val);
            }
        });
        if (touchedAttrOrRelation && typeof SceneManager !== 'undefined' && SceneManager.maybeTriggerAutoAnnouncement) {
            SceneManager.maybeTriggerAutoAnnouncement('effects');
        }
    },

    // 获取变量值
    get(key) {
        return this.variables[key];
    },

    // 设置变量值
    set(key, value) {
        const prev = this.variables[key];
        this.variables[key] = value;
        console.log(`变量更新: ${key} = ${value}`);
        this._log('var', { key, prev, next: value, value });
    },

    _resolveTextTokenValue(raw) {
        const key = String(raw || '').trim();
        if (!key) return '';
        const v = this.get(key);
        if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
        return key;
    },

    _characterNamesForRelationLookup(raw) {
        const value = this._resolveTextTokenValue(raw);
        const names = [];
        const add = v => {
            const s = String(v || '').trim();
            if (s && !names.includes(s)) names.push(s);
        };
        add(value);
        const roster = this._projectData && Array.isArray(this._projectData.characterRoster)
            ? this._projectData.characterRoster
            : [];
        const hit = roster.find(c => c && (String(c.id || '').trim() === value || String(c.name || '').trim() === value));
        if (hit) {
            add(hit.name);
            add(hit.id);
        }
        return names;
    },

    _parseRelationMapRows(text) {
        const rows = [];
        String(text || '')
            .split(/\r?\n/)
            .forEach(line => {
                const raw = String(line || '').trim();
                if (!raw || raw.startsWith('#') || raw.startsWith('//')) return;
                const m = raw.match(/^(.+?)(?:->|=>|[:：=])(.+)$/);
                if (!m) return;
                const source = String(m[1] || '').trim();
                const targets = String(m[2] || '')
                    .split(/[、,，;；|\/]+/)
                    .map(s => s.trim())
                    .filter(Boolean);
                if (source && targets.length) rows.push({ source, targets });
            });
        return rows;
    },

    _relationMapRowsFromProject() {
        const project = this._projectData || {};
        const rows = [];
        const scenes = Array.isArray(project.scenes) ? project.scenes : [];
        scenes.forEach(scene => {
            (Array.isArray(scene && scene.steps) ? scene.steps : []).forEach(step => {
                if (!step || step.type !== 'relationRandom') return;
                this._parseRelationMapRows(step.relationMapText).forEach(row => rows.push(row));
            });
        });
        return rows;
    },

    getRelationMapSourceForTarget(rawTarget) {
        const targetNames = this._characterNamesForRelationLookup(rawTarget);
        if (!targetNames.length) return '';
        const targetSet = new Set(targetNames);
        const rows = this._relationMapRowsFromProject();
        for (const row of rows) {
            if ((row.targets || []).some(name => targetSet.has(String(name || '').trim()))) {
                return row.source || '';
            }
        }
        return '';
    },

    getRelationMapTargetsForSource(rawSource) {
        const sourceNames = this._characterNamesForRelationLookup(rawSource);
        if (!sourceNames.length) return '';
        const sourceSet = new Set(sourceNames);
        const out = [];
        this._relationMapRowsFromProject().forEach(row => {
            if (!sourceSet.has(String(row.source || '').trim())) return;
            (row.targets || []).forEach(name => {
                if (name && !out.includes(name)) out.push(name);
            });
        });
        return out.join('、');
    },

    // 动态文本解析核心：处理 {if...else...}、{好感:…} 和 {variable}
    parseText(text, ctx) {
        ctx = ctx || {};
        // 1. 处理 {if condition} text {else} text {endif}
        // 匹配模式: {if 变量 > 值} 文本A {else} 文本B {endif}
        const ifRegex = /\{if (.*?) ([\>\<\=]+) (.*?)\} (.*?) \{else\} (.*?) \{endif\}/g;
        let processedText = text.replace(ifRegex, (match, varName, op, value, trueText, falseText) => {
            const currentVal = this.get(varName);
            const targetVal = parseFloat(value);
            let conditionMet = false;

            if (op === '>') conditionMet = currentVal > targetVal;
            else if (op === '<') conditionMet = currentVal < targetVal;
            else if (op === '=') conditionMet = currentVal == targetVal;

            return conditionMet ? trueText : falseText;
        });

        // 2. 好感占位：{好感:对方角色id} 以当前说话人为来源；{好感:来源id,对方id} 显式两角
        processedText = processedText.replace(/\{好感:([^,}]+)(?:,([^}]+))?\}/g, (m, a, b) => {
            const partA = String(a || '').trim();
            const partB = b != null ? String(b).trim() : '';
            let fromId = '';
            let toId = '';
            if (partB) {
                fromId = partA;
                toId = partB;
            } else {
                fromId = ctx.speakerId ? String(ctx.speakerId).trim() : '';
                toId = partA;
            }
            if (!fromId || !toId) return m;
            return String(this.getRelationAffection(fromId, toId));
        });

        // 2b. 统一属性占位：{统一:人物id,属性键}（人物 id 为 roster 中的 id，如玩家角色；键与项目「统一属性」配置一致，如「分数」）
        processedText = processedText.replace(/\{统一:([^,}]+),([^}]+)\}/g, (m, charIdRaw, keyRaw) => {
            const charId = String(charIdRaw || '').trim();
            const key = String(keyRaw || '').trim();
            if (!charId || !key) return m;
            const v = this.getUnified(charId, key);
            if (v === null || v === undefined) return m;
            if (typeof v === 'boolean') return v ? '是' : '否';
            return String(v);
        });

        // 3. 处理简单的变量替换 {player_name}
        processedText = processedText.replace(/\{梦中情人:([^}]+)\}/g, (m, rawTarget) => {
            const v = this.getRelationMapSourceForTarget(rawTarget);
            return v || m;
        });

        const varRegex = /\{(.*?)\}/g;
        processedText = processedText.replace(varRegex, (match, varName) => {
            return this.get(varName) !== undefined ? this.get(varName) : match;
        });

        return processedText;
    }
};
