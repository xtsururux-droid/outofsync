/**
 * topic-pool-config.js - 自由发言话题池：模块数据、条目解析、基础校验。
 */
const TopicPoolConfig = {
    seenVarKey(moduleId, itemId) {
        return `tp_seen_${String(moduleId || '').replace(/[^\w]/g, '_')}_${String(itemId || '').replace(/[^\w]/g, '_')}`;
    },

    normalizeProject(project) {
        if (!project || typeof project !== 'object') return;
        if (!Array.isArray(project.topicPoolModules)) project.topicPoolModules = [];
        project.topicPoolModules = project.topicPoolModules
            .filter(m => m && typeof m === 'object')
            .map((m, i) => this.normalizeModule(m, i));
    },

    normalizeModule(module, index = 0) {
        const id = String(module.id || '').trim() || `tpmod_${index + 1}`;
        const name = String(module.name || '').trim() || id;
        const items = Array.isArray(module.items)
            ? module.items.filter(it => it && typeof it === 'object').map((it, i) => this.normalizeItem(it, i))
            : [];
        return {
            ...module,
            id,
            name,
            enabled: module.enabled !== false,
            skipMissingSpeaker: module.skipMissingSpeaker !== false,
            requirePresentSpeakers: !!module.requirePresentSpeakers,
            backgroundAlias: String(module.backgroundAlias || '').trim(),
            musicAlias: String(module.musicAlias || '').trim(),
            musicLoop: module.musicLoop !== false,
            condition: 'condition' in module ? module.condition : null,
            exhaustedMessage: String(module.exhaustedMessage || ''),
            items
        };
    },

    normalizeItem(item, index = 0) {
        const id = String(item.id || '').trim() || `tpitem_${index + 1}`;
        const rawText = String(item.rawText || '').replace(/\r\n/g, '\n');
        const steps = Array.isArray(item.steps) ? item.steps.filter(Boolean) : [];
        return {
            ...item,
            id,
            title: String(item.title || '').trim(),
            enabled: item.enabled !== false,
            rawText,
            condition: 'condition' in item ? item.condition : null,
            steps
        };
    },

    getRoster(project) {
        return project && Array.isArray(project.characterRoster) ? project.characterRoster.filter(Boolean) : [];
    },

    findCharacter(project, value) {
        const key = String(value || '').trim();
        if (!key) return null;
        return this.getRoster(project).find(c => {
            return String(c.id || '').trim() === key || String(c.name || '').trim() === key;
        }) || null;
    },

    parseSpeakerToken(project, token) {
        const raw = String(token || '').trim();
        if (!raw) return null;
        const exact = this.findCharacter(project, raw);
        if (exact) {
            const emotion = String(exact.defaultExpression || 'neutral').trim() || 'neutral';
            return {
                raw,
                character: exact,
                speakerRef: exact.id || exact.name || raw,
                speakerName: exact.name || exact.id || raw,
                emotion,
                requestedEmotion: '',
                expressionExists: !!(exact.expressions && exact.expressions[emotion])
            };
        }
        const roster = this.getRoster(project)
            .map(c => ({
                character: c,
                name: String(c.name || '').trim(),
                id: String(c.id || '').trim()
            }))
            .filter(c => c.name || c.id)
            .sort((a, b) => Math.max(b.name.length, b.id.length) - Math.max(a.name.length, a.id.length));
        for (const entry of roster) {
            const candidates = [entry.name, entry.id].filter(Boolean).sort((a, b) => b.length - a.length);
            for (const name of candidates) {
                if (!raw.startsWith(name) || raw.length <= name.length) continue;
                const requestedEmotion = raw.slice(name.length).trim();
                if (!requestedEmotion) continue;
                const ch = entry.character;
                const defaultEmotion = String(ch.defaultExpression || 'neutral').trim() || 'neutral';
                const expressions = ch.expressions && typeof ch.expressions === 'object' ? ch.expressions : {};
                const fullEmotion = raw;
                const fullExpressionExists = !!expressions[fullEmotion];
                const shortExpressionExists = !!expressions[requestedEmotion];
                const expressionExists = fullExpressionExists || shortExpressionExists;
                const emotion = fullExpressionExists ? fullEmotion : shortExpressionExists ? requestedEmotion : defaultEmotion;
                return {
                    raw,
                    character: ch,
                    speakerRef: ch.id || ch.name || name,
                    speakerName: ch.name || ch.id || name,
                    emotion,
                    requestedEmotion,
                    expressionExists
                };
            }
        }
        return {
            raw,
            character: null,
            speakerRef: raw,
            speakerName: raw,
            emotion: '',
            requestedEmotion: '',
            expressionExists: false
        };
    },

    parseEntryText(project, rawText) {
        const text = String(rawText || '').replace(/\r\n/g, '\n');
        const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
        const steps = [];
        const warnings = [];
        const speakers = [];
        const hasTopicLine = lines.some(line => {
            const m = line.match(/^(.+?)[：:]\s*(.*)$/);
            return m && String(m[1] || '').trim() === '话题';
        });
        let titleFromTopic = '';
        let legacyTitleNarrationSkipped = false;
        lines.forEach((line, index) => {
            const m = line.match(/^(.+?)[：:]\s*(.*)$/);
            if (!m) {
                warnings.push({ line: index + 1, type: 'format', message: '未识别到冒号，已跳过。', text: line });
                return;
            }
            const head = String(m[1] || '').trim();
            const body = String(m[2] || '').trim();
            if (head === '话题') {
                if (!titleFromTopic) titleFromTopic = body;
                return;
            }
            if (head === '旁白') {
                if (!hasTopicLine && !legacyTitleNarrationSkipped && !steps.length) {
                    if (!titleFromTopic) titleFromTopic = body;
                    legacyTitleNarrationSkipped = true;
                    return;
                }
                steps.push({ type: 'narration', text: body });
                return;
            }
            const speaker = this.parseSpeakerToken(project, head);
            if (!speaker || !speaker.character) {
                warnings.push({ line: index + 1, type: 'missing-speaker', message: `人物不存在：${head}`, text: line });
                steps.push({ type: 'dialogue', speakerRef: head, speakerName: head, expression: '', text: body, missingSpeaker: true });
                return;
            }
            if (speaker.requestedEmotion && !speaker.expressionExists) {
                warnings.push({
                    line: index + 1,
                    type: 'missing-expression',
                    message: `${speaker.speakerName} 没有「${speaker.requestedEmotion}」立绘，已使用默认立绘。`,
                    text: line
                });
            }
            speakers.push(speaker.speakerRef);
            steps.push({
                type: 'dialogue',
                speakerRef: speaker.speakerRef,
                speakerName: speaker.speakerName,
                expression: speaker.emotion,
                requestedExpression: speaker.requestedEmotion,
                text: body,
                missingSpeaker: false,
                expressionFallback: !!(speaker.requestedEmotion && !speaker.expressionExists)
            });
        });
        const firstDialogue = steps.find(st => st && st.type === 'dialogue' && String(st.text || '').trim());
        const title = titleFromTopic
            ? titleFromTopic
            : firstDialogue
              ? `${firstDialogue.speakerName || firstDialogue.speakerRef}：${firstDialogue.text}`
              : '';
        if (titleFromTopic) {
            const titleText = String(titleFromTopic).trim();
            const dup =
                steps.length &&
                steps[0].type === 'narration' &&
                String(steps[0].text || '').trim() === titleText;
            if (!dup) steps.unshift({ type: 'narration', text: titleText, isTopicTitle: true });
        }
        return {
            title: String(title || '').slice(0, 80),
            steps,
            warnings,
            speakers: [...new Set(speakers)]
        };
    },

    updateItemFromRawText(project, item, rawText) {
        const parsed = this.parseEntryText(project, rawText);
        item.rawText = String(rawText || '').replace(/\r\n/g, '\n');
        item.title = item.title || parsed.title;
        item.steps = parsed.steps;
        item.speakers = parsed.speakers;
        item.parseWarnings = parsed.warnings;
        return parsed;
    },

    listAvailableItems(project, module) {
        if (!module || module.enabled === false) return [];
        if (module.condition && typeof SceneManager !== 'undefined' && typeof SceneManager.evalCondition === 'function') {
            if (!SceneManager.evalCondition(module.condition)) return [];
        }
        const items = Array.isArray(module.items) ? module.items : [];
        return items.filter(item => {
            if (!item || item.enabled === false || !item.id) return false;
            if (item.condition && typeof SceneManager !== 'undefined' && typeof SceneManager.evalCondition === 'function') {
                if (!SceneManager.evalCondition(item.condition)) return false;
            }
            if (module.requirePresentSpeakers) {
                const missing = (item.steps || []).some(st => st && st.type === 'dialogue' && st.missingSpeaker);
                if (missing) return false;
            }
            return true;
        });
    },

    findModule(project, moduleId) {
        const id = String(moduleId || '').trim();
        const list = project && Array.isArray(project.topicPoolModules) ? project.topicPoolModules : [];
        return id ? list.find(m => m && m.id === id) || null : null;
    },

    pickModuleItem(project, step) {
        const module = this.findModule(project, step && step.topicPoolModuleId);
        if (!module) return { module: null, item: null };
        if (module.enabled === false) return { module, item: null };
        if (module.condition && typeof SceneManager !== 'undefined' && typeof SceneManager.evalCondition === 'function') {
            if (!SceneManager.evalCondition(module.condition)) return { module, item: null };
        }
        if (step && step.topicPoolMode === 'direct') {
            const itemId = String(step.topicPoolItemId || '').trim();
            const item = itemId && Array.isArray(module.items) ? module.items.find(it => it && it.id === itemId) || null : null;
            if (!item || item.enabled === false) return { module, item: null };
            if (item.condition && typeof SceneManager !== 'undefined' && typeof SceneManager.evalCondition === 'function') {
                if (!SceneManager.evalCondition(item.condition)) return { module, item: null };
            }
            if (step.topicPoolPickMode !== 'randomAll' && typeof GameState !== 'undefined' && GameState.get) {
                if (Number(GameState.get(this.seenVarKey(module.id, item.id)) || 0) === 1) return { module, item: null };
            }
            if (item && (!Array.isArray(item.steps) || !item.steps.length) && item.rawText) {
                this.updateItemFromRawText(project, item, item.rawText);
            }
            return { module, item };
        }
        const available = this.listAvailableItems(project, module);
        const mode = step && step.topicPoolPickMode === 'randomAll' ? 'randomAll' : 'randomUnseen';
        const unseen = available.filter(item => {
            if (mode === 'randomAll') return true;
            if (typeof GameState === 'undefined' || !GameState.get) return true;
            return Number(GameState.get(this.seenVarKey(module.id, item.id)) || 0) !== 1;
        });
        const pool = mode === 'randomAll' ? available : unseen;
        if (!pool.length) return { module, item: null };
        const r = typeof GameState !== 'undefined' && GameState.random ? GameState.random() : Math.random();
        const ix = Math.max(0, Math.min(pool.length - 1, Math.floor(r * pool.length)));
        const item = pool[ix];
        if (item && (!Array.isArray(item.steps) || !item.steps.length) && item.rawText) {
            this.updateItemFromRawText(project, item, item.rawText);
        }
        return { module, item };
    },

    markItemSeen(module, item) {
        if (!module || !item || !item.id) return;
        if (typeof GameState !== 'undefined' && GameState.set) {
            GameState.set(this.seenVarKey(module.id, item.id), 1);
        }
    }
};
