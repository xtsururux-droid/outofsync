/**
 * quiz-config.js - 通用问答小游戏：项目 JSON 结构与运行时解析
 * 与编辑器「问答」页写入的 project.quizGames 一致。
 */
const QuizGameConfig = {
    _defaultOptionKey(i) {
        if (i >= 0 && i < 26) return String.fromCharCode(65 + i);
        return `opt_${i + 1}`;
    },

    normalizeProject(project) {
        if (!project || typeof project !== 'object') return;
        if (!Array.isArray(project.quizGames)) project.quizGames = [];
        project.quizGames = project.quizGames
            .filter(g => g && typeof g === 'object')
            .map((g, i) => this.normalizeGame(g, i));
    },

    normalizeGame(g, idx) {
        const id = g.id && String(g.id).trim() ? String(g.id).trim() : `quiz_${idx + 1}`;
        const name = g.name != null ? String(g.name) : '';
        const scoreVarName =
            g.scoreVarName != null && String(g.scoreVarName).trim()
                ? String(g.scoreVarName).trim()
                : 'quiz_score';
        const returnCodeVarName =
            g.returnCodeVarName != null && String(g.returnCodeVarName).trim()
                ? String(g.returnCodeVarName).trim()
                : 'quiz_return_code';
        const scoreTargetCharId =
            g.scoreTargetCharId != null && String(g.scoreTargetCharId).trim()
                ? String(g.scoreTargetCharId).trim()
                : '';
        const scoreTargetKey =
            g.scoreTargetKey != null && String(g.scoreTargetKey).trim()
                ? String(g.scoreTargetKey).trim()
                : '';
        const dfl = g.defaults && typeof g.defaults === 'object' ? g.defaults : {};
        const fx = g.fixed && typeof g.fixed === 'object' ? g.fixed : {};
        const defaults = {
            correctPoints: Number.isFinite(Number(dfl.correctPoints)) ? Number(dfl.correctPoints) : 1,
            wrongPoints: Number.isFinite(Number(dfl.wrongPoints)) ? Number(dfl.wrongPoints) : -1,
            backgroundAlias: dfl.backgroundAlias != null ? String(dfl.backgroundAlias) : '',
            bgmAlias: dfl.bgmAlias != null ? String(dfl.bgmAlias) : ''
        };
        const fixed = {
            correctPoints: fx.correctPoints !== false,
            wrongPoints: fx.wrongPoints !== false,
            background: fx.background !== false,
            bgm: fx.bgm !== false
        };
        const fb = g.feedbackTemplates && typeof g.feedbackTemplates === 'object' ? g.feedbackTemplates : {};
        const normalizeLines = (v, fallback) => {
            const arr = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\r?\n/) : [];
            const out = arr.map(x => String(x || '').trim()).filter(Boolean);
            return out.length ? out : fallback.slice();
        };
        const feedbackTemplates = {
            correct: normalizeLines(fb.correct, ['回答正确，给你加X分。']),
            wrong: normalizeLines(fb.wrong, ['错啦错啦，扣掉X分，不好意思啦。'])
        };
        let routes = Array.isArray(g.returnRoutes) ? g.returnRoutes : [];
        routes = routes
            .filter(r => r && typeof r === 'object')
            .map(r => ({
                code: Number(r.code) || 0,
                note: r.note != null ? String(r.note) : '',
                sceneId: r.sceneId != null ? String(r.sceneId) : '',
                labelSuffix: r.labelSuffix != null ? String(r.labelSuffix) : ''
            }));
        const questions = Array.isArray(g.questions)
            ? g.questions.filter(q => q && typeof q === 'object').map((q, qi) => this.normalizeQuestion(q, qi))
            : [];
        return {
            ...g,
            id,
            name: name || id,
            scoreVarName,
            scoreTargetCharId,
            scoreTargetKey,
            returnCodeVarName,
            entrySceneId: g.entrySceneId != null ? String(g.entrySceneId) : '',
            returnRouterSceneId: g.returnRouterSceneId != null ? String(g.returnRouterSceneId) : '',
            exhaustedMessage: g.exhaustedMessage != null ? String(g.exhaustedMessage) : '',
            exhaustedGotoReturnRouter: g.exhaustedGotoReturnRouter !== false,
            defaults,
            fixed,
            feedbackTemplates,
            returnRoutes: routes,
            questions
        };
    },

    normalizeQuestion(q, qi) {
        const id = q.id && String(q.id).trim() ? String(q.id).trim() : `q${qi + 1}`;
        const oldOptions = [
            { key: 'A', text: q.optionA != null ? String(q.optionA) : '' },
            { key: 'B', text: q.optionB != null ? String(q.optionB) : '' },
            { key: 'C', text: q.optionC != null ? String(q.optionC) : '' },
            { key: 'D', text: q.optionD != null ? String(q.optionD) : '' }
        ].filter(x => String(x.text || '').trim() !== '');
        const incoming = Array.isArray(q.options)
            ? q.options
                  .filter(Boolean)
                  .map((op, i) => ({
                      key:
                          op && op.key != null && String(op.key).trim() !== ''
                              ? String(op.key).trim()
                              : this._defaultOptionKey(i),
                      text: op && op.text != null ? String(op.text) : ''
                  }))
                  .filter(op => String(op.text || '').trim() !== '')
            : [];
        const options = incoming.length ? incoming : oldOptions.length ? oldOptions : [{ key: this._defaultOptionKey(0), text: '' }];
        const defaultCorrect = options[0] ? options[0].key : 'A';
        const cRaw = q.correct != null ? String(q.correct).trim() : defaultCorrect;
        const correct = options.some(op => op.key === cRaw) ? cRaw : defaultCorrect;
        const numOrNull = v => {
            if (v === '' || v === undefined || v === null) return null;
            const n = Number(v);
            return Number.isFinite(n) ? n : null;
        };
        return {
            id,
            prompt: q.prompt != null ? String(q.prompt) : '',
            options,
            correct,
            correctPoints: numOrNull(q.correctPoints),
            wrongPoints: numOrNull(q.wrongPoints),
            backgroundAlias:
                q.backgroundAlias != null && String(q.backgroundAlias).trim() !== ''
                    ? String(q.backgroundAlias).trim()
                    : null,
            bgmAlias:
                q.bgmAlias != null && String(q.bgmAlias).trim() !== '' ? String(q.bgmAlias).trim() : null,
            hintCorrect: q.hintCorrect != null ? String(q.hintCorrect) : '',
            hintWrong: q.hintWrong != null ? String(q.hintWrong) : '',
            // 兼容旧导出字段（只读备份）
            optionA: q.optionA != null ? String(q.optionA) : '',
            optionB: q.optionB != null ? String(q.optionB) : '',
            optionC: q.optionC != null ? String(q.optionC) : '',
            optionD: q.optionD != null ? String(q.optionD) : ''
        };
    },

    listGames(project) {
        if (!project || !Array.isArray(project.quizGames)) return [];
        return project.quizGames.filter(Boolean);
    },

    findGame(project, gameId) {
        if (!gameId) return null;
        return this.listGames(project).find(g => g.id === gameId) || null;
    },

    findQuestion(game, questionId) {
        if (!game || !Array.isArray(game.questions)) return null;
        return game.questions.find(q => q && q.id === questionId) || null;
    },

    /**
     * 合并本题的覆盖项与模块默认值（供运行时抽题、判分、换背景/BGM）
     */
    effectiveQuestion(game, q) {
        if (!game || !q) {
            return {
                correctPoints: 0,
                wrongPoints: 0,
                backgroundAlias: '',
                bgmAlias: ''
            };
        }
        const d = game.defaults || {};
        const defC = Number.isFinite(Number(d.correctPoints)) ? Number(d.correctPoints) : 0;
        const defW = Number.isFinite(Number(d.wrongPoints)) ? Number(d.wrongPoints) : 0;
        const defBg = d.backgroundAlias != null ? String(d.backgroundAlias) : '';
        const defBgm = d.bgmAlias != null ? String(d.bgmAlias) : '';
        return {
            correctPoints: q.correctPoints != null ? Number(q.correctPoints) : defC,
            wrongPoints: q.wrongPoints != null ? Number(q.wrongPoints) : defW,
            backgroundAlias:
                q.backgroundAlias != null && String(q.backgroundAlias).trim() !== ''
                    ? String(q.backgroundAlias).trim()
                    : defBg,
            bgmAlias:
                q.bgmAlias != null && String(q.bgmAlias).trim() !== '' ? String(q.bgmAlias).trim() : defBgm,
            hintCorrect: q.hintCorrect != null ? String(q.hintCorrect) : '',
            hintWrong: q.hintWrong != null ? String(q.hintWrong) : '',
            correct:
                q.correct ||
                (Array.isArray(q.options) && q.options[0] && q.options[0].key ? String(q.options[0].key) : 'A')
        };
    }
};
