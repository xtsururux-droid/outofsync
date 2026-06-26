/**
 * scene-manager.js - 场景调度中心 (容错加强版)
 */
const SceneManager = {
    /** 勿默认成真实场景 id（如 "start"），否则首次 jumpTo 会与首场景 id 相同而误判「同场景」、跳过背景与 BGM */
    currentSceneId: null,
    storyData: null,
    currentStepIndex: 0,
    /** @type {{ mode: 'none'|'choice'|'cg'|'quiz_result', stepId?: string }} */
    uiMode: { mode: 'none' },
    /** @type {{ sourceStep: object, visualActive: boolean, musicActive: boolean } | null} */
    _cgSession: null,
    /** 刚执行过 Renderer.renderScene，本步 enterCurrentStep 不清理上一步特效（避免冲掉场景级入场） */
    _effectsFreshFromSceneRender: false,
    /** 原地返回栈：帧为 { sceneId, stepIndex }，stepIndex 为恢复后应执行的下标（通常为调用方「下一步」） */
    _returnStack: [],
    /**
     * 本步结束为「返回」且勾选「离开时压返回点」：在弹栈并落点之后再把「本步下一步」压栈（避免挡住本次弹出的帧）。
     * @type {{ sceneId: string, stepIndex: number } | null}
     */
    _deferredReturnPushFrame: null,
    /**
     * 剧情模块 / 复用模块调用栈：子场景播完后回到调用步的下一步。
     * 帧为 { callerSceneId, callerStepIndex, moduleSceneId, reuseExitBindings? }
     */
    _storyModuleStack: [],
    /**
     * 当前正在播放的步骤片段会话（同场景内连续步）；结束后按 returnInPlace 决定 return 或线性出口
     * @type {{ sceneId: string, orderedIndices: number[], returnInPlace: boolean, exitStepIndex: number } | null}
     */
    _fragmentSession: null,
    _cgFadeBusy: false,
    /** CG 步：已受理一次「离开本步」请求，至淡出/收尾完成前忽略重复点击，避免连跳多步 */
    _cgExitInProgress: false,
    /** CG 淡入未结束前忽略点击（防淡入期连点堆到下一步） */
    _cgFadeInBlockUntilMs: 0,
    /** 离开 CG 后极短时间内忽略一切推进点击，防「CG 内连点」在对白步瞬间连跳 */
    _afterCgInputBlockUntilMs: 0,
    /** 跨场景 jumpToScene 因非循环 CG 未播完已挂起：禁止 advanceStep 抢在真正换场之前多走一步（否则会先播调用方下一步旁白） */
    _deferredCrossSceneJumpActive: false,
    _cgNonLoopVideoPollTid: null,
    _cgVideoReleaseCleanup: null,
    _cgNonLoopWaitActive: false,
    /** 当前问答步骤会话：用于“答题后显示对错结果，点一下再继续下一步” */
    _quizSession: null,
    /** 随机展示：宿主步骤 + 合成 CG 等子阶段 */
    _randomDisplaySession: null,
    /** 话题池：宿主步骤 + 当前条目的步骤下标 */
    _topicPoolSession: null,
    /** 图文朗读：宿主步骤 + 当前图文片段下标 */
    _graphicReadingSession: null,
    /** 浪漫出场已触发，下一次 advanceStep 不再延迟（与 getRomanticExitDelayMs 配对） */
    _advanceStepSuppressRomanticExitOnce: false,
    /** 自动宣布：本轮已触发 sceneId 集合 */
    _autoAnnouncedScenes: null,
    _autoAnnounceBusy: false,
    /** 选择/随机步骤最后一次结果键（仅内存，用于复用模块进入分支；新开/重载剧本会清空） */
    _reuseEntryOutcomeByStepId: null,
    /** 与 GameState 同步：进入剧情/复用模块时写入当前分支目标场景 id，供跳转里写 `{复用返回场景}` */
    _REUSE_RESUME_SCENE_SLOT: '复用返回场景',

    init(data) {
        this.storyData = this.upgradeProjectData(data || {});
        if (typeof QuizGameConfig !== 'undefined') QuizGameConfig.normalizeProject(this.storyData);
        if (typeof RandomDisplayConfig !== 'undefined') RandomDisplayConfig.normalizeProject(this.storyData);
        if (typeof TopicPoolConfig !== 'undefined') TopicPoolConfig.normalizeProject(this.storyData);
        if (typeof GalleryConfig !== 'undefined') GalleryConfig.normalizeProject(this.storyData);
        if (typeof GraphicReadingConfig !== 'undefined') GraphicReadingConfig.normalizeProject(this.storyData);
        this.currentStepIndex = 0;
        this.uiMode = { mode: 'none' };
        this._cgSession = null;
        this._returnStack = [];
        this._deferredReturnPushFrame = null;
        this._storyModuleStack = [];
        this._reuseEntryOutcomeByStepId = Object.create(null);
        this._fragmentSession = null;
        this._cgFadeBusy = false;
        this._cgExitInProgress = false;
        this._cgFadeInBlockUntilMs = 0;
        this._afterCgInputBlockUntilMs = 0;
        this._abortCgNonLoopVideoWait();
        this._deferredCrossSceneJumpActive = false;
        this._quizSession = null;
        this._randomDisplaySession = null;
        this._topicPoolSession = null;
        this._graphicReadingSession = null;
        this._advanceStepSuppressRomanticExitOnce = false;
        this._autoAnnouncedScenes = {};
        this._autoAnnounceBusy = false;
        this._autoJumpedRules = {};
        this._autoJumpBusy = false;
        this.currentSceneId = null;
        this._syncReuseResumeSceneGameState();
        if (typeof StoryEffects !== 'undefined' && StoryEffects.discardPendingCgBgmResume) {
            StoryEffects.discardPendingCgBgmResume();
        }
        console.log("场景管理器初始化成功");
    },

    _traceJump(event, detail = {}) {
        const row = {
            event,
            fromSceneId: this.currentSceneId || '',
            fromStepIndex: Number.isFinite(this.currentStepIndex) ? this.currentStepIndex : -1,
            ...detail
        };
        if (typeof console !== 'undefined' && console.log) {
            console.log('[JumpTrace]', row);
        }
        try {
            if (typeof window !== 'undefined') {
                const list = Array.isArray(window.__gaaJumpTrace) ? window.__gaaJumpTrace : [];
                list.push({ time: new Date().toISOString(), ...row });
                window.__gaaJumpTrace = list.slice(-80);
            }
        } catch (_) {}
    },

    /** 由场景 ID + 入口标签（空表示该场景第一个步骤）解析步骤 id，供出现值条件使用 */
    resolveStepIdFromSceneLabel(sceneId, labelSuffix) {
        const sc = this.getScene(sceneId);
        if (!sc || !Array.isArray(sc.steps)) return '';
        const suf = labelSuffix == null ? '' : String(labelSuffix);
        if (!suf) {
            const st0 = sc.steps[0];
            return st0 && st0.id ? st0.id : '';
        }
        const st = sc.steps.find(s => s && s.labelSuffix === suf);
        return st && st.id ? st.id : '';
    },

    getScene(id) {
        if (!this.storyData || !this.storyData.scenes) return null;
        const scene = this.storyData.scenes.find(s => s.id === id);
        if (!scene && id != null && id !== '') {
            console.warn('[SceneManager] scene id not found:', id);
        }
        return scene || null;
    },

    /** 升级旧项目数据为 steps 脚本结构（兼容老字段） */
    upgradeProjectData(project) {
        if (!project || typeof project !== 'object') return project;
        if (project.typewriterMsPerChar == null || project.typewriterMsPerChar === '') {
            project.typewriterMsPerChar = 0;
        } else {
            const tw = Number(project.typewriterMsPerChar);
            project.typewriterMsPerChar = Number.isFinite(tw) && tw >= 0 ? tw : 0;
        }
        project.speakerNameColor =
            typeof normalizeSpeakerNameColor === 'function'
                ? normalizeSpeakerNameColor(project.speakerNameColor)
                : String(project.speakerNameColor || '#ffd700').trim() || '#ffd700';
        if (typeof CustomUiConfig !== 'undefined') CustomUiConfig.normalizeProject(project);
        if (!Array.isArray(project.scenes)) project.scenes = [];
        project.scenes.forEach(scene => {
            if (!scene || typeof scene !== 'object') return;
            if (!scene.id) scene.id = 'scene_' + Date.now();
            if (!scene.name) scene.name = scene.id;
            if (scene.appearedValue == null) scene.appearedValue = 0;
            if (!Array.isArray(scene.steps)) {
                // 旧版：scene.text + scene.options + scene.storyGraphic（仅作为兼容迁移）
                const steps = [];
                const oldText = typeof scene.text === 'string' ? scene.text : '';
                const hasText = oldText.trim().length > 0;
                if (hasText) {
                    steps.push({
                        id: 'step_' + Date.now() + '_dlg',
                        type: 'dialogue',
                        speakerRef: scene.characterRef || '',
                        expression: scene.expression || '',
                        text: oldText
                    });
                }
                if (scene.storyGraphic && (scene.storyGraphic.embeddedDataUrl || scene.storyGraphic.url)) {
                    steps.unshift({
                        id: 'step_' + Date.now() + '_cg',
                        type: 'cg',
                        cg: { ...(scene.storyGraphic || {}) },
                        hideDialogue: false,
                        hideCharacter: false
                    });
                }
                if (Array.isArray(scene.options) && scene.options.length) {
                    steps.push({
                        id: 'step_' + Date.now() + '_choice',
                        type: 'choice',
                        options: scene.options.map(o => ({
                            text: o.text || '',
                            // 旧版 options 只能跳场景
                            next: { type: 'scene', sceneId: o.target || 'start' },
                            effects: o.action ? [{ kind: 'var', var: o.action.var, op: 'add', val: o.action.val }] : []
                        }))
                    });
                }
                scene.steps = steps;
            }
            // 统一补齐 steps 字段
            scene.steps = (scene.steps || []).filter(Boolean).map((s, idx) => {
                const out = {
                    id: s.id || `${scene.id}_step_${idx}_${Date.now()}`,
                    type: s.type || 'dialogue',
                    appearedValue: s && s.appearedValue != null ? s.appearedValue : 0,
                    ...s
                };
                const t = out.type;
                if ((t === 'choice' || t === 'random') && out.hideIfJumpTargetSeen == null) out.hideIfJumpTargetSeen = false;
                if ((t === 'choice' || t === 'random') && out.filterBySpeakerExist == null) out.filterBySpeakerExist = false;
                if ((t === 'choice' || t === 'random') && out.moduleNoReplay == null) out.moduleNoReplay = false;
                if (t === 'dialogue' && out.requireSpeakerExist == null) out.requireSpeakerExist = false;
                if (t === 'cg') {
                    out.cgFadeInMs = 0;
                    out.cgFadeOutMs = 0;
                }
                if (out.stepFx && typeof out.stepFx === 'object' && Number(out.stepFx.v) === 2) {
                    if (out.stepFx.target == null || out.stepFx.target === '') {
                        out.stepFx.target = '通用';
                    }
                }
                if (t === 'quiz') {
                    if (typeof out.quizGameId !== 'string') out.quizGameId = '';
                    if (out.quizPickMode !== 'randomAll') out.quizPickMode = 'randomUnseen';
                }
                if (t === 'choice') {
                    if (!['characterId', 'optionIndex', 'optionText'].includes(out.choiceReuseEntryAs)) {
                        out.choiceReuseEntryAs = 'characterId';
                    }
                    if (typeof out.choiceWriteJumpSlot !== 'boolean') out.choiceWriteJumpSlot = false;
                    if (typeof out.choiceJumpSlotId !== 'string') {
                        out.choiceJumpSlotId = out.choiceJumpSlotId != null ? String(out.choiceJumpSlotId).trim() : '';
                    } else out.choiceJumpSlotId = String(out.choiceJumpSlotId).trim();
                    if (typeof out.choiceResultVarName !== 'string') out.choiceResultVarName = '';
                    else out.choiceResultVarName = String(out.choiceResultVarName).trim();
                    if (typeof out.choiceJumpPositionVarName !== 'string') out.choiceJumpPositionVarName = '';
                    else out.choiceJumpPositionVarName = String(out.choiceJumpPositionVarName).trim();
                    if (Array.isArray(out.options)) {
                        out.options.forEach(o => {
                            if (o && typeof o === 'object' && 'reuseEntryKey' in o) delete o.reuseEntryKey;
                            if (o && typeof o === 'object' && out.choiceWriteJumpSlot) {
                                const nx = o.next && o.next.type === 'scene' ? o.next : null;
                                if (
                                    (!o.jumpSlotNext || typeof o.jumpSlotNext !== 'object') &&
                                    nx &&
                                    String(nx.sceneId || '').trim()
                                ) {
                                    o.jumpSlotNext = {
                                        type: 'scene',
                                        sceneId: String(nx.sceneId || '').trim(),
                                        labelSuffix: typeof nx.labelSuffix === 'string' ? nx.labelSuffix : ''
                                    };
                                }
                            }
                        });
                    }
                }
                if (t === 'random') {
                    out.randomReuseEntryAs = 'name';
                    if (typeof out.randomWriteJumpSlot !== 'boolean') out.randomWriteJumpSlot = false;
                    if (typeof out.randomJumpSlotId !== 'string') {
                        out.randomJumpSlotId = out.randomJumpSlotId != null ? String(out.randomJumpSlotId).trim() : '';
                    } else out.randomJumpSlotId = String(out.randomJumpSlotId).trim();
                    if (typeof out.randomResultVarName !== 'string') out.randomResultVarName = '';
                    else out.randomResultVarName = String(out.randomResultVarName).trim();
                    if (typeof out.randomJumpPositionVarName !== 'string') out.randomJumpPositionVarName = '';
                    else out.randomJumpPositionVarName = String(out.randomJumpPositionVarName).trim();
                    const tbl = Array.isArray(out.table) ? out.table : Array.isArray(out.rows) ? out.rows : null;
                    if (Array.isArray(tbl)) {
                        tbl.forEach(r => {
                            if (r && typeof r === 'object' && 'reuseEntryKey' in r) delete r.reuseEntryKey;
                            if (r && typeof r === 'object' && out.randomWriteJumpSlot) {
                                const nx = r.next && r.next.type === 'scene' ? r.next : null;
                                if (
                                    (!r.jumpSlotNext || typeof r.jumpSlotNext !== 'object') &&
                                    nx &&
                                    String(nx.sceneId || '').trim()
                                ) {
                                    r.jumpSlotNext = {
                                        type: 'scene',
                                        sceneId: String(nx.sceneId || '').trim(),
                                        labelSuffix: typeof nx.labelSuffix === 'string' ? nx.labelSuffix : ''
                                    };
                                }
                            }
                        });
                    }
                }
                if (t === 'randomDisplay') {
                    if (typeof out.randomDisplayModuleId !== 'string') out.randomDisplayModuleId = '';
                    if (out.randomDisplayPickMode !== 'randomAll') out.randomDisplayPickMode = 'randomUnseen';
                    if (out.returnInPlace == null) out.returnInPlace = false;
                }
                if (t === 'topicPool') {
                    if (out.topicPoolMode !== 'direct') out.topicPoolMode = 'random';
                    if (typeof out.topicPoolModuleId !== 'string') out.topicPoolModuleId = '';
                    if (typeof out.topicPoolItemId !== 'string') out.topicPoolItemId = '';
                    if (typeof out.topicPoolItemSearchText !== 'string') out.topicPoolItemSearchText = '';
                    if (out.topicPoolPickMode !== 'randomAll') out.topicPoolPickMode = 'randomUnseen';
                }
                if (t === 'gallery') {
                    if (typeof out.galleryModuleId !== 'string') out.galleryModuleId = '';
                }
                if (t === 'graphicReading') {
                    if (typeof out.graphicReadingModuleId !== 'string') out.graphicReadingModuleId = '';
                    if (out.moduleNoReplay == null) out.moduleNoReplay = false;
                    if (out.moduleNoReplayNext != null) {
                        if (typeof out.moduleNoReplayNext !== 'object') out.moduleNoReplayNext = null;
                        else if (out.moduleNoReplayNext.type === 'return') out.moduleNoReplayNext = { type: 'return' };
                        else if (out.moduleNoReplayNext.type === 'scene' && String(out.moduleNoReplayNext.sceneId || '').trim()) {
                            if (typeof out.moduleNoReplayNext.labelSuffix !== 'string') out.moduleNoReplayNext.labelSuffix = '';
                        } else out.moduleNoReplayNext = null;
                    }
                }
                if (t === 'hiddenMap') {
                    if (typeof out.hiddenMapModuleId !== 'string') out.hiddenMapModuleId = '';
                    if (typeof out.receiverCharacterId !== 'string') out.receiverCharacterId = '';
                }
                if (t === 'storyModule') {
                    if (typeof out.storyModuleId !== 'string') out.storyModuleId = '';
                    if (out.moduleNoReplay == null) out.moduleNoReplay = false;
                    if (out.moduleNoReplayNext != null) {
                        if (typeof out.moduleNoReplayNext !== 'object') out.moduleNoReplayNext = null;
                        else if (out.moduleNoReplayNext.type === 'return') out.moduleNoReplayNext = { type: 'return' };
                        else if (out.moduleNoReplayNext.type === 'scene' && String(out.moduleNoReplayNext.sceneId || '').trim()) {
                            if (typeof out.moduleNoReplayNext.labelSuffix !== 'string') out.moduleNoReplayNext.labelSuffix = '';
                        } else out.moduleNoReplayNext = null;
                    }
                }
                if (t === 'dialogue' || t === 'narration') {
                    if ('typewriterMsPerChar' in out) delete out.typewriterMsPerChar;
                }
                if (out.finishJump != null) {
                    if (typeof out.finishJump !== 'object') {
                        delete out.finishJump;
                    } else if (out.finishJump.type === 'return') {
                        out.finishJump = { type: 'return' };
                    } else if (out.finishJump.type === 'scene' && String(out.finishJump.sceneId || '').trim()) {
                        if (typeof out.finishJump.labelSuffix !== 'string') out.finishJump.labelSuffix = '';
                        if ('reuseModuleStay' in out.finishJump) out.finishJump.reuseModuleStay = !!out.finishJump.reuseModuleStay;
                        else delete out.finishJump.reuseModuleStay;
                    } else {
                        delete out.finishJump;
                    }
                }
                return out;
            });
            /** 步骤片段：场景内连续步骤编组；旧项目补空数组。条目字段见仓库约定。 */
            if (!Array.isArray(scene.stepFragments)) scene.stepFragments = [];
            else {
                scene.stepFragments = scene.stepFragments.filter(f => f && typeof f === 'object');
                scene.stepFragments.forEach((fr, fi) => {
                    if (!fr.id || typeof fr.id !== 'string') fr.id = `${scene.id}_frag_${fi}_${Date.now()}`;
                    if (typeof fr.name !== 'string') fr.name = '';
                    if (fr.returnInPlace == null) fr.returnInPlace = true;
                    if (!Array.isArray(fr.stepIds)) fr.stepIds = [];
                    else fr.stepIds = fr.stepIds.filter(id => typeof id === 'string' && id);
                });
            }
            scene.autoAnnounce =
                scene.autoAnnounce && typeof scene.autoAnnounce === 'object'
                    ? scene.autoAnnounce
                    : { enabled: false, published: false, condition: null, message: '' };
            if (scene.autoAnnounce.enabled == null) scene.autoAnnounce.enabled = false;
            if (scene.autoAnnounce.published == null) scene.autoAnnounce.published = false;
            if (!('condition' in scene.autoAnnounce)) scene.autoAnnounce.condition = null;
            if (typeof scene.autoAnnounce.message !== 'string') scene.autoAnnounce.message = '';
        });
        if (!Array.isArray(project.autoAnnouncementRules)) project.autoAnnouncementRules = [];
        else {
            project.autoAnnouncementRules = project.autoAnnouncementRules
                .filter(r => r && typeof r === 'object')
                .map((r, i) => {
                    const id =
                        typeof r.id === 'string' && r.id.trim()
                            ? r.id.trim()
                            : `aa_${Date.now().toString(36)}_${i}`;
                    if (r.enabled == null) r.enabled = false;
                    if (r.published == null) r.published = false;
                    if (!('condition' in r)) r.condition = null;
                    if (typeof r.message !== 'string') r.message = '';
                    if (typeof r.name !== 'string') r.name = '';
                    r.id = id;
                    return r;
                });
        }
        if (!Array.isArray(project.autoJumpRules)) project.autoJumpRules = [];
        else {
            project.autoJumpRules = project.autoJumpRules
                .filter(r => r && typeof r === 'object')
                .map((r, i) => {
                    const id =
                        typeof r.id === 'string' && r.id.trim()
                            ? r.id.trim()
                            : `aj_${Date.now().toString(36)}_${i}`;
                    if (r.enabled == null) r.enabled = false;
                    if (r.published == null) r.published = false;
                    if (!('condition' in r)) r.condition = null;
                    if (typeof r.sceneId !== 'string') r.sceneId = '';
                    if (typeof r.labelSuffix !== 'string') r.labelSuffix = '';
                    if (typeof r.name !== 'string') r.name = '';
                    r.returnInPlace = !!r.returnInPlace;
                    r.id = id;
                    return r;
                });
        }
        if (!Array.isArray(project.storyModules)) project.storyModules = [];
        else {
            project.storyModules = project.storyModules
                .filter(m => m && typeof m === 'object')
                .map((m, i) => ({
                    id:
                        typeof m.id === 'string' && m.id.trim()
                            ? m.id.trim()
                            : `storymod_${Date.now().toString(36)}_${i}`,
                    name: typeof m.name === 'string' ? m.name : '',
                    targetSceneId: typeof m.targetSceneId === 'string' ? m.targetSceneId : '',
                    entryLabelSuffix: typeof m.entryLabelSuffix === 'string' ? m.entryLabelSuffix : '',
                    targetMode: ['scene', 'step', 'fragment'].includes(m.targetMode) ? m.targetMode : '',
                    targetStepId: typeof m.targetStepId === 'string' ? m.targetStepId : '',
                    targetFragmentId: typeof m.targetFragmentId === 'string' ? m.targetFragmentId : ''
                }));
        }
        if (!Array.isArray(project.reuseModules)) project.reuseModules = [];
        else {
            project.reuseModules = project.reuseModules
                .filter(m => m && typeof m === 'object')
                .map((m, i) => {
                    const id =
                        typeof m.id === 'string' && m.id.trim()
                            ? m.id.trim()
                            : `reuse_${Date.now().toString(36)}_${i}`;
                    const branches = Array.isArray(m.branches)
                        ? m.branches
                              .filter(b => b && typeof b === 'object')
                              .map(b => ({
                                  keyCharacterId:
                                      typeof b.keyCharacterId === 'string' && b.keyCharacterId.trim()
                                          ? b.keyCharacterId.trim()
                                          : '*',
                                  targetSceneId: typeof b.targetSceneId === 'string' ? b.targetSceneId : '',
                                  entryLabelSuffix: typeof b.entryLabelSuffix === 'string' ? b.entryLabelSuffix : ''
                              }))
                        : [{ keyCharacterId: '*', targetSceneId: '', entryLabelSuffix: '' }];
                    const exitBindings = Array.isArray(m.exitBindings)
                        ? m.exitBindings
                              .filter(e => e && typeof e === 'object')
                              .map(e => ({
                                  varName: typeof e.varName === 'string' ? e.varName : '',
                                  sourceKind: ['fixed', 'choice', 'random'].includes(e.sourceKind)
                                      ? e.sourceKind
                                      : 'fixed',
                                  fixedValue: e.fixedValue != null ? e.fixedValue : '',
                                  branchSceneId: typeof e.branchSceneId === 'string' ? e.branchSceneId : '',
                                  sourceStepId: typeof e.sourceStepId === 'string' ? e.sourceStepId : '',
                                  optionIndex: Number.isFinite(Number(e.optionIndex)) ? Number(e.optionIndex) : 0,
                                  randomRowIndex: Number.isFinite(Number(e.randomRowIndex)) ? Number(e.randomRowIndex) : 0,
                                  valueMode: typeof e.valueMode === 'string' ? e.valueMode : '',
                                  literalValue: e.literalValue != null ? String(e.literalValue) : ''
                              }))
                        : [];
                    const popExitBindings = Array.isArray(m.popExitBindings)
                        ? m.popExitBindings
                              .filter(p => p && typeof p === 'object')
                              .map(p => ({
                                  varName: typeof p.varName === 'string' ? p.varName : '',
                                  writeKind: ['literal', 'usedEntryKey', 'boolTrue', 'boolFalse'].includes(p.writeKind)
                                      ? p.writeKind
                                      : 'literal',
                                  literalValue: p.literalValue != null ? String(p.literalValue) : ''
                              }))
                        : [];
                    const entrySrc =
                        m.entrySource === 'choiceResult' || m.entrySource === 'randomResult'
                            ? m.entrySource
                            : m.entrySource === 'gameVariable'
                              ? 'gameVariable'
                              : 'dialogueSpeaker';
                    return {
                        id,
                        name: typeof m.name === 'string' ? m.name : '',
                        entrySceneId: typeof m.entrySceneId === 'string' ? m.entrySceneId : '',
                        entryLabelSuffix: typeof m.entryLabelSuffix === 'string' ? m.entryLabelSuffix : '',
                        entrySource: entrySrc,
                        entryVariableName:
                            typeof m.entryVariableName === 'string' ? m.entryVariableName.trim() : '',
                        /** 进入分支跳转前：把本次进入值写入该记忆槽（任意进入方式共用，免逐行出去值） */
                        entryWriteVarName:
                            typeof m.entryWriteVarName === 'string' ? m.entryWriteVarName.trim() : '',
                        entrySecondOutputBaseName:
                            typeof m.entrySecondOutputBaseName === 'string' ? m.entrySecondOutputBaseName.trim() : '',
                        /** 与入口场景+入口标签+进入依据匹配的跳转槽 id（步骤侧无需再选槽） */
                        entryJumpSlotId:
                            typeof m.entryJumpSlotId === 'string' && /^[a-z0-9]{4,32}$/.test(m.entryJumpSlotId.trim())
                                ? m.entryJumpSlotId.trim()
                                : '',
                        branches: branches.length
                            ? branches
                            : [{ keyCharacterId: '*', targetSceneId: '', entryLabelSuffix: '' }],
                        exitBindings,
                        popExitBindings
                    };
                });
        }
        if (!Array.isArray(project.jumpSlots)) project.jumpSlots = [];
        else {
            project.jumpSlots = project.jumpSlots
                .filter(s => s && typeof s === 'object')
                .map((s, i) => {
                    let id0 =
                        typeof s.id === 'string' && s.id.trim() && /^[a-z0-9]{4,32}$/.test(s.id.trim())
                            ? s.id.trim()
                            : '';
                    if (!id0) {
                        id0 = `js${Date.now().toString(36)}${i}${Math.random().toString(36).slice(2, 10)}`.replace(
                            /[^a-z0-9]/g,
                            ''
                        );
                        if (id0.length > 24) id0 = id0.slice(0, 24);
                    }
                    return {
                        id: id0,
                        name: typeof s.name === 'string' ? s.name.trim() : ''
                    };
                });
        }
        this._syncJumpSlotsFromAuthorPositionNames(project);
        this.migrateAllAppearanceInProject(project);
        return project;
    },

    _allocateNewJumpSlotId(project) {
        const list = Array.isArray(project.jumpSlots) ? project.jumpSlots : (project.jumpSlots = []);
        for (let k = 0; k < 80; k++) {
            const id = `js${Date.now().toString(36)}${k}${Math.random().toString(36).slice(2, 10)}`.replace(
                /[^a-z0-9]/g,
                ''
            );
            const id0 = id.length > 22 ? id.slice(0, 22) : id;
            if (/^[a-z0-9]{4,32}$/.test(id0) && !list.some(s => s && s.id === id0)) return id0;
        }
        return `js${Date.now()}`.replace(/[^a-z0-9]/g, '').slice(0, 22);
    },

    _isValidAuthorJumpPositionSlotName(nm) {
        const s = String(nm || '').trim();
        if (!s || s.length > 48 || s.includes('__')) return false;
        return /^[\w\u4e00-\u9fff]+$/.test(s);
    },

    /** 随机/选项「蓝线跳转→变量」名：补全 project.jumpSlots，与编辑器迁移一致，保证仅运行时加载 JSON 也能写入 jpos_* */
    _syncJumpSlotsFromAuthorPositionNames(project) {
        if (!project || !Array.isArray(project.scenes)) return;
        const list = Array.isArray(project.jumpSlots) ? project.jumpSlots : (project.jumpSlots = []);
        const seen = new Set();
        const haveName = nm => list.some(s => s && String(s.name || '').trim() === nm);
        (project.scenes || []).forEach(sc => {
            (sc && sc.steps ? sc.steps : []).forEach(st => {
                if (!st) return;
                let v = '';
                if (st.type === 'random') {
                    v = st.randomJumpPositionVarName != null ? String(st.randomJumpPositionVarName).trim() : '';
                } else if (st.type === 'choice') {
                    v = st.choiceJumpPositionVarName != null ? String(st.choiceJumpPositionVarName).trim() : '';
                }
                if (!v || seen.has(v)) return;
                seen.add(v);
                if (!this._isValidAuthorJumpPositionSlotName(v)) return;
                if (haveName(v)) return;
                list.push({ id: this._allocateNewJumpSlotId(project), name: v });
            });
        });
    },

    /** 跳转位置槽：底层两个变量 jpos_{id}_sc / jpos_{id}_lb，供 finishJump 里 {jpos_…} 解析 */
    jumpSlotSceneVarKey(slotId) {
        const id = String(slotId || '').trim();
        return id && /^[a-z0-9]{4,32}$/.test(id) ? `jpos_${id}_sc` : '';
    },
    jumpSlotLabelVarKey(slotId) {
        const id = String(slotId || '').trim();
        return id && /^[a-z0-9]{4,32}$/.test(id) ? `jpos_${id}_lb` : '';
    },
    writeJumpSlotFromSceneNext(project, slotId, next) {
        if (!slotId || !project || !next || typeof GameState === 'undefined' || !GameState.set) return;
        const sid = String(slotId).trim();
        if (!sid || !Array.isArray(project.jumpSlots) || !project.jumpSlots.some(s => s && s.id === sid)) return;
        if (next.type !== 'scene') return;
        const kSc = this.jumpSlotSceneVarKey(sid);
        const kLb = this.jumpSlotLabelVarKey(sid);
        if (!kSc || !kLb) return;
        GameState.set(kSc, String(next.sceneId || '').trim());
        GameState.set(kLb, typeof next.labelSuffix === 'string' ? next.labelSuffix.trim() : '');
    },

    /** 跳转位置「别名」：底层两个 GameState 键（作者只起一个中文/字母名） */
    jumpPositionAliasSceneKey(base) {
        const b = String(base || '').trim();
        return b ? `__jp__${b}__sc` : '';
    },
    jumpPositionAliasLabelKey(base) {
        const b = String(base || '').trim();
        return b ? `__jp__${b}__lb` : '';
    },
    isValidJumpPositionAliasBaseName(name) {
        const s = String(name || '').trim();
        if (!s || s.length > 48) return false;
        if (s.includes('__')) return false;
        return /^[\w\u4e00-\u9fff]+$/.test(s);
    },
    /**
     * 跳转目标为「仅 {别名}」且入口标签为空时，解析为别名对应的场景 id + 标签后缀（与随机/选项写槽时同步写入的一对键一致）。
     */
    tryResolveJumpPositionAliasBundle(rawSid, rawLab) {
        const s0 = String(rawSid != null ? rawSid : '').trim();
        const l0 = String(rawLab != null ? rawLab : '').trim();
        const m = /^\{([\w\u4e00-\u9fff]+)\}$/.exec(s0);
        if (!m) return null;
        const base = m[1];
        if (!this.isValidJumpPositionAliasBaseName(base)) return null;
        if (l0 && l0 !== s0) return null;
        if (typeof GameState === 'undefined' || !GameState.get) return null;
        const kSc = this.jumpPositionAliasSceneKey(base);
        const kLb = this.jumpPositionAliasLabelKey(base);
        const sc = GameState.get(kSc);
        const lb = GameState.get(kLb);
        const sid = sc != null && sc !== undefined ? String(sc).trim() : '';
        if (!sid) return null;
        return {
            sceneId: sid,
            labelSuffix: lb != null && lb !== undefined ? String(lb).trim() : ''
        };
    },
    writeJumpPositionAliasFromSlotNext(step, slotNext) {
        if (!step || !slotNext || slotNext.type !== 'scene' || typeof GameState === 'undefined' || !GameState.set) return;
        let base = '';
        if (step.type === 'random') {
            base = step.randomJumpPositionVarName != null ? String(step.randomJumpPositionVarName).trim() : '';
        } else if (step.type === 'choice') {
            base = step.choiceJumpPositionVarName != null ? String(step.choiceJumpPositionVarName).trim() : '';
        }
        if (!base || !this.isValidJumpPositionAliasBaseName(base)) return;
        const kSc = this.jumpPositionAliasSceneKey(base);
        const kLb = this.jumpPositionAliasLabelKey(base);
        GameState.set(kSc, String(slotNext.sceneId || '').trim());
        GameState.set(kLb, typeof slotNext.labelSuffix === 'string' ? slotNext.labelSuffix.trim() : '');
    },
    /**
     * 仅解析蓝线 jumpSlotNext（与是否勾选「写入跳转位置槽」无关），供作者命名的跳转位置变量。
     * @param {{ jumpSlotNext?: object }} rowOrOpt 随机行或选项对象
     */
    normalizeBlueJumpSlotNext(rowOrOpt) {
        const jn = rowOrOpt && rowOrOpt.jumpSlotNext && typeof rowOrOpt.jumpSlotNext === 'object' ? rowOrOpt.jumpSlotNext : null;
        if (!jn || jn.type !== 'scene') return null;
        const sid = String(jn.sceneId || '').trim();
        if (!sid) return null;
        return {
            type: 'scene',
            sceneId: sid,
            labelSuffix: typeof jn.labelSuffix === 'string' ? jn.labelSuffix.trim() : ''
        };
    },
    writeRandomPickNamedVars(step, picked) {
        if (!step || step.type !== 'random' || typeof GameState === 'undefined' || !GameState.set) return;
        const vn = step.randomResultVarName != null ? String(step.randomResultVarName).trim() : '';
        if (vn && picked) {
            const nm = picked.name != null ? String(picked.name).trim() : '';
            GameState.set(vn, nm);
        }
        const blue = picked ? this.normalizeBlueJumpSlotNext(picked) : null;
        if (blue) this.writeJumpPositionAliasFromSlotNext(step, blue);
    },
    writeChoicePickNamedVars(step, opt) {
        if (!step || step.type !== 'choice' || typeof GameState === 'undefined' || !GameState.set) return;
        const vn = step.choiceResultVarName != null ? String(step.choiceResultVarName).trim() : '';
        if (vn && opt) {
            GameState.set(vn, String(opt.text != null ? opt.text : '').trim());
        }
        const blue = opt ? this.normalizeBlueJumpSlotNext(opt) : null;
        if (blue) this.writeJumpPositionAliasFromSlotNext(step, blue);
    },

    /**
     * 复用模块在「进入场景 + 入口标签 + 进入依据」与某随机/选项步一致时绑定的跳转槽 id。
     */
    resolveReuseEntryJumpSlotId(project, entrySceneId, entryLabelSuffix, entrySource) {
        const esc = String(entrySceneId || '').trim();
        const lab = entryLabelSuffix != null ? String(entryLabelSuffix).trim() : '';
        if (!esc || !lab || (entrySource !== 'randomResult' && entrySource !== 'choiceResult')) return '';
        const list = project && Array.isArray(project.reuseModules) ? project.reuseModules : [];
        for (let i = 0; i < list.length; i++) {
            const m = list[i];
            if (!m) continue;
            if (String(m.entrySceneId || '').trim() !== esc) continue;
            if (String(m.entryLabelSuffix || '').trim() !== lab) continue;
            if (String(m.entrySource || '') !== entrySource) continue;
            const id = m.entryJumpSlotId != null ? String(m.entryJumpSlotId).trim() : '';
            if (id && /^[a-z0-9]{4,32}$/.test(id)) return id;
        }
        return '';
    },

    /**
     * 按跳转槽在工程里的显示名（与随机/选项步「跳转位置槽」起名一致）解析槽 id，避免仅依赖复用模块绑定时绑定缺失导致无法写入 jpos_*。
     */
    resolveJumpSlotIdByDisplayName(project, displayName) {
        const nm = String(displayName || '').trim();
        if (!nm || !project || !Array.isArray(project.jumpSlots)) return '';
        for (let i = 0; i < project.jumpSlots.length; i++) {
            const s = project.jumpSlots[i];
            if (!s) continue;
            const rowName = s.name != null ? String(s.name).trim() : '';
            if (rowName !== nm) continue;
            const id = s.id != null ? String(s.id).trim() : '';
            if (id && /^[a-z0-9]{4,32}$/.test(id)) return id;
        }
        return '';
    },

    /**
     * 随机/选项步写入跳转槽时使用的 id：优先旧版步骤上的 id；否则在勾选「写入」且复用模块已绑定时解析。
     */
    getEffectiveJumpSlotIdForStep(project, sceneId, step) {
        if (!step || !project) return '';
        const sid = String(sceneId || '').trim();
        const lab = step.labelSuffix != null ? String(step.labelSuffix).trim() : '';
        if (step.type === 'random') {
            const leg = step.randomJumpSlotId != null ? String(step.randomJumpSlotId).trim() : '';
            if (leg && /^[a-z0-9]{4,32}$/.test(leg)) return leg;
            if (step.randomWriteJumpSlot) {
                const fromReuse = this.resolveReuseEntryJumpSlotId(project, sid, lab, 'randomResult');
                if (fromReuse) return fromReuse;
                const vn =
                    step.randomJumpPositionVarName != null ? String(step.randomJumpPositionVarName).trim() : '';
                if (vn) {
                    const byName = this.resolveJumpSlotIdByDisplayName(project, vn);
                    if (byName) return byName;
                }
            }
            return '';
        }
        if (step.type === 'choice') {
            const leg = step.choiceJumpSlotId != null ? String(step.choiceJumpSlotId).trim() : '';
            if (leg && /^[a-z0-9]{4,32}$/.test(leg)) return leg;
            if (step.choiceWriteJumpSlot) {
                const fromReuse = this.resolveReuseEntryJumpSlotId(project, sid, lab, 'choiceResult');
                if (fromReuse) return fromReuse;
                const vn =
                    step.choiceJumpPositionVarName != null ? String(step.choiceJumpPositionVarName).trim() : '';
                if (vn) {
                    const byName = this.resolveJumpSlotIdByDisplayName(project, vn);
                    if (byName) return byName;
                }
            }
            return '';
        }
        return '';
    },

    /**
     * 随机行：写入跳转位置槽用的场景跳转（蓝色行）；无有效数据时返回 null，不写槽。
     */
    getJumpSlotNextForRandomRow(row, step) {
        if (!row || !step || step.type !== 'random' || !step.randomWriteJumpSlot) return null;
        const jn = row.jumpSlotNext;
        if (!jn || jn.type !== 'scene') return null;
        const sid = String(jn.sceneId || '').trim();
        if (!sid) return null;
        return {
            type: 'scene',
            sceneId: sid,
            labelSuffix: typeof jn.labelSuffix === 'string' ? jn.labelSuffix.trim() : ''
        };
    },

    /**
     * 选项：写入跳转位置槽用的场景跳转（蓝色行）。
     */
    getJumpSlotNextForChoiceOption(opt, step) {
        if (!opt || !step || step.type !== 'choice' || !step.choiceWriteJumpSlot) return null;
        const jn = opt.jumpSlotNext;
        if (!jn || jn.type !== 'scene') return null;
        const sid = String(jn.sceneId || '').trim();
        if (!sid) return null;
        return {
            type: 'scene',
            sceneId: sid,
            labelSuffix: typeof jn.labelSuffix === 'string' ? jn.labelSuffix.trim() : ''
        };
    },

    /** 将旧版「出现值」仅 targetId 的条目补全 sceneId + labelSuffix；条件 type:appearance 的 op 统一为 == */
    migrateAppearanceNode(node, scenes) {
        if (!node || typeof node !== 'object') return;
        const isCond = node.type === 'appearance';
        const isEff = node.kind === 'appearance';
        if (!isCond && !isEff) return;
        if (node.targetType === 'scene') {
            if (!node.sceneId && node.targetId) node.sceneId = node.targetId;
            node.labelSuffix = '';
        } else if (node.targetType === 'stepFragment') {
            if (!node.fragmentId && node.targetId) node.fragmentId = node.targetId;
            node.labelSuffix = '';
        } else if (node.targetType === 'step') {
            if (node.targetId && !node.sceneId) {
                const list = Array.isArray(scenes) ? scenes : [];
                for (let i = 0; i < list.length; i++) {
                    const sc = list[i];
                    const st = (sc.steps || []).find(s => s && s.id === node.targetId);
                    if (st) {
                        node.sceneId = sc.id;
                        node.labelSuffix = st.labelSuffix != null ? String(st.labelSuffix) : '';
                        break;
                    }
                }
            }
            if (typeof node.labelSuffix !== 'string') node.labelSuffix = '';
        }
        if (isCond) node.op = '==';
    },

    migrateAllAppearanceInProject(project) {
        if (!project || typeof project !== 'object') return;
        const scenes = project.scenes || [];
        const visitCond = cond => {
            if (!cond || typeof cond !== 'object') return;
            if (Array.isArray(cond.and)) {
                cond.and.forEach(visitCond);
                return;
            }
            this.migrateAppearanceNode(cond, scenes);
        };
        const visitEffects = arr => {
            if (!Array.isArray(arr)) return;
            arr.forEach(e => this.migrateAppearanceNode(e, scenes));
        };
        scenes.forEach(sc => {
            (sc.steps || []).forEach(st => {
                if (!st) return;
                visitCond(st.condition);
                visitEffects(st.effects);
                if (st.type === 'choice' && Array.isArray(st.options)) {
                    st.options.forEach(o => {
                        if (!o) return;
                        visitCond(o.condition);
                        visitEffects(o.effects);
                    });
                }
                if (st.type === 'random' && Array.isArray(st.table)) {
                    st.table.forEach(row => {
                        if (!row) return;
                        visitCond(row.condition);
                        visitEffects(row.effects);
                    });
                }
            });
        });
    },

    /** 当前步或当前场景是否启用「离开时压入返回点」（仅当为 true 时压栈） */
    _shouldPushReturnFrame() {
        const step = this.getCurrentStep();
        const scene = this.getScene(this.currentSceneId);
        if (step && step.returnInPlace === true) return true;
        if (scene && scene.returnInPlace === true) return true;
        return false;
    },

    _appendReturnStackFrame(fr) {
        if (!fr || typeof fr.sceneId !== 'string' || !fr.sceneId) return;
        if (!this._returnStack) this._returnStack = [];
        const max = 32;
        while (this._returnStack.length >= max) this._returnStack.shift();
        let ix = Number(fr.stepIndex);
        if (!Number.isFinite(ix) || ix < 0) ix = 0;
        this._returnStack.push({ sceneId: fr.sceneId, stepIndex: ix, finishJump: fr.finishJump || null });
    },

    _pushReturnFrame(finishJump = null) {
        this._appendReturnStackFrame({
            sceneId: this.currentSceneId,
            stepIndex: this.currentStepIndex + 1,
            finishJump
        });
    },

    /** 本步为「返回」且需压返回点时：记下「本步下一步」，在 resumeFromReturnStack 落点后再压栈 */
    _queueDeferredReturnPushIfNeeded() {
        if (!this._shouldPushReturnFrame()) return;
        this._deferredReturnPushFrame = {
            sceneId: this.currentSceneId,
            stepIndex: this.currentStepIndex + 1
        };
    },

    _flushDeferredReturnPushAfterResume() {
        const d = this._deferredReturnPushFrame;
        if (!d) return;
        this._deferredReturnPushFrame = null;
        this._appendReturnStackFrame(d);
    },

    /** 弹出返回栈顶并恢复执行（供 next.type === 'return'） */
    resumeFromReturnStack() {
        const stack = this._returnStack;
        if (!stack || !stack.length) {
            this._deferredReturnPushFrame = null;
            console.warn('[SceneManager] next return：返回栈为空');
            return;
        }
        const fr = stack.pop();
        if (typeof StoryEffects !== 'undefined' && StoryEffects.stopLoopingStepSound) {
            StoryEffects.stopLoopingStepSound();
        }
        if (typeof StoryEffects !== 'undefined' && StoryEffects.stopCgMusicOnly) StoryEffects.stopCgMusicOnly();
        if (typeof StoryEffects !== 'undefined' && StoryEffects.discardPendingCgBgmResume) {
            StoryEffects.discardPendingCgBgmResume();
        }
        this._cgSession = null;
        this._fragmentSession = null;
        if (typeof UIManager !== 'undefined' && UIManager.closeCgStep) UIManager.closeCgStep();
        if (typeof UIManager !== 'undefined' && UIManager.hideOptions) UIManager.hideOptions();

        this.currentSceneId = fr.sceneId || 'start';
        const scene = this.getScene(this.currentSceneId);
        const steps = scene && scene.steps ? scene.steps : [];
        let idx = Number(fr.stepIndex);
        if (!Number.isFinite(idx) || idx < 0) idx = 0;
        if (idx >= steps.length) {
            console.warn('[SceneManager] return：恢复点超出步骤范围，落在场景末步');
            idx = Math.max(0, steps.length - 1);
        }
        this.currentStepIndex = idx;
        this._activateFragmentSessionIfStepInFragment(scene, idx);

        if (typeof StoryEffects !== 'undefined' && StoryEffects.playMusicForScene) {
            StoryEffects.playMusicForScene(scene);
        }
        if (typeof Renderer !== 'undefined') Renderer.renderScene(scene);
        this._effectsFreshFromSceneRender = true;
        this.uiMode = { mode: 'none' };
        if (fr.finishJump) {
            const fj = fr.finishJump;
            if (fj.type === 'return') {
                this.resumeFromReturnStack();
                this._flushDeferredReturnPushAfterResume();
                return;
            }
            if (fj.type === 'scene') {
                const jopts = fj.reuseModuleStay ? { reuseModuleStay: true } : null;
                this.jumpToScene(fj.sceneId, fj.labelSuffix, jopts);
                this._flushDeferredReturnPushAfterResume();
                return;
            }
        }
        this.enterCurrentStep();
        this._flushDeferredReturnPushAfterResume();
    },

    /** 解析片段在场景 steps 数组中的下标序列（升序） */
    _orderedIndicesForFragment(scene, fr) {
        const steps = scene && scene.steps ? scene.steps : [];
        const out = [];
        if (!fr || !Array.isArray(fr.stepIds)) return out;
        for (let k = 0; k < fr.stepIds.length; k++) {
            const id = fr.stepIds[k];
            const ix = steps.findIndex(s => s && s.id === id);
            if (ix >= 0) out.push(ix);
        }
        out.sort((a, b) => a - b);
        return out;
    },

    /**
     * 若某步落在 stepFragments 内，建立 _fragmentSession，使 advanceStep 仍按片段结束规则（原地返回 / 出口步）执行。
     * 用于：jumpToScene 带标签落在片段中途、本场景 label 跳转、return 恢复点落在片段内等。
     */
    _activateFragmentSessionIfStepInFragment(scene, stepIndex) {
        if (!scene || !Array.isArray(scene.stepFragments) || stepIndex == null || stepIndex < 0) return;
        if (this._fragmentSession) return;
        const frags = scene.stepFragments || [];
        for (let fi = 0; fi < frags.length; fi++) {
            const fr = frags[fi];
            const indices = this._orderedIndicesForFragment(scene, fr);
            if (!indices.length) continue;
            const pos = indices.indexOf(stepIndex);
            if (pos < 0) continue;
            const lastIdx = indices[indices.length - 1];
            const fragId = fr.id || '';
            this._fragmentSession = {
                sceneId: scene.id,
                orderedIndices: indices.slice(pos),
                returnInPlace: fr.returnInPlace !== false,
                exitStepIndex: lastIdx + 1,
                fragmentId: fragId
            };
            if (fragId && typeof GameState !== 'undefined' && GameState.markFragmentAppeared) {
                GameState.markFragmentAppeared(fragId);
            }
            return;
        }
    },

    /**
     * 进入本场景已定义的步骤片段：按 stepIds 在 steps 中的顺序串行执行；首步进入时标记片段已出现
     * @param {string} startLabelSuffix 可选：片段内某步的 labelSuffix，从该步起播片段剩余步；不在片段内则退回片段首步
     * @param {{ editorPreview?: boolean } | null} opts 可选；editorPreview 时片段结束不按「原地返回」压栈（避免试玩栈空卡住）
     * @returns {boolean}
     */
    enterFragment(fragmentId, sceneId, startLabelSuffix = '', opts = null) {
        if (!fragmentId || !this.storyData) return false;
        if (this._fragmentSession) {
            if (typeof console !== 'undefined' && console.warn)
                console.warn('[SceneManager] 已在片段内，暂不支持嵌套片段：', fragmentId);
            return false;
        }
        const sid = sceneId || this.currentSceneId;
        const scene = this.getScene(sid);
        if (!scene || !Array.isArray(scene.steps)) return false;
        const steps = scene.steps || [];
        const frags = scene.stepFragments || [];
        const fr = frags.find(f => f && f.id === fragmentId);
        if (!fr || !Array.isArray(fr.stepIds) || !fr.stepIds.length) return false;
        const indices = this._orderedIndicesForFragment(scene, fr);
        if (!indices.length) return false;
        for (let j = 1; j < indices.length; j++) {
            if (indices[j] !== indices[j - 1] + 1) {
                if (typeof console !== 'undefined' && console.warn)
                    console.warn('[SceneManager] 片段内步骤在场景中不连续，仍按已解析顺序播放：', fragmentId);
                break;
            }
        }
        const lastIdx = indices[indices.length - 1];
        let orderedIndices = indices;
        let startStepIndex = indices[0];
        const lab = startLabelSuffix != null ? String(startLabelSuffix).trim() : '';
        if (lab) {
            const labelIdx = steps.findIndex(s => s && String(s.labelSuffix || '').trim() === lab);
            if (labelIdx >= 0) {
                const posInFrag = indices.indexOf(labelIdx);
                if (posInFrag >= 0) {
                    orderedIndices = indices.slice(posInFrag);
                    startStepIndex = labelIdx;
                } else if (typeof console !== 'undefined' && console.warn) {
                    console.warn('[SceneManager] 片段入口标签不在该片段步骤内，从片段首步进入', fragmentId, lab);
                }
            }
        }
        const preview = opts && opts.editorPreview;
        const forceReturnInPlace = opts && opts.forceReturnInPlace;
        this._fragmentSession = {
            sceneId: scene.id,
            orderedIndices,
            returnInPlace: forceReturnInPlace ? true : preview ? false : fr.returnInPlace !== false,
            exitStepIndex: lastIdx + 1,
            fragmentId: fragmentId || '',
            /** 编辑器「立即播放」：仅播片段内步骤，结束后停住并提示，不进入片段后的线性步骤 */
            editorPreview: !!preview
        };
        this.currentSceneId = scene.id;
        this.currentStepIndex = startStepIndex;
        if (opts && opts.renderScene) {
            if (typeof StoryEffects !== 'undefined' && StoryEffects.playMusicForScene) {
                StoryEffects.playMusicForScene(scene);
            }
            if (typeof Renderer !== 'undefined' && Renderer.renderScene) {
                Renderer.renderScene(scene, { inheritedBackground: opts && opts.inheritedBackground });
            }
            this._effectsFreshFromSceneRender = true;
            this.uiMode = { mode: 'none' };
        }
        if (typeof GameState !== 'undefined' && GameState.markFragmentAppeared) {
            GameState.markFragmentAppeared(fragmentId);
        }
        this.enterCurrentStep();
        return true;
    },

    enterSingleStepReturnInPlace(sceneId, stepId, finishJump = null, opts = null) {
        const scene = this.getScene(sceneId);
        if (!scene || !Array.isArray(scene.steps)) return false;
        const idx = (scene.steps || []).findIndex(st => st && st.id === stepId);
        if (idx < 0) return false;
        this._pushReturnFrame(finishJump);
        this._fragmentSession = {
            sceneId: scene.id,
            orderedIndices: [idx],
            returnInPlace: true,
            exitStepIndex: idx + 1,
            fragmentId: '',
            singleStepReturnInPlace: true
        };
        this.currentSceneId = scene.id;
        this.currentStepIndex = idx;
        if (typeof StoryEffects !== 'undefined' && StoryEffects.playMusicForScene) {
            StoryEffects.playMusicForScene(scene);
        }
        if (typeof Renderer !== 'undefined' && Renderer.renderScene) {
            Renderer.renderScene(scene, { inheritedBackground: opts && opts.inheritedBackground });
        }
        this._effectsFreshFromSceneRender = true;
        this.uiMode = { mode: 'none' };
        this.enterCurrentStep();
        return true;
    },

    /**
     * `{jpos_槽id_sc|lb}` 在 jpos_* 未写入时，用工程里该槽的显示名去读 `__jp__显示名__*`（与随机/选项蓝线写入的别名一致）。
     */
    _jumpSlotJposKeyFallbackFromAlias(jposKey) {
        const m = /^jpos_([a-z0-9]{4,32})_(sc|lb)$/.exec(String(jposKey || ''));
        if (!m || typeof GameState === 'undefined' || !GameState.get) return '';
        const which = m[2];
        const project = this.storyData;
        if (!project || !Array.isArray(project.jumpSlots)) return '';
        const row = project.jumpSlots.find(s => s && String(s.id || '').trim() === m[1]);
        const base = row && row.name != null ? String(row.name).trim() : '';
        if (!base || !this.isValidJumpPositionAliasBaseName(base)) return '';
        const ak =
            which === 'sc' ? this.jumpPositionAliasSceneKey(base) : this.jumpPositionAliasLabelKey(base);
        const v = GameState.get(ak);
        return v != null && v !== undefined ? String(v).trim() : '';
    },

    /** 将 sceneId / labelSuffix 中的 `{变量名}` 替换为 GameState；`{复用返回场景}` 优先取当前剧情/复用模块栈顶记录的分支目标场景 id */
    _resolveJumpTemplate(str) {
        if (str == null) return '';
        const s = String(str);
        if (!/\{/.test(s)) return s;
        const SLOT = this._REUSE_RESUME_SCENE_SLOT || '复用返回场景';
        const st = this._storyModuleStack;
        const top = st && st.length ? st[st.length - 1] : null;
        const fromStack = top && top.reuseResumeSceneId != null ? String(top.reuseResumeSceneId).trim() : '';
        const escSlot = SLOT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        let out = s.replace(new RegExp(`\\{${escSlot}\\}`, 'g'), () => {
            if (fromStack) return fromStack;
            if (typeof GameState !== 'undefined' && GameState.get) {
                const g = GameState.get(SLOT);
                return g != null && g !== undefined ? String(g).trim() : '';
            }
            return '';
        });
        out = out.replace(/\{([\w\u4e00-\u9fff]+)\}/g, (full, key) => {
            if (key === SLOT) return '';
            if (typeof GameState !== 'undefined' && GameState.get) {
                let v = GameState.get(key);
                let outVal = v != null && v !== undefined ? String(v).trim() : '';
                if (!outVal && /^jpos_[a-z0-9]{4,32}_(sc|lb)$/.test(key)) {
                    outVal = this._jumpSlotJposKeyFallbackFromAlias(key);
                }
                return outVal;
            }
            return '';
        });
        return out;
    },

    _syncReuseResumeSceneGameState() {
        const SLOT = this._REUSE_RESUME_SCENE_SLOT || '复用返回场景';
        if (typeof GameState === 'undefined' || !GameState.set) return;
        const st = this._storyModuleStack;
        const top = st && st.length ? st[st.length - 1] : null;
        const v = top && top.reuseResumeSceneId != null ? String(top.reuseResumeSceneId).trim() : '';
        GameState.set(SLOT, v);
    },

    _sceneHasBackground(scene) {
        return !!(scene && scene.background && String(scene.background.url || '').trim());
    },

    _cloneSceneBackgroundForModule(scene) {
        if (!this._sceneHasBackground(scene)) return null;
        return JSON.parse(JSON.stringify(scene.background || {}));
    },

    _getInheritedBackgroundForScene(scene) {
        if (this._sceneHasBackground(scene)) return null;
        const st = this._storyModuleStack;
        const top = st && st.length ? st[st.length - 1] : null;
        if (!top || top.moduleKind !== 'storyModule') return null;
        if (top.moduleSceneId !== scene.id) return null;
        return top.inheritedBackground || null;
    },

    _abortCgNonLoopVideoWait() {
        this._cgNonLoopWaitActive = false;
        if (this._cgNonLoopVideoPollTid != null) {
            try {
                window.clearInterval(this._cgNonLoopVideoPollTid);
            } catch {}
            this._cgNonLoopVideoPollTid = null;
        }
        if (this._cgVideoReleaseCleanup) {
            try {
                this._cgVideoReleaseCleanup();
            } catch {}
            this._cgVideoReleaseCleanup = null;
        }
    },

    /**
     * 非循环 CG 视频未自然播完前执行 onDone（跨场景推迟、随机步后自动推进等共用）。
     */
    _armCgNonLoopVideoWait(onDone) {
        this._abortCgNonLoopVideoWait();
        if (typeof onDone !== 'function') return;
        const src = this.getActiveCgOverlayStep();
        if (!src || !this._cgVideoPlaythroughBlocksAdvance(src)) {
            onDone();
            return;
        }
        const srcId = src && src.id != null ? String(src.id) : '';
        let finished = false;
        const finish = () => {
            if (finished) return;
            finished = true;
            this._cgNonLoopWaitActive = false;
            this._abortCgNonLoopVideoWait();
            onDone();
        };
        this._cgNonLoopWaitActive = true;
        const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
        const tick = () => {
            if (!this._cgNonLoopWaitActive) return;
            const sess = this._cgSession;
            if (!sess || !sess.visualActive || !sess.sourceStep || String(sess.sourceStep.id) !== srcId) {
                finish();
                return;
            }
            if (!this._cgVideoPlaythroughBlocksAdvance(sess.sourceStep)) {
                finish();
                return;
            }
            if (typeof performance !== 'undefined' && performance.now() - t0 > 90000) {
                if (typeof console !== 'undefined' && console.warn) {
                    console.warn('[SceneManager] 非循环 CG 视频等待超时，强制继续');
                }
                finish();
            }
        };
        const story = typeof document !== 'undefined' ? document.getElementById('layer-story') : null;
        const v0 = story && story.querySelector('video');
        let removeEnded = null;
        if (v0) {
            const onEnded = () => finish();
            v0.addEventListener('ended', onEnded, { once: true });
            removeEnded = () => {
                try {
                    v0.removeEventListener('ended', onEnded);
                } catch {}
            };
        }
        this._cgNonLoopVideoPollTid = window.setInterval(tick, 80);
        const pollTid = this._cgNonLoopVideoPollTid;
        this._cgVideoReleaseCleanup = () => {
            if (removeEnded) removeEnded();
            if (pollTid != null) {
                try {
                    window.clearInterval(pollTid);
                } catch {}
            }
            this._cgNonLoopVideoPollTid = null;
        };
        tick();
    },

    /**
     * jumpToScene 后半段：清 CG 会话、换 currentSceneId、渲染、enterCurrentStep。
     */
    _jumpToSceneFinishBody(sid, startLabel, jumpOpts, sameScene) {
        this._abortCgNonLoopVideoWait();
        this._deferredCrossSceneJumpActive = false;
        /**
         * 跨场景：停 CG 轨、清会话、关 story 层（与旧行为一致）。
         * 同场景仅换入口（常见写法 next.type=scene + 本场景 id + labelSuffix）：不要整段清 CG，
         * 否则「娃娃机里醒来」内点选项跳到同场另一标签，会误停未配置「停音乐步」的 CG BGM，
         * 且 renderScene 会清空 layer-story，与「CG 延续到停步/下一段 CG」冲突。
         */
        if (!sameScene) {
            if (typeof StoryEffects !== 'undefined' && StoryEffects.stopCgMusicOnly) StoryEffects.stopCgMusicOnly();
            if (typeof StoryEffects !== 'undefined' && StoryEffects.discardPendingCgBgmResume) {
                StoryEffects.discardPendingCgBgmResume();
            }
            this._cgSession = null;
            if (typeof UIManager !== 'undefined' && UIManager.closeCgStep) {
                UIManager.closeCgStep();
            }
        }
        const previousFragmentSession = this._fragmentSession;
        this._fragmentSession = null;
        this._cgFadeBusy = false;
        this._cgExitInProgress = false;

        this.currentSceneId = sid;
        const scene = this.getScene(sid);
        if (!scene) {
            if (typeof console !== 'undefined' && console.warn) {
                console.warn('[SceneManager] 找不到场景', sid);
            }
            this._traceJump('missing-scene-abort', { sceneId: sid, labelSuffix: startLabel || '' });
            return;
        }
        scene.appearedValue = 1;
        if (typeof GameState !== 'undefined' && GameState.markSceneAppeared) {
            GameState.markSceneAppeared(scene.id);
        }
        this.currentStepIndex = 0;
        if (startLabel) {
            const targetLabel = String(startLabel || '').trim();
            const idx = (scene.steps || []).findIndex(s => s && String(s.labelSuffix || '').trim() === targetLabel);
            if (idx >= 0) this.currentStepIndex = idx;
            else {
                this._traceJump('missing-label-fallback-scene-start', { sceneId: sid, labelSuffix: targetLabel });
                if (typeof console !== 'undefined' && console.warn) {
                    console.warn('[SceneManager] 跳转标签未找到，保留场景开头作为兜底', scene.id, targetLabel);
                }
            }
        }
        this._traceJump('jump-finish', {
            sceneId: sid,
            sceneName: scene.name || '',
            labelSuffix: startLabel || '',
            stepIndex: this.currentStepIndex
        });
        if (!(jumpOpts && jumpOpts.skipFragmentActivate)) {
            this._activateFragmentSessionIfStepInFragment(scene, this.currentStepIndex);
            if (
                previousFragmentSession &&
                previousFragmentSession.returnInPlace !== false &&
                this._fragmentSession
            ) {
                this._fragmentSession.returnInPlace = true;
            }
        }
        if (!sameScene) {
            if (typeof StoryEffects !== 'undefined' && StoryEffects.playMusicForScene) {
                StoryEffects.playMusicForScene(scene);
            }
            if (typeof Renderer !== 'undefined') {
                Renderer.renderScene(scene, { inheritedBackground: this._getInheritedBackgroundForScene(scene) });
            }
            this._effectsFreshFromSceneRender = true;
        } else {
            this._effectsFreshFromSceneRender = false;
        }
        if (!(jumpOpts && jumpOpts.skipEnterStep)) {
            this.enterCurrentStep();
        }
    },

    /**
     * @param {string} sceneId
     * @param {string} [startLabelSuffix]
     * @param {{ skipEnterStep?: boolean, skipFragmentActivate?: boolean } | null} [jumpOpts] skipEnterStep：只换场景/渲染/BGM，不进入某步（供片段预览先 jump 再 enterFragment）
     */
    jumpToScene(sceneId, startLabelSuffix = '', jumpOpts = null) {
        // 仅取消上一段「等视频」的监听；勿在此处清空挂起的跨场跳转参数（否则第二次 jumpToScene 会拆掉第一次的推迟跳转）。
        this._abortCgNonLoopVideoWait();
        this._deferredCrossSceneJumpActive = false;

        const rawSid = sceneId != null ? String(sceneId) : '';
        const rawLab = startLabelSuffix != null ? String(startLabelSuffix) : '';
        const bundle = this.tryResolveJumpPositionAliasBundle(rawSid, rawLab);
        const hadBraceSid = /\{/.test(rawSid);
        let sid = '';
        let startLabel = '';
        if (bundle) {
            sid = bundle.sceneId;
            startLabel = bundle.labelSuffix;
        } else {
            sid = this._resolveJumpTemplate(rawSid).trim();
            startLabel = this._resolveJumpTemplate(rawLab);
        }
        if (!sid) {
            if (hadBraceSid && typeof console !== 'undefined' && console.warn) {
                console.warn('[SceneManager] 跳转场景 id 模板解析为空，落到 start', rawSid);
            }
            this._traceJump('empty-scene-fallback-start', { rawSceneId: rawSid, rawLabelSuffix: rawLab });
            sid = 'start';
        }
        const targetExists =
            this.storyData &&
            Array.isArray(this.storyData.scenes) &&
            this.storyData.scenes.some(s => s && s.id === sid);
        if (!targetExists) {
            this._traceJump('invalid-scene-fallback-start', {
                rawSceneId: rawSid,
                rawLabelSuffix: rawLab,
                sceneId: sid,
                labelSuffix: startLabel || ''
            });
            sid = 'start';
            startLabel = '';
        }
        const sameScene = this.currentSceneId != null && sid === this.currentSceneId;
        const curLeaving = this.currentSceneId;
        if (!sameScene && this._storyModuleStack && this._storyModuleStack.length && curLeaving) {
            const top = this._storyModuleStack[this._storyModuleStack.length - 1];
            if (top && top.moduleSceneId === curLeaving && sid !== curLeaving) {
                const stay = jumpOpts && jumpOpts.reuseModuleStay;
                if (!stay && top.moduleKind !== 'storyModule') {
                    if (top.reuseExitBindings) this._applyReuseFixedExits(top.reuseExitBindings);
                    this._storyModuleStack.pop();
                    this._syncReuseResumeSceneGameState();
                }
            }
        }

        if (!sameScene) {
            const src = this.getActiveCgOverlayStep();
            if (src && this._cgVideoPlaythroughBlocksAdvance(src)) {
                const cap = { sceneId: sid, startLabel, jumpOpts };
                this._deferredCrossSceneJumpActive = true;
                this._armCgNonLoopVideoWait(() => {
                    if (!this._deferredCrossSceneJumpActive) return;
                    this._deferredCrossSceneJumpActive = false;
                    this._jumpToSceneFinishBody(cap.sceneId, cap.startLabel, cap.jumpOpts, false);
                });
                return;
            }
        }

        this._jumpToSceneFinishBody(sid, startLabel, jumpOpts, sameScene);
    },

    /** 兼容旧 API：jumpTo(id) */
    jumpTo(id) {
        this.jumpToScene(id, '');
    },

    getCurrentStep() {
        const scene = this.getScene(this.currentSceneId);
        if (!scene || !Array.isArray(scene.steps)) return null;
        return scene.steps[this.currentStepIndex] || null;
    },

    clearCgSessionHard(scene) {
        this._abortCgNonLoopVideoWait();
        this._deferredCrossSceneJumpActive = false;
        this._cgSession = null;
        if (typeof UIManager !== 'undefined' && UIManager.closeCgStep) UIManager.closeCgStep();
        if (typeof StoryEffects !== 'undefined') {
            if (StoryEffects.stopCgMusicResumeBgm && scene) StoryEffects.stopCgMusicResumeBgm(scene, 0);
            else if (StoryEffects.stopCgMusicOnly) StoryEffects.stopCgMusicOnly();
        }
    },

    /** 进入某步时：按 CG 步骤上配置的「在第几步停止」处理画面与音乐 */
    applyCgSessionForEnterStep(scene, step) {
        const sess = this._cgSession;
        if (!sess || !sess.sourceStep) {
            if (typeof UIManager !== 'undefined' && UIManager.syncCgCharacterOverStackClass) {
                UIManager.syncCgCharacterOverStackClass();
            }
            return;
        }
        const src = sess.sourceStep;
        // 编辑/加载后 source步已取消 CG 音乐，但会话里仍为 musicActive 时，立刻停 CG 轨并恢复场景 BGM
        // 若会话仍标为有声但步上已无别名且未记录实际播放别名，停 CG 轨（异常/热改数据兜底）
        const persistedAlias = String(src.cgMusicAlias || '').trim();
        const playingAlias = String(sess.cgMusicPlayingAlias || '').trim();
        if (sess.musicActive && !persistedAlias && !playingAlias) {
            if (typeof StoryEffects !== 'undefined' && StoryEffects.stopCgMusicResumeBgm) {
                StoryEffects.stopCgMusicResumeBgm(scene, 0);
            }
            sess.musicActive = false;
        }
        if (sess.musicActive && src.cgMusicStopAtStepId && step.id === src.cgMusicStopAtStepId) {
            if (typeof StoryEffects !== 'undefined' && StoryEffects.stopCgMusicResumeBgm) {
                StoryEffects.stopCgMusicResumeBgm(scene);
            }
            sess.musicActive = false;
        }
        if (sess.visualActive && src.cgStopAtStepId && step.id === src.cgStopAtStepId) {
            const needsDef =
                typeof StoryFxEngine !== 'undefined' &&
                StoryFxEngine.sourceNeedsDeferredCgClose &&
                StoryFxEngine.sourceNeedsDeferredCgClose(src);
            if (needsDef) {
                sess.deferredCgVisualClose = true;
            } else {
                const fout = 0;
                let faded = false;
                if (
                    typeof UIManager !== 'undefined' &&
                    UIManager.beginCgStepExit &&
                    UIManager.closeCgStep &&
                    Number.isFinite(fout) &&
                    fout > 0
                ) {
                    faded = UIManager.beginCgStepExit(src, () => {
                        UIManager.closeCgStep();
                        sess.visualActive = false;
                        if (!sess.visualActive && !sess.musicActive) {
                            this._cgSession = null;
                        }
                        this._redrawCurrentCharacterAfterCgClose();
                    });
                    if (faded) sess.visualClosing = true;
                }
                if (!faded) {
                    if (typeof UIManager !== 'undefined' && UIManager.closeCgStep) UIManager.closeCgStep();
                    sess.visualActive = false;
                    this._redrawCurrentCharacterAfterCgClose();
                }
            }
        }
        if (!sess.visualActive && !sess.musicActive) {
            this._cgSession = null;
        }
        if (typeof UIManager !== 'undefined' && UIManager.syncCgCharacterOverStackClass) {
            UIManager.syncCgCharacterOverStackClass();
        }
    },

    /** 进入新的 CG 步骤：顶替上一段 CG（画面+音乐） */
    enterCgStepSession(scene, step) {
        const prev = this._cgSession && this._cgSession.sourceStep;
        if (prev && prev.id !== step.id) {
            if (typeof StoryEffects !== 'undefined' && StoryEffects.stopCgMusicOnly) StoryEffects.stopCgMusicOnly();
            const keepPreviousCgVisual =
                prev &&
                prev.type === 'cg' &&
                step &&
                step.type === 'cg' &&
                prev.cg &&
                step.cg;
            if (!keepPreviousCgVisual && typeof UIManager !== 'undefined' && UIManager.closeCgStep) {
                UIManager.closeCgStep();
            }
        }
        // 同一 CG 步骤再次进入、或编辑去掉 cgMusicAlias 后：上一分支会因 id 相同而不 stop，须显式停掉 CG 音轨
        // 配乐留空 = 不播 CG 配乐（与编辑器一致）。脚本未写配乐时应在「导入写入 episode」阶段按手册 2.1 节填入别名，不在此处运行时随机。
        const cgMusicAlias = String(step.cgMusicAlias || '').trim();
        if (!cgMusicAlias && typeof StoryEffects !== 'undefined' && StoryEffects.stopCgMusicOnly) {
            StoryEffects.stopCgMusicOnly();
        }
        this._cgSession = {
            sourceStep: step,
            visualActive: true,
            musicActive: !!cgMusicAlias,
            /** 实际在播的 CG 曲别名（通常与 step.cgMusicAlias 一致） */
            cgMusicPlayingAlias: cgMusicAlias || '',
            visualClosing: false,
            deferredCgVisualClose: false
        };
        if (cgMusicAlias) {
            if (typeof StoryEffects !== 'undefined' && StoryEffects.playCgMusic) {
                StoryEffects.playCgMusic(cgMusicAlias, step.cgMusicLoop !== false);
            }
        } else if (typeof StoryEffects !== 'undefined' && StoryEffects.stopCgMusicResumeBgm) {
            // 无 CG 配乐：停 CG 轨并恢复「CG 前 BGM」或按场景顺延（与 CG 正常结束一致）
            StoryEffects.stopCgMusicResumeBgm(scene, 0);
        }
    },

    resolveVariableDialogueStep(step) {
        if (!step || (step.type !== 'dialogue' && step.type !== 'narration')) return { step, skip: false };
        const cfg = step.variableDialogue && typeof step.variableDialogue === 'object' ? step.variableDialogue : null;
        if (!cfg) return { step, skip: false };
        const isNarration = step.type === 'narration';
        const mode = ['none', 'single', 'relation', 'randomLines'].includes(cfg.mode)
            ? cfg.mode
            : cfg.enabled === true
              ? 'single'
              : 'none';
        if (mode === 'none') return { step, skip: false };
        const defaultExpression = String(cfg.defaultExpression || step.expression || '').trim();
        const fallback = String(cfg.fallback || 'default');
        if (mode === 'randomLines') {
            const lines = Array.isArray(cfg.randomLines)
                ? cfg.randomLines.map(x => String(x == null ? '' : x).replace(/\r\n/g, '\n').trim()).filter(Boolean)
                : String(cfg.randomText || '')
                      .replace(/\r\n/g, '\n')
                      .split(/\n\s*\n/)
                      .map(x => x.trim())
                      .filter(Boolean);
            const text = lines.length
                ? lines[
                      Math.floor(
                          (typeof GameState !== 'undefined' && GameState.random ? GameState.random() : Math.random()) *
                              lines.length
                      )
                  ]
                : step.text || '';
            let speakerRef = String(step.speakerRef || '').trim();
            const varName = String(cfg.variableName || '').trim();
            if (!isNarration && varName) speakerRef = `{${varName}}`;
            return {
                step: {
                    ...step,
                    speakerRef,
                    expression: defaultExpression,
                    text
                },
                skip: false
            };
        }
        const fallbackResult = detail => {
            if (fallback === 'skip') return { step, skip: true };
            if (fallback === 'hint') {
                return {
                    step: {
                        ...step,
                        type: 'narration',
                        speakerRef: '',
                        expression: '',
                        text: detail || '变量对应未匹配'
                    },
                    skip: false
                };
            }
            return {
                step: {
                    ...step,
                    expression: defaultExpression,
                    text: step.text || ''
                },
                skip: false
            };
        };
        if (mode === 'relation') {
            if (typeof GameState === 'undefined' || !GameState.get) return { step, skip: false };
            const tables = (this.storyData && Array.isArray(this.storyData.variableRelationTables))
                ? this.storyData.variableRelationTables
                : [];
            const table = tables.find(t => t && t.id === cfg.relationTableId);
            if (!table) return fallbackResult('对应关系台词表未选择或不存在');
            const rawA = GameState.get(String(table.varA || '').trim());
            const rawB = GameState.get(String(table.varB || '').trim());
            const curA = rawA != null && rawA !== undefined ? String(rawA).trim() : '';
            const curB = rawB != null && rawB !== undefined ? String(rawB).trim() : '';
            const candidates = value => {
                const out = new Set();
                const v = String(value || '').trim();
                if (v) out.add(v);
                const ch = this.findCharacterByNameOrId(v);
                if (ch) {
                    if (ch.id) out.add(String(ch.id).trim());
                    if (ch.name) out.add(String(ch.name).trim());
                }
                return out;
            };
            const setA = candidates(curA);
            const setB = candidates(curB);
            const sourceRow = (Array.isArray(table.rows) ? table.rows : []).find(r => {
                if (!r) return false;
                return setA.has(String(r.a || '').trim()) && setB.has(String(r.b || '').trim());
            });
            if (!sourceRow) return fallbackResult(`对应关系台词未匹配：${table.varA || '变量一'}=${curA || '（空）'}，${table.varB || '变量二'}=${curB || '（空）'}`);
            const relRows = Array.isArray(cfg.relationRows) ? cfg.relationRows : [];
            const sourceRowId = String(sourceRow.id || '').trim();
            const hit = relRows.find(r =>
                r &&
                (sourceRowId
                    ? String(r.sourceRowId || '').trim() === sourceRowId
                    : String(r.a || '').trim() === String(sourceRow.a || '').trim() &&
                      String(r.b || '').trim() === String(sourceRow.b || '').trim())
            );
            if (!hit || !String(hit.text || '').trim()) return fallbackResult(`对应关系台词未填写：${sourceRow.a || ''} - ${sourceRow.b || ''}`);
            return {
                step: {
                    ...step,
                    expression: String(hit.expression || defaultExpression || '').trim(),
                    text: String(hit.text || '').replace(/\r\n/g, '\n')
                },
                skip: false
            };
        }
        let varName = String(cfg.variableName || '').trim();
        if (!varName) {
            const m = String(step.speakerRef || '').trim().match(/^\{([^}]+)\}$/);
            if (m) varName = String(m[1] || '').trim();
        }
        if (!varName || typeof GameState === 'undefined' || !GameState.get) return { step, skip: false };
        const raw = GameState.get(varName);
        const current = raw != null && raw !== undefined ? String(raw).trim() : '';
        const rows = Array.isArray(cfg.rows) ? cfg.rows : [];
        const hit = rows.find(r => r && String(r.value || '').trim() === current);
        if (hit) {
            const speaker = String(hit.speakerRef || hit.value || current || '').trim();
            const expression = String(hit.expression || defaultExpression || '').trim();
            const text = hit.text != null ? String(hit.text).replace(/\r\n/g, '\n') : '';
            return {
                step: {
                    ...step,
                    speakerRef: isNarration ? '' : speaker,
                    expression: isNarration ? '' : expression,
                    text
                },
                skip: false
            };
        }
        if (fallback === 'skip') return { step, skip: true };
        if (fallback === 'hint') {
            return {
                step: {
                    ...step,
                    type: 'narration',
                    speakerRef: '',
                    expression: '',
                    text: `变量台词未匹配：${varName} = ${current || '（空）'}`
                },
                skip: false
            };
        }
        return {
            step: {
                ...step,
                speakerRef: isNarration ? '' : `{${varName}}`,
                expression: isNarration ? '' : defaultExpression,
                text: step.text || ''
            },
            skip: false
        };
    },

    resolveVariableCgStep(step) {
        if (!step || step.type !== 'cg') return step;
        const cfg = step.cgVariableMap && typeof step.cgVariableMap === 'object' ? step.cgVariableMap : null;
        if (!cfg) return step;
        const mode = ['none', 'single', 'relation'].includes(cfg.mode) ? cfg.mode : 'none';
        if (mode === 'none') return step;
        const chooseCg = row => {
            const next = { ...step };
            const defaultCg = cfg.defaultCg && typeof cfg.defaultCg === 'object' ? cfg.defaultCg : null;
            const rowCg = row && row.cg && typeof row.cg === 'object' ? row.cg : null;
            const cg = rowCg && rowCg.url ? rowCg : defaultCg && defaultCg.url ? defaultCg : step.cg;
            if (cg) next.cg = { ...cg };
            const rowMusic = row && row.cgMusicAlias != null ? String(row.cgMusicAlias || '').trim() : '';
            const defaultMusic = cfg.defaultMusicAlias != null ? String(cfg.defaultMusicAlias || '').trim() : '';
            next.cgMusicAlias = rowMusic || defaultMusic || String(step.cgMusicAlias || '').trim();
            return next;
        };
        const candidates = value => {
            const out = new Set();
            const v = String(value || '').trim();
            if (v) out.add(v);
            const ch = this.findCharacterByNameOrId(v);
            if (ch) {
                if (ch.id) out.add(String(ch.id).trim());
                if (ch.name) out.add(String(ch.name).trim());
            }
            return out;
        };
        if (mode === 'single') {
            if (typeof GameState === 'undefined' || !GameState.get) return chooseCg(null);
            const varName = String(cfg.variableName || '').trim();
            if (!varName) return chooseCg(null);
            const raw = GameState.get(varName);
            const cur = raw != null && raw !== undefined ? String(raw).trim() : '';
            const curSet = candidates(cur);
            const row = (Array.isArray(cfg.rows) ? cfg.rows : []).find(r => r && curSet.has(String(r.value || '').trim()));
            return chooseCg(row || null);
        }
        if (mode === 'relation') {
            if (typeof GameState === 'undefined' || !GameState.get) return chooseCg(null);
            const tables = this.storyData && Array.isArray(this.storyData.variableRelationTables) ? this.storyData.variableRelationTables : [];
            const table = tables.find(t => t && t.id === cfg.relationTableId);
            if (!table) return chooseCg(null);
            const rawA = GameState.get(String(table.varA || '').trim());
            const rawB = GameState.get(String(table.varB || '').trim());
            const setA = candidates(rawA != null && rawA !== undefined ? String(rawA).trim() : '');
            const setB = candidates(rawB != null && rawB !== undefined ? String(rawB).trim() : '');
            const sourceRow = (Array.isArray(table.rows) ? table.rows : []).find(r => r && setA.has(String(r.a || '').trim()) && setB.has(String(r.b || '').trim()));
            if (!sourceRow) return chooseCg(null);
            const sourceRowId = String(sourceRow.id || '').trim();
            const row = (Array.isArray(cfg.relationRows) ? cfg.relationRows : []).find(r =>
                r &&
                (sourceRowId
                    ? String(r.sourceRowId || '').trim() === sourceRowId
                    : String(r.a || '').trim() === String(sourceRow.a || '').trim() &&
                      String(r.b || '').trim() === String(sourceRow.b || '').trim())
            );
            return chooseCg(row || null);
        }
        return step;
    },

    enterCurrentStep() {
        const scene = this.getScene(this.currentSceneId);
        const step = this.getCurrentStep();
        if (!scene || !step) return;
        try {
        const t = step.type || 'dialogue';
        let variableDialogueResolved = null;
        if (t === 'dialogue' || t === 'narration') {
            variableDialogueResolved = this.resolveVariableDialogueStep(step);
            if (variableDialogueResolved && variableDialogueResolved.skip) {
                this.deferAdvanceStep();
                return;
            }
            const dialogueStepForExist = variableDialogueResolved ? variableDialogueResolved.step : step;
            if (t === 'dialogue' && !this.dialogueStepPassesSpeakerExist(dialogueStepForExist, scene)) {
                this.deferAdvanceStep();
                return;
            }
        }
        step.appearedValue = 1;
        if (typeof GameState !== 'undefined' && GameState.markStepAppeared) {
            GameState.markStepAppeared(step.id);
        }
        this.maybeTriggerAutoAnnouncement('enter-step-appeared');

        const cgStep = t === 'cg' ? this.resolveVariableCgStep(step) : step;
        if (t !== 'cg') {
            this._cgFadeInBlockUntilMs = 0;
        }
        // 仅「新 CG 步」顶替会话；对白/旁白/选项/随机/问答等一律走 applyCgSession，
        // 以便 CG 与 CG 音乐按源步上的「在第几步停止」进入该步时才结束（不再在进入选项时整段 clear）。
        //
        // CG 步须先播步骤音效、再 enterCgStepSession：后者会立刻恢复场景 BGM / 播 CG 配乐（Audio.play）。
        // 若顺序相反，浏览器自动播放策略常只允许同一瞬间一条「无手势」音频，紧随其后的音效 play() 会静默失败（effects.playSound 空 catch），表现为「CG 音效从未播出」。
        if (t === 'cg') {
            if (step.soundAlias && typeof StoryEffects !== 'undefined' && StoryEffects.playSound) {
                StoryEffects.playSound(step.soundAlias);
            }
            this.enterCgStepSession(scene, cgStep);
            if (typeof GalleryConfig !== 'undefined' && GalleryConfig.recordCgUnlockFromStep) {
                GalleryConfig.recordCgUnlockFromStep(this.storyData, scene, step, cgStep);
            }
        } else {
            this.applyCgSessionForEnterStep(scene, step);
        }

        const activeCgOverlayStep = this.getActiveCgOverlayStep();
        const hideCharForCgOverlay = activeCgOverlayStep && activeCgOverlayStep.hideCharacter !== false;

        if (hideCharForCgOverlay) {
            const charLayer = document.getElementById('layer-char');
            if (charLayer) charLayer.innerHTML = '';
        }

        const runApplyStepFx = () => {
            if (typeof StoryEffects !== 'undefined' && StoryEffects.applyStepFx) {
                StoryEffects.applyStepFx(step);
            }
        };

        if (typeof StoryEffects !== 'undefined') {
            let skipCleanup = this._effectsFreshFromSceneRender;
            this._effectsFreshFromSceneRender = false;
            if (
                !skipCleanup &&
                typeof StoryFxEngine !== 'undefined' &&
                StoryFxEngine.shouldSkipCleanupForOverlay &&
                activeCgOverlayStep
            ) {
                skipCleanup = StoryFxEngine.shouldSkipCleanupForOverlay(activeCgOverlayStep, step, this._cgSession);
            }
            if (!skipCleanup && StoryEffects.cleanupStepVisualFx) {
                StoryEffects.cleanupStepVisualFx();
            }
        }

        // 冲击特效 + 自定义音效（冲突规则：只播自定义音效）；v2 步骤特效选「冲击」时由 applyStepFx 播放，此处跳过以免重复
        const v2ShockHasEffect =
            step &&
            step.stepFx &&
            typeof step.stepFx === 'object' &&
            Number(step.stepFx.v) === 2 &&
            String(step.stepFx.family || '').trim() === 'shock' &&
            String(step.stepFx.effect || '').trim();
        if (!v2ShockHasEffect && step.dramaticEffect && typeof StoryEffects !== 'undefined' && StoryEffects._runDramatic) {
            const hasCustomSound = !!step.soundAlias;
            StoryEffects._runDramatic(step.dramaticEffect, { muteSound: hasCustomSound });
        }
        if (
            t !== 'cg' &&
            step.soundAlias &&
            typeof StoryEffects !== 'undefined' &&
            StoryEffects.playSound
        ) {
            StoryEffects.playSound(step.soundAlias);
        }

        if (typeof UIManager !== 'undefined' && UIManager.hideOptions) UIManager.hideOptions();
        this.uiMode = { mode: 'none' };

        const deferCharPoolLoopEffects = step && step.type === 'charPool' && step.charPoolMode === 'loop';
        // 统一：步骤进入时应用 effects（台词/CG/随机/选项分支）——此处先处理 step.effects
        if (!deferCharPoolLoopEffects && typeof GameState !== 'undefined' && GameState.applyEffects && Array.isArray(step.effects)) {
            GameState.applyEffects(step.effects);
        }
        if (!deferCharPoolLoopEffects) {
            if (this.maybeTriggerAutoJump('enter-step-effects')) return;
            this.maybeTriggerAutoAnnouncement('enter-step-effects');
        }

        if (t === 'hiddenMap') {
            runApplyStepFx();
            this._scheduleCharacterRedraw(scene, step, true);
            const mapId = String(step.hiddenMapModuleId || '').trim();
            if (typeof HiddenMapConfig !== 'undefined') HiddenMapConfig.normalizeProject(this.storyData);
            const map =
                typeof HiddenMapConfig !== 'undefined'
                    ? HiddenMapConfig.findMap(this.storyData, mapId)
                    : null;
            if (!map || typeof HiddenMapRuntime === 'undefined') {
                if (typeof UIManager !== 'undefined' && UIManager.showTextStep) {
                    UIManager.showTextStep(scene, { ...step, type: 'narration', text: '寻物地图未配置，请检查步骤设置。' }, activeCgOverlayStep);
                }
                this.uiMode = { mode: 'hidden_map_missing', stepId: step.id };
                return;
            }
            this.uiMode = { mode: 'hidden_map', stepId: step.id };
            HiddenMapRuntime.start({
                project: this.storyData,
                scene,
                step,
                map,
                characterId: step.receiverCharacterId || '',
                onFinish: () => {
                    this.uiMode = { mode: 'none' };
                    const next = this._readFinishJump(step) || (step.next && typeof step.next === 'object' ? step.next : null);
                    if (next) this.applyNext(next);
                    else this.advanceStep();
                }
            });
            return;
        }

        if (t === 'gallery') {
            runApplyStepFx();
            this._scheduleCharacterRedraw(scene, step, hideCharForCgOverlay);
            this.uiMode = { mode: 'gallery', stepId: step.id };
            if (typeof UIManager !== 'undefined' && UIManager.showGalleryModule) {
                const shown = UIManager.showGalleryModule(step.galleryModuleId, {
                    source: 'step',
                    onReturn: () => {
                        this.uiMode = { mode: 'none' };
                        const next = this._readFinishJump(step) || (step.next && typeof step.next === 'object' ? step.next : null);
                        if (next) this.applyNext(next);
                        else this.advanceStep();
                    }
                });
                if (shown === false) this.uiMode = { mode: 'none' };
            } else {
                this.deferAdvanceStep();
            }
            return;
        }

        if (t === 'graphicReading') {
            if (
                step.moduleNoReplay &&
                typeof GameState !== 'undefined' &&
                GameState.get &&
                String(step.graphicReadingModuleId || '').trim() &&
                Number(GameState.get(this.graphicReadingSeenVarKey(String(step.graphicReadingModuleId || '').trim())) || 0) === 1
            ) {
                this._skipNoReplayModuleStep(step);
                return;
            }
            runApplyStepFx();
            this._scheduleCharacterRedraw(scene, step, true);
            this._startGraphicReadingStep(scene, step);
            return;
        }

        if (t === 'storyModule') {
            if (
                step.moduleNoReplay &&
                typeof GameState !== 'undefined' &&
                GameState.get &&
                String(step.storyModuleId || '').trim() &&
                Number(GameState.get(this.storyModuleSeenVarKey(String(step.storyModuleId || '').trim())) || 0) === 1
            ) {
                this._skipNoReplayModuleStep(step);
                return;
            }
            runApplyStepFx();
            this._scheduleCharacterRedraw(scene, step, hideCharForCgOverlay);
            const smid = String(step.storyModuleId || '').trim();
            const list = Array.isArray(this.storyData.storyModules) ? this.storyData.storyModules : [];
            const mod = smid && list.find(m => m && m.id === smid);
            const target = mod && String(mod.targetSceneId || '').trim();
            if (!mod || !target) {
                if (typeof console !== 'undefined' && console.warn) {
                    console.warn('[SceneManager] 剧情模块未配置或目标场景为空', smid);
                }
                window.setTimeout(() => this.advanceStep(), 0);
                return;
            }
            if (typeof GameState !== 'undefined' && GameState.set) {
                GameState.set(this.storyModuleSeenVarKey(smid), 1);
            }
            const mode = ['scene', 'step', 'fragment'].includes(mod.targetMode) ? mod.targetMode : '';
            if (mode === 'step') {
                const ok = this.enterSingleStepReturnInPlace(
                    target,
                    String(mod.targetStepId || '').trim(),
                    this._readFinishJump(step),
                    { inheritedBackground: this._cloneSceneBackgroundForModule(scene) }
                );
                if (!ok && typeof console !== 'undefined' && console.warn) {
                    console.warn('[SceneManager] 剧情模块单独步骤无效', smid, mod.targetStepId);
                }
                if (!ok) window.setTimeout(() => this.advanceStep(), 0);
                return;
            }
            if (mode === 'fragment') {
                this._pushReturnFrame(this._readFinishJump(step));
                const ok = this.enterFragment(String(mod.targetFragmentId || '').trim(), target, '', {
                    forceReturnInPlace: true,
                    renderScene: true,
                    inheritedBackground: this._cloneSceneBackgroundForModule(scene)
                });
                if (!ok && typeof console !== 'undefined' && console.warn) {
                    console.warn('[SceneManager] 剧情模块步骤片段无效', smid, mod.targetFragmentId);
                }
                if (!ok) {
                    if (this._returnStack && this._returnStack.length) this._returnStack.pop();
                    window.setTimeout(() => this.advanceStep(), 0);
                }
                return;
            }
            const lab = mode === 'scene' ? '' : mod.entryLabelSuffix != null ? String(mod.entryLabelSuffix).trim() : '';
            if (!this._storyModuleStack) this._storyModuleStack = [];
            this._storyModuleStack.push({
                callerSceneId: this.currentSceneId,
                callerStepIndex: this.currentStepIndex + 1,
                callerOriginalStepIndex: this.currentStepIndex,
                moduleSceneId: target,
                moduleKind: 'storyModule',
                inheritedBackground: this._cloneSceneBackgroundForModule(scene),
                reuseResumeSceneId: target
            });
            this._syncReuseResumeSceneGameState();
            this.jumpToScene(target, lab);
            return;
        }

        if (t === 'reuseModule') {
            runApplyStepFx();
            this._scheduleCharacterRedraw(scene, step, hideCharForCgOverlay);
            const rid = String(step.reuseModuleId || '').trim();
            const list = Array.isArray(this.storyData.reuseModules) ? this.storyData.reuseModules : [];
            const mod = rid && list.find(m => m && m.id === rid);
            const entryScene = mod && mod.entrySceneId ? this.getScene(mod.entrySceneId) : null;
            const labelSuf = mod && mod.entryLabelSuffix != null ? String(mod.entryLabelSuffix).trim() : '';
            const entrySource =
                mod && (mod.entrySource === 'choiceResult' || mod.entrySource === 'randomResult')
                    ? mod.entrySource
                    : mod && mod.entrySource === 'gameVariable'
                      ? 'gameVariable'
                      : 'dialogueSpeaker';
            let entryKey = '';
            let entryStep = null;
            if (entrySource === 'gameVariable') {
                const vn = mod && mod.entryVariableName != null ? String(mod.entryVariableName).trim() : '';
                if (vn && typeof GameState !== 'undefined' && GameState.get) {
                    const raw = GameState.get(vn);
                    entryKey = raw != null && raw !== undefined ? String(raw).trim() : '';
                }
            } else if (entryScene && Array.isArray(entryScene.steps)) {
                entryStep = entryScene.steps.find(s => s && String(s.labelSuffix || '') === labelSuf) || null;
                const est = entryStep;
                if (entrySource === 'dialogueSpeaker') {
                    if (est && est.type === 'dialogue' && est.speakerRef) entryKey = String(est.speakerRef).trim();
                } else if (entrySource === 'choiceResult') {
                    if (est && est.type === 'choice') entryKey = this.getReuseEntryOutcome(est.id);
                } else if (entrySource === 'randomResult') {
                    if (est && est.type === 'random') entryKey = this.getReuseEntryOutcome(est.id);
                }
            }
            const branches = mod && Array.isArray(mod.branches) ? mod.branches : [];
            let br =
                branches.find(b => b && String(b.keyCharacterId || '').trim() === entryKey) ||
                branches.find(b => b && String(b.keyCharacterId || '').trim() === '*') ||
                branches[0];
            const target = br && String(br.targetSceneId || '').trim();
            if (!mod || !target) {
                if (typeof console !== 'undefined' && console.warn) {
                    console.warn('[SceneManager] 复用模块未配置或分支目标场景为空', rid);
                }
                window.setTimeout(() => this.advanceStep(), 0);
                return;
            }
            const ewv = mod && mod.entryWriteVarName != null ? String(mod.entryWriteVarName).trim() : '';
            if (ewv && typeof GameState !== 'undefined' && GameState.set) {
                GameState.set(ewv, entryKey != null ? String(entryKey) : '');
            }
            const secondBase =
                mod && mod.entrySecondOutputBaseName != null ? String(mod.entrySecondOutputBaseName).trim() : '';
            if (
                secondBase &&
                entryStep &&
                (entrySource === 'randomResult' || entrySource === 'choiceResult') &&
                typeof GameState !== 'undefined' &&
                GameState.get &&
                GameState.set
            ) {
                const slotId = this.getEffectiveJumpSlotIdForStep(this.storyData, entryScene.id, entryStep);
                if (slotId) {
                    const kSc = this.jumpSlotSceneVarKey(slotId);
                    const kLb = this.jumpSlotLabelVarKey(slotId);
                    if (kSc && kLb) {
                        const vs = GameState.get(kSc);
                        const vl = GameState.get(kLb);
                        GameState.set(`${secondBase}场景`, vs != null && vs !== undefined ? String(vs).trim() : '');
                        GameState.set(`${secondBase}标签`, vl != null && vl !== undefined ? String(vl).trim() : '');
                    }
                }
            }
            const lab = br.entryLabelSuffix != null ? String(br.entryLabelSuffix).trim() : '';
            if (!this._storyModuleStack) this._storyModuleStack = [];
            const bindings = Array.isArray(mod.exitBindings) ? JSON.parse(JSON.stringify(mod.exitBindings)) : [];
            const popBinds = Array.isArray(mod.popExitBindings) ? JSON.parse(JSON.stringify(mod.popExitBindings)) : [];
            this._storyModuleStack.push({
                callerSceneId: this.currentSceneId,
                callerStepIndex: this.currentStepIndex + 1,
                callerOriginalStepIndex: this.currentStepIndex,
                moduleSceneId: target,
                reuseExitBindings: bindings,
                reusePopBindings: popBinds,
                reuseEntryKeyUsed: entryKey,
                reuseResumeSceneId: target
            });
            this._syncReuseResumeSceneGameState();
            this.jumpToScene(target, lab);
            return;
        }

        if (step.type === 'choice') {
            this.uiMode = { mode: 'choice', stepId: step.id };
            if (typeof UIManager !== 'undefined' && UIManager.showChoiceStep) {
                UIManager.showChoiceStep(step);
            }
            runApplyStepFx();
            this._scheduleCharacterRedraw(scene, step, hideCharForCgOverlay);
            return;
        }

        if (step.type === 'random') {
            const picked = this.pickWeightedRandom(step);
            if (!picked) return;
            const rk = this.resolveRandomRowReuseEntryKey(
                picked,
                picked._ri != null ? picked._ri : 0,
                step
            );
            this.recordReuseEntryOutcome(step.id, rk);
            this.applyReuseExitOnRandom(scene.id, step.id, picked);
            const slotId = this.getEffectiveJumpSlotIdForStep(this.storyData, scene.id, step);
            let slotNext = null;
            if (slotId) {
                slotNext = this.getJumpSlotNextForRandomRow(picked, step);
                if (slotNext) this.writeJumpSlotFromSceneNext(this.storyData, slotId, slotNext);
            }
            this.writeRandomPickNamedVars(step, picked);
            if (typeof GameState !== 'undefined' && GameState.applyWeightAdjustments && Array.isArray(picked.weightAdjustments)) {
                GameState.applyWeightAdjustments(picked.weightAdjustments);
            }
            if (picked.effects && typeof GameState !== 'undefined' && GameState.applyEffects) {
                GameState.applyEffects(picked.effects);
            }
            if (this.maybeTriggerAutoJump('random-row-effects')) return;
            if (picked.next) {
                this._traceJump('random-picked-next', {
                    stepId: step.id || '',
                    stepLabel: step.labelSuffix || '',
                    next: picked.next
                });
                const n = picked.next;
                if (
                    n &&
                    n.type === 'scene' &&
                    String(n.sceneId || '').trim() === String(scene.id || '').trim()
                ) {
                    const lab = typeof n.labelSuffix === 'string' ? n.labelSuffix.trim() : '';
                    if (lab) {
                        if (this._shouldPushReturnFrame()) this._pushReturnFrame();
                        this.jumpToScene(n.sceneId || 'start', n.labelSuffix || '');
                    } else {
                        // 同场景且未指定入口标签：表示「继续本场景下一步」（勿 jump 到第 0 步，否则会跳过随机步之后的步骤，如复用模块）
                        this.deferAdvanceStep();
                    }
                } else {
                    this.applyNext(picked.next);
                }
            } else this.deferAdvanceStep();
            return;
        }

        if (step.type === 'relationRandom') {
            const picked = this.pickRelationRandom(step);
            const writeVar = (key, value) => {
                const k = String(key || '').trim();
                if (k && typeof GameState !== 'undefined' && GameState.set) GameState.set(k, value != null ? value : '');
            };
            if (!picked) {
                const emptyNext = step.emptyNext && typeof step.emptyNext === 'object' ? step.emptyNext : null;
                if (emptyNext && (emptyNext.type === 'return' || String(emptyNext.sceneId || '').trim())) {
                    this.applyNext(emptyNext);
                } else {
                    this.deferAdvanceStep();
                }
                return;
            }
            writeVar(step.relationResultVarName, picked.name);
            writeVar(step.relationResultIdVarName, picked.id || '');
            writeVar(step.relationResultKindVarName, picked.kind);
            let next = null;
            const kindCode =
                picked.kindCode ||
                (picked.kind === '\u6b63\u786e\u5c0f\u653b'
                    ? 'correct'
                    : picked.kind === '\u9519\u8bef\u5c0f\u653b'
                      ? 'wrong'
                      : picked.kind === '\u9a6c\u55bd'
                        ? 'malou'
                        : '');
            if (kindCode === 'correct') next = this.getRelationCorrectBranchNext(step, picked) || step.correctNext;
            else if (kindCode === 'wrong') next = step.wrongNext;
            else if (kindCode === 'malou') next = step.malouNext;
            if (next) this.applyNext(next);
            else this.deferAdvanceStep();
            return;
        }

        if (step.type === 'charPool') {
            const mode = step.charPoolMode === 'loop' ? 'loop' : step.charPoolMode === 'lovePairChoice' ? 'lovePairChoice' : 'choice';
            const picked = mode === 'lovePairChoice' ? this.pickLovePairPool(step) : this.pickCharacterPool(step);
            const writeVar = (key, value) => {
                const k = String(key || '').trim();
                if (k && typeof GameState !== 'undefined' && GameState.set) GameState.set(k, value != null ? value : '');
            };
            const effectiveCharPoolNext = next => {
                if (!next || typeof next !== 'object') return null;
                if (
                    next.type === 'scene' &&
                    String(next.sceneId || '').trim() === String(scene && scene.id || '').trim() &&
                    !String(next.labelSuffix || '').trim()
                ) {
                    return null;
                }
                return next;
            };
            writeVar(step.charPoolCountVarName, picked.length);
            if (!picked.length) {
                const emptyNext = effectiveCharPoolNext(step.emptyNext);
                if (emptyNext && (emptyNext.type === 'return' || String(emptyNext.sceneId || '').trim())) {
                    this.applyNext(emptyNext);
                } else {
                    this.deferAdvanceStep();
                }
                return;
            }
            const charPoolExtraOptionRows = () => this._buildCharPoolExtraOptionRows(step, effectiveCharPoolNext);
            if (mode === 'lovePairChoice') {
                this.uiMode = { mode: 'choice', stepId: step.id };
                if (typeof UIManager !== 'undefined' && UIManager.showOptions) {
                    UIManager.showOptions(
                        picked.map((pair, oi) => ({
                            text: pair.label || `${pair.ukeName || pair.ukeId} 和 ${pair.semeName || pair.semeId}`,
                            onChoose: () => {
                                if (typeof UIManager !== 'undefined' && UIManager.hideOptions) UIManager.hideOptions();
                                writeVar(step.lovePairUkeVarName || '本轮小受', pair.ukeName || pair.ukeId);
                                writeVar(step.lovePairUkeIdVarName, pair.ukeId);
                                writeVar(step.lovePairSemeVarName || '本轮小攻', pair.semeName || pair.semeId);
                                writeVar(step.lovePairSemeIdVarName, pair.semeId);
                                writeVar(step.lovePairGroupVarName || '本轮恋人组', pair.groupId);
                                writeVar(step.charPoolChoiceIndexVarName, oi + 1);
                                if (Array.isArray(step.choiceEffects) && typeof GameState !== 'undefined' && GameState.applyEffects) {
                                    GameState.applyEffects(step.choiceEffects);
                                }
                                if (this.maybeTriggerAutoJump('char-pool-love-pair-choice-effects')) return;
                                const fj = this._readFinishJump(step);
                                const next = fj || effectiveCharPoolNext(step.next);
                                if (next) this.applyNext(next);
                                else this.deferAdvanceStep();
                            }
                        })).concat(charPoolExtraOptionRows()),
                        null
                    );
                }
                runApplyStepFx();
                this._scheduleCharacterRedraw(scene, step, hideCharForCgOverlay);
                return;
            }
            if (mode === 'loop') {
                const queueKey = `charpool_queue_${step.id}`;
                const indexKey = `charpool_index_${step.id}`;
                writeVar(queueKey, picked.map(c => c.id).join('|'));
                writeVar(indexKey, 0);
                writeVar(step.charPoolResultVarName, picked[0].name || picked[0].id);
                writeVar(step.charPoolResultIdVarName, picked[0].id);
                if (Array.isArray(step.effects) && typeof GameState !== 'undefined' && GameState.applyEffects) {
                    picked.forEach((ch, pi) => {
                        writeVar(step.charPoolResultVarName, ch.name || ch.id);
                        writeVar(step.charPoolResultIdVarName, ch.id);
                        writeVar(step.charPoolChoiceIndexVarName, pi + 1);
                        GameState.applyEffects(step.effects);
                    });
                    writeVar(step.charPoolResultVarName, picked[0].name || picked[0].id);
                    writeVar(step.charPoolResultIdVarName, picked[0].id);
                    writeVar(step.charPoolChoiceIndexVarName, 1);
                    if (this.maybeTriggerAutoJump('char-pool-loop-effects')) return;
                    this.maybeTriggerAutoAnnouncement('char-pool-loop-effects');
                }
                const fj = this._readFinishJump(step);
                const next = fj || effectiveCharPoolNext(step.next);
                if (next) {
                    this._traceJump(fj ? 'char-pool-finish-jump' : 'char-pool-next', {
                        stepId: step.id || '',
                        stepLabel: step.labelSuffix || '',
                        next
                    });
                    this.applyNext(next);
                }
                else this.deferAdvanceStep();
                return;
            }
            this.uiMode = { mode: 'choice', stepId: step.id };
            if (typeof UIManager !== 'undefined' && UIManager.showOptions) {
                UIManager.showOptions(
                    picked.map((ch, oi) => ({
                        text: ch.name || ch.id,
                        characterId: ch.id,
                        onChoose: () => {
                            if (typeof UIManager !== 'undefined' && UIManager.hideOptions) UIManager.hideOptions();
                            writeVar(step.charPoolResultVarName, ch.name || ch.id);
                            writeVar(step.charPoolResultIdVarName, ch.id);
                            writeVar(step.charPoolChoiceIndexVarName, oi + 1);
                            if (Array.isArray(step.choiceEffects) && typeof GameState !== 'undefined' && GameState.applyEffects) {
                                GameState.applyEffects(step.choiceEffects);
                            }
                            if (this.maybeTriggerAutoJump('char-pool-choice-effects')) return;
                            const fj = this._readFinishJump(step);
                            const next = fj || effectiveCharPoolNext(step.next);
                            if (next) {
                                this._traceJump(fj ? 'char-pool-finish-jump' : 'char-pool-next', {
                                    stepId: step.id || '',
                                    stepLabel: step.labelSuffix || '',
                                    next
                                });
                                this.applyNext(next);
                            }
                            else this.deferAdvanceStep();
                        }
                    })).concat(charPoolExtraOptionRows()),
                    null
                );
            }
            runApplyStepFx();
            this._scheduleCharacterRedraw(scene, step, hideCharForCgOverlay);
            return;
        }

        if (step.type === 'charPoolNext') {
            const queueKey = `charpool_queue_${String(step.charPoolStepId || '').trim()}`;
            const indexKey = `charpool_index_${String(step.charPoolStepId || '').trim()}`;
            const raw = typeof GameState !== 'undefined' && GameState.get ? String(GameState.get(queueKey) || '') : '';
            const ids = raw.split('|').map(s => s.trim()).filter(Boolean);
            const curIndex = typeof GameState !== 'undefined' && GameState.get ? Number(GameState.get(indexKey) || 0) : 0;
            const nextIndex = curIndex + 1;
            const effectiveCharPoolNext = next => {
                if (!next || typeof next !== 'object') return null;
                if (
                    next.type === 'scene' &&
                    String(next.sceneId || '').trim() === String(scene && scene.id || '').trim() &&
                    !String(next.labelSuffix || '').trim()
                ) {
                    return null;
                }
                return next;
            };
            if (nextIndex < ids.length) {
                const ch = this.findCharacterById(ids[nextIndex]);
                if (ch) {
                    if (typeof GameState !== 'undefined' && GameState.set) {
                        GameState.set(indexKey, nextIndex);
                        if (step.charPoolResultVarName) GameState.set(step.charPoolResultVarName, ch.name || ch.id);
                        if (step.charPoolResultIdVarName) GameState.set(step.charPoolResultIdVarName, ch.id);
                    }
                    const next = effectiveCharPoolNext(step.next);
                    if (next) this.applyNext(next);
                    else this.deferAdvanceStep();
                    return;
                }
            }
            const doneNext = effectiveCharPoolNext(step.doneNext);
            if (doneNext) this.applyNext(doneNext);
            else this.deferAdvanceStep();
            return;
        }

        if (step.type === 'quiz') {
            const picked = this._pickQuizQuestion(step);
            const game = picked && picked.game ? picked.game : null;
            const q = picked && picked.question ? picked.question : null;
            const overlayCg = this.getActiveCgOverlayStep();
            if (!game) {
                if (typeof UIManager !== 'undefined' && UIManager.showTextStep) {
                    UIManager.showTextStep(scene, { ...step, type: 'narration', text: '问答模块不存在，请检查 quizGameId。' }, overlayCg);
                }
                this.uiMode = { mode: 'quiz_result', stepId: step.id };
                return;
            }
            if (!q) {
                const msg = game.exhaustedMessage || '本问答模块没有可用题目了。';
                if (typeof UIManager !== 'undefined' && UIManager.showTextStep) {
                    UIManager.showTextStep(scene, { ...step, type: 'narration', text: msg }, overlayCg);
                }
                this.uiMode = { mode: 'quiz_result', stepId: step.id };
                return;
            }
            const qRows = this._buildQuizOptions(q);
            if (typeof UIManager !== 'undefined' && UIManager.showTextStep) {
                UIManager.showTextStep(scene, { ...step, type: 'dialogue', text: q.prompt || '请选择答案：' }, overlayCg);
            }
            const effective =
                typeof QuizGameConfig !== 'undefined' && QuizGameConfig.effectiveQuestion
                    ? QuizGameConfig.effectiveQuestion(game, q)
                    : {
                          correctPoints: Number(q.correctPoints || 0),
                          wrongPoints: Number(q.wrongPoints || 0),
                          hintCorrect: q.hintCorrect || '',
                          hintWrong: q.hintWrong || '',
                          correct: q.correct || 'A'
                      };
            this._quizSession = { stepId: step.id, gameId: game.id, questionId: q.id };
            this.uiMode = { mode: 'choice', stepId: step.id };
            if (typeof UIManager !== 'undefined' && UIManager.showOptions) {
                UIManager.showOptions(
                    qRows.map(r => ({
                        text: r.text,
                        onChoose: () => {
                            if (typeof UIManager !== 'undefined' && UIManager.hideOptions) UIManager.hideOptions();
                            const isCorrect = String(r.key || '').toUpperCase() === String(effective.correct || '').toUpperCase();
                            if (typeof GameState !== 'undefined' && GameState.set) {
                                GameState.set(`quiz_seen_${game.id}_${q.id}`, 1);
                            }
                            if (typeof GameState !== 'undefined') {
                                const delta = isCorrect ? Number(effective.correctPoints || 0) : Number(effective.wrongPoints || 0);
                                const scoreResult = this._applyQuizScoreDelta(game, delta);
                                const nextScore = scoreResult && Number.isFinite(Number(scoreResult.scoreAfter)) ? Number(scoreResult.scoreAfter) : 0;
                                if (this.maybeTriggerAutoJump('quiz-score-updated')) return;
                                this.maybeTriggerAutoAnnouncement('quiz-score-updated');
                                const tip = this._formatQuizFeedback(game, isCorrect, delta, nextScore, effective);
                                if (typeof UIManager !== 'undefined' && UIManager.showTextStep) {
                                    UIManager.showTextStep(
                                        scene,
                                        {
                                            ...step,
                                            type: 'dialogue',
                                            text: tip
                                        },
                                        overlayCg
                                    );
                                }
                                this.uiMode = { mode: 'quiz_result', stepId: step.id };
                                return;
                            }
                            if (typeof UIManager !== 'undefined' && UIManager.showTextStep) {
                                UIManager.showTextStep(
                                    scene,
                                    {
                                        ...step,
                                        type: 'dialogue',
                                        text: isCorrect ? '回答正确。' : '回答错误。'
                                    },
                                    overlayCg
                                );
                            }
                            this.uiMode = { mode: 'quiz_result', stepId: step.id };
                        }
                    })),
                    null
                );
            }
            runApplyStepFx();
            this._scheduleCharacterRedraw(scene, step, hideCharForCgOverlay);
            return;
        }

        if (step.type === 'randomDisplay') {
            const overlayCg = this.getActiveCgOverlayStep();
            this._randomDisplaySession = null;
            const picked =
                typeof RandomDisplayConfig !== 'undefined'
                    ? RandomDisplayConfig.pickModuleItem(this.storyData, step)
                    : { module: null, item: null };
            const module = picked && picked.module;
            const item = picked && picked.item;
            if (!module) {
                if (typeof UIManager !== 'undefined' && UIManager.showTextStep) {
                    UIManager.showTextStep(
                        scene,
                        { ...step, type: 'narration', text: '随机展示模块不存在或未配置，请检查 randomDisplayModuleId。' },
                        overlayCg
                    );
                }
                this._randomDisplaySession = { rdStep: step, exhausted: true, noModule: true };
                this.uiMode = { mode: 'random_display', stepId: step.id };
                runApplyStepFx();
                this._scheduleCharacterRedraw(scene, step, hideCharForCgOverlay);
                return;
            }
            if (!item) {
                const msg = module.exhaustedMessage != null ? String(module.exhaustedMessage) : '本模块没有还可展示的内容了。';
                if (typeof UIManager !== 'undefined' && UIManager.showTextStep) {
                    UIManager.showTextStep(scene, { ...step, type: 'narration', text: msg }, overlayCg);
                }
                this._randomDisplaySession = { rdStep: step, exhausted: true, module };
                this.uiMode = { mode: 'random_display', stepId: step.id };
                runApplyStepFx();
                this._scheduleCharacterRedraw(scene, step, hideCharForCgOverlay);
                return;
            }
            if (typeof GameState !== 'undefined' && GameState.set) {
                const titleVar = String(step.randomDisplayTitleVarName || '').trim();
                const typeVar = String(step.randomDisplayTypeVarName || '').trim();
                if (titleVar) GameState.set(titleVar, item.title || '');
                if (typeVar) GameState.set(typeVar, item.typeName || '');
            }
            if (step.rdGuessEnabled && step.rdGuess && typeof UIManager !== 'undefined' && UIManager.showOptions) {
                this._randomDisplaySession = { rdStep: step, module, item, synthCgStep: null, pendingGuess: true };
                this._showRandomDisplayGuess(scene, step, module, item, overlayCg);
                runApplyStepFx();
                this._scheduleCharacterRedraw(scene, step, hideCharForCgOverlay);
                return;
            }
            if (typeof RandomDisplayConfig !== 'undefined') RandomDisplayConfig.markItemSeen(module, item);
            this._randomDisplaySession = { rdStep: step, module, item, synthCgStep: null };
            runApplyStepFx();
            this._scheduleCharacterRedraw(scene, step, hideCharForCgOverlay);
            this._randomDisplayRunFlowFromStart(scene, step, module, item, overlayCg);
            return;
        }

        if (step.type === 'topicPool') {
            runApplyStepFx();
            this._scheduleCharacterRedraw(scene, step, hideCharForCgOverlay);
            this._startTopicPoolStep(scene, step);
            return;
        }

        if (step.type === 'cg') {
            const fin = 0;
            this._cgFadeInBlockUntilMs =
                fin > 0 && typeof performance !== 'undefined' ? performance.now() + fin + 60 : 0;
            this._afterCgInputBlockUntilMs = 0;
            this.uiMode = { mode: 'cg', stepId: step.id };
            if (typeof UIManager !== 'undefined' && UIManager.showCgStep) {
                UIManager.showCgStep(cgStep);
            }
            // 先让 layer-story 内媒体完成布局，再套步骤特效，避免与 CG 自身淡入争抢 transform/opacity 导致画面缩小、下移
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    runApplyStepFx();
                    this._scheduleCharacterRedraw(scene, cgStep, hideCharForCgOverlay);
                });
            });
            return;
        }

        if (typeof UIManager !== 'undefined' && UIManager.showTextStep) {
            const overlayCg = this.getActiveCgOverlayStep();
            const showStep = variableDialogueResolved ? variableDialogueResolved.step : step;
            UIManager.showTextStep(scene, showStep, overlayCg);
            runApplyStepFx();
            this._scheduleCharacterRedraw(scene, showStep, hideCharForCgOverlay);
            return;
        }
        runApplyStepFx();
        this._scheduleCharacterRedraw(scene, step, hideCharForCgOverlay);
        } finally {
            if (typeof UIManager !== 'undefined' && UIManager.syncCgCharacterOverStackClass) {
                UIManager.syncCgCharacterOverStackClass();
            }
            if (typeof PlaySave !== 'undefined' && PlaySave.tryAutoSaveAfterEnterStep) {
                PlaySave.tryAutoSaveAfterEnterStep(scene, step, this.storyData);
            }
        }
    },

    /** 在对话框等布局更新后再测距绘制立绘（小图模式依赖对话框上沿位置） */
    _scheduleCharacterRedraw(scene, step, charHiddenByCg) {
        if (charHiddenByCg) return;
        const run = () => {
            if (typeof Renderer !== 'undefined' && Renderer.renderCharacterForStep) {
                Renderer.renderCharacterForStep(scene, step);
            }
        };
        if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(run);
        else run();
    },

    _redrawCurrentCharacterAfterCgClose() {
        const scene = this.getScene(this.currentSceneId);
        const step = this.getCurrentStep();
        if (!scene || !step || step.type !== 'dialogue') return;
        const run = () => {
            if (typeof Renderer !== 'undefined' && Renderer.renderCharacterForStep) {
                Renderer.renderCharacterForStep(scene, step);
            }
        };
        if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(run);
        else run();
    },

    /** 条件过滤 + 加权随机；候选为空则结束游戏 */
    _buildCharPoolExtraOptionRows(step, effectiveCharPoolNext) {
        const extras = Array.isArray(step && step.charPoolExtraOptions) ? step.charPoolExtraOptions : [];
        return extras
            .filter(o => o && String(o.text || '').trim())
            .map(o => ({
                text: String(o.text).trim(),
                onChoose: () => {
                    if (typeof UIManager !== 'undefined' && UIManager.hideOptions) UIManager.hideOptions();
                    const next = effectiveCharPoolNext(o.next);
                    if (next) this.applyNext(next);
                    else this.deferAdvanceStep();
                }
            }));
    },

    pickWeightedRandom(step) {
        const rows = (step && step.table) || (step && step.rows) || [];
        const scene = this.getScene(this.currentSceneId);
        const sceneId = (scene && scene.id) || '';
        const stepLab = step && step.labelSuffix != null ? String(step.labelSuffix) : '';
        const candidates = [];
        let total = 0;
        rows.forEach((r, ri) => {
            if (!r) return;
            if (!this.evalCondition(r.condition)) return;
            if (step && step.hideIfJumpTargetSeen && this.isJumpTargetAlreadyAppeared(r.next)) return;
            if (step && step.filterBySpeakerExist && !this.randomRowPassesSpeakerExist(r)) return;
            if (!this.choiceOrRandomNextIsAvailable(r.next, step)) return;
            let w = Number(r.weight);
            if (!Number.isFinite(w)) w = 0;
            if (typeof GameState !== 'undefined' && GameState.getRandomWeightAdjustment && stepLab) {
                w += GameState.getRandomWeightAdjustment(sceneId, stepLab, ri);
            }
            if (!Number.isFinite(w) || w <= 0) return;
            total += w;
            candidates.push({ ...r, _w: w, _ri: ri });
        });
        if (!candidates.length || total <= 0) {
            if (typeof UIManager !== 'undefined' && UIManager.showGameOver) {
                UIManager.showGameOver(
                    '因为没有随机可选项，游戏结束。（可能原因：条件不满足、权重≤0，或「出现」筛掉全部行，或「存在」筛掉全部行。）'
                );
            } else {
                alert('因为没有随机可选项，游戏结束。');
            }
            this.uiMode = { mode: 'none' };
            return null;
        }
        const r = typeof GameState !== 'undefined' && GameState.random ? GameState.random() : Math.random();
        let x = r * total;
        for (const c of candidates) {
            x -= c._w;
            if (x <= 0) return c;
        }
        return candidates[candidates.length - 1];
    },

    graphicReadingSeenVarKey(moduleId) {
        return `gr_seen_${String(moduleId || '').replace(/[^\w]/g, '_')}`;
    },
    storyModuleSeenVarKey(moduleId) {
        return `sm_seen_${String(moduleId || '').replace(/[^\w]/g, '_')}`;
    },

    isModuleNoReplayTargetSeen(next) {
        if (!next || typeof next !== 'object' || typeof GameState === 'undefined' || !GameState.get) return false;
        if (next.type === 'graphicReading') {
            const id = String(next.graphicReadingModuleId || '').trim();
            return !!(id && Number(GameState.get(this.graphicReadingSeenVarKey(id)) || 0) === 1);
        }
        if (next.type === 'storyModule') {
            const id = String(next.storyModuleId || '').trim();
            return !!(id && Number(GameState.get(this.storyModuleSeenVarKey(id)) || 0) === 1);
        }
        if (next.type === 'topicPool' && typeof TopicPoolConfig !== 'undefined') {
            const mid = String(next.topicPoolModuleId || '').trim();
            const iid = String(next.topicPoolItemId || '').trim();
            return !!(mid && iid && Number(GameState.get(TopicPoolConfig.seenVarKey(mid, iid)) || 0) === 1);
        }
        return false;
    },

    choiceOrRandomNextIsAvailable(next, hostStep = null) {
        if (!next || typeof next !== 'object') return true;
        if (hostStep && hostStep.moduleNoReplay && this.isModuleNoReplayTargetSeen(next)) return false;
        if (next.type === 'loadSave') return true;
        if (next.type !== 'randomDisplay') return true;
        const moduleId = String(next.randomDisplayModuleId || '').trim();
        if (!moduleId || typeof RandomDisplayConfig === 'undefined') return false;
        const module = RandomDisplayConfig.findModule(this.storyData, moduleId);
        if (!module || !Array.isArray(module.items) || !module.items.length) return false;
        const available =
            typeof RandomDisplayConfig.listAvailableItems === 'function'
                ? RandomDisplayConfig.listAvailableItems(module)
                : module.items.filter(it => it && it.id);
        const mode = next.randomDisplayPickMode === 'randomAll' ? 'randomAll' : 'randomUnseen';
        if (mode === 'randomAll') return available.some(it => it && it.id);
        return available.some(it => {
            if (!it || !it.id) return false;
            if (typeof GameState === 'undefined' || !GameState.get) return true;
            return Number(GameState.get(RandomDisplayConfig.seenVarKey(module.id, it.id)) || 0) !== 1;
        });
    },

    findCharacterById(charId) {
        const id = String(charId || '').trim();
        if (!id || !this.storyData || !Array.isArray(this.storyData.characterRoster)) return null;
        return this.storyData.characterRoster.find(c => c && c.id === id) || null;
    },

    findCharacterByNameOrId(value) {
        const t = String(value || '').trim();
        if (!t || !this.storyData || !Array.isArray(this.storyData.characterRoster)) return null;
        return this.storyData.characterRoster.find(c => c && (String(c.id || '').trim() === t || String(c.name || '').trim() === t)) || null;
    },

    dialogueStepPassesSpeakerExist(step, scene) {
        if (!step || step.type !== 'dialogue' || step.requireSpeakerExist !== true) return true;
        const rawRef = String((step && step.speakerRef) || (scene && scene.characterRef) || '').trim();
        if (!rawRef) return true;
        const resolvedRef = this.resolveCharacterRef(rawRef);
        const ch = this.findCharacterByNameOrId(resolvedRef || rawRef);
        if (!ch || !ch.id) return true;
        return this._unifiedExistPassForCharId(ch.id);
    },

    resolveCharacterRef(value, candidateId = '') {
        let t = String(value || '').trim();
        if (t === '__candidate__') return String(candidateId || '').trim();
        const m = t.match(/^\{([^}]+)\}$/);
        if (m && typeof GameState !== 'undefined' && GameState.get) {
            t = String(GameState.get(String(m[1] || '').trim()) || '').trim();
        }
        const ch = this.findCharacterByNameOrId(t);
        return ch && ch.id ? ch.id : t;
    },

    parseRelationRandomMap(text) {
        const map = new Map();
        String(text || '')
            .split(/\r?\n/)
            .forEach(line => {
                const raw = String(line || '').trim();
                if (!raw || raw.startsWith('#') || raw.startsWith('//')) return;
                const m = raw.match(/^(.+?)(?:->|=>|[:：=])(.+)$/);
                if (!m) return;
                const key = String(m[1] || '').trim();
                const values = String(m[2] || '')
                    .split(/[、,，;；|\/]+/)
                    .map(s => s.trim())
                    .filter(Boolean);
                if (!key || !values.length) return;
                const old = map.get(key) || [];
                map.set(key, old.concat(values));
            });
        return map;
    },

    resolveRelationRandomTargetPool(step) {
        const roster = this.storyData && Array.isArray(this.storyData.characterRoster) ? this.storyData.characterRoster : [];
        const source = step && step.relationTargetSource === 'all' ? 'all' : 'type';
        const typeIds = Array.isArray(step && step.relationTargetTypeIds)
            ? step.relationTargetTypeIds.map(x => String(x || '').trim()).filter(Boolean)
            : [];
        return roster.filter(c => {
            if (!c || !c.id) return false;
            if (source === 'type' && typeIds.length) return typeIds.includes(String(c.characterTypeId || '').trim());
            return true;
        });
    },

    relationRandomCharacterPassesExist(ch, requireExists) {
        if (!requireExists) return true;
        if (!ch || !ch.id) return true;
        return this._unifiedExistPassForCharId(ch.id);
    },

    pickOneFromList(list) {
        const arr = Array.isArray(list) ? list.filter(Boolean) : [];
        if (!arr.length) return null;
        const r = typeof GameState !== 'undefined' && GameState.random ? GameState.random() : Math.random();
        return arr[Math.floor(r * arr.length)] || arr[arr.length - 1];
    },

    relationPairBranchKey(sourceName, targetName) {
        return `${String(sourceName || '').trim()}→${String(targetName || '').trim()}`;
    },

    getRelationCorrectBranchNext(step, picked) {
        const branches = step && step.relationCorrectBranches && typeof step.relationCorrectBranches === 'object'
            ? step.relationCorrectBranches
            : null;
        if (!branches || !picked) return null;
        const sourceKeys = [picked.sourceRaw, picked.sourceName, picked.sourceId].map(x => String(x || '').trim()).filter(Boolean);
        const targetKeys = [picked.name, picked.id].map(x => String(x || '').trim()).filter(Boolean);
        const keys = [];
        sourceKeys.forEach(source => {
            targetKeys.forEach(target => {
                const pairKey = this.relationPairBranchKey(source, target);
                if (pairKey && !keys.includes(pairKey)) keys.push(pairKey);
            });
        });
        targetKeys.forEach(key => {
            if (key && !keys.includes(key)) keys.push(key);
        });
        for (const key of keys) {
            const n = branches[key];
            if (!n || typeof n !== 'object') continue;
            if (n.type === 'return') return n;
            if (n.type === 'scene' && String(n.sceneId || '').trim()) return n;
            if (n.type === 'label' && String(n.labelSuffix || '').trim()) return n;
            if (n.type === 'fragment' && String(n.fragmentId || '').trim()) return n;
        }
        return null;
    },

    buildRelationRandomMapFromTable(step) {
        const tableId = String((step && step.relationTableId) || '').trim();
        if (!tableId) return null;
        const tables = this.storyData && Array.isArray(this.storyData.variableRelationTables)
            ? this.storyData.variableRelationTables
            : [];
        const table = tables.find(t => t && String(t.id || '').trim() === tableId);
        if (!table || !Array.isArray(table.rows)) return null;
        const sourceVar = String((step && step.relationSourceVarName) || '').trim();
        const targetVar = String((step && step.relationResultVarName) || '').trim();
        const varA = String(table.varA || '').trim();
        const varB = String(table.varB || '').trim();
        const reverse = sourceVar && targetVar && sourceVar === varB && targetVar === varA;
        const map = new Map();
        table.rows.forEach(row => {
            if (!row) return;
            const source = String((reverse ? row.b : row.a) || '').trim();
            const target = String((reverse ? row.a : row.b) || '').trim();
            if (!source || !target) return;
            const old = map.get(source) || [];
            if (!old.includes(target)) old.push(target);
            map.set(source, old);
        });
        return map.size ? map : null;
    },

    pickRelationRandom(step) {
        const sourceVar = String((step && step.relationSourceVarName) || '').trim();
        const rawSource =
            sourceVar && typeof GameState !== 'undefined' && GameState.get
                ? String(GameState.get(sourceVar) || '').trim()
                : '';
        const sourceChar = this.findCharacterByNameOrId(rawSource);
        const relationMap = this.buildRelationRandomMapFromTable(step) || this.parseRelationRandomMap(step && step.relationMapText);
        const sourceKeys = [rawSource];
        if (sourceChar) {
            sourceKeys.push(String(sourceChar.name || '').trim(), String(sourceChar.id || '').trim());
        }
        const correctNames = [];
        sourceKeys.forEach(k => {
            if (!k) return;
            const rows = relationMap.get(k) || [];
            rows.forEach(v => {
                if (v && !correctNames.includes(v)) correctNames.push(v);
            });
        });
        const targetPool = this.resolveRelationRandomTargetPool(step);
        const targetIds = new Set(targetPool.map(c => String(c.id || '').trim()).filter(Boolean));
        const targetNames = new Set(targetPool.map(c => String(c.name || '').trim()).filter(Boolean));
        const correctChars = [];
        correctNames.forEach(name => {
            const ch = this.findCharacterByNameOrId(name);
            if (!ch || !ch.id) return;
            if (!targetIds.has(String(ch.id || '').trim()) && !targetNames.has(String(ch.name || '').trim())) return;
            if (!this.relationRandomCharacterPassesExist(ch, !!(step && step.relationRequireCorrectExists))) return;
            if (!correctChars.some(c => c && c.id === ch.id)) correctChars.push(ch);
        });
        const correctIds = new Set(correctChars.map(c => c.id));
        const rawCorrectIds = new Set(
            correctNames
                .map(name => this.findCharacterByNameOrId(name))
                .filter(Boolean)
                .map(c => c.id)
        );
        const wrongChars = targetPool.filter(ch => {
            if (!ch || !ch.id) return false;
            if (rawCorrectIds.has(ch.id) || correctIds.has(ch.id)) return false;
            return this.relationRandomCharacterPassesExist(ch, !!(step && step.relationRequireWrongExists));
        });
        const malouChar = this.findCharacterByNameOrId('马喽');
        const malouAvailable = step && step.relationRequireMalouExists
            ? !!(malouChar && this.relationRandomCharacterPassesExist(malouChar, true))
            : true;
        const kindLabels = {
            correct: '\u6b63\u786e\u5c0f\u653b',
            wrong: '\u9519\u8bef\u5c0f\u653b',
            malou: '\u9a6c\u55bd'
        };
        const rows = [];
        const addKind = (kindCode, kind, weight, list) => {
            const w = Number(weight);
            if (!Number.isFinite(w) || w <= 0) return;
            if (Array.isArray(list) && !list.length) return;
            rows.push({ kindCode, kind, weight: w, list });
        };
        addKind('correct', kindLabels.correct, step && step.relationCorrectWeight != null ? step.relationCorrectWeight : 1, correctChars);
        addKind('wrong', kindLabels.wrong, step && step.relationWrongWeight != null ? step.relationWrongWeight : 1, wrongChars);
        if (malouAvailable) addKind('malou', kindLabels.malou, step && step.relationMalouWeight != null ? step.relationMalouWeight : 1, [malouChar || { id: '', name: kindLabels.malou }]);
        const total = rows.reduce((sum, r) => sum + r.weight, 0);
        if (!rows.length || total <= 0) return null;
        const r = (typeof GameState !== 'undefined' && GameState.random ? GameState.random() : Math.random()) * total;
        let x = r;
        let row = rows[rows.length - 1];
        for (const item of rows) {
            x -= item.weight;
            if (x <= 0) {
                row = item;
                break;
            }
        }
        const ch = this.pickOneFromList(row.list);
        if (!ch) return null;
        const finalKindCode = ch && ch.id && correctIds.has(ch.id) ? 'correct' : row.kindCode;
        const finalKind = kindLabels[finalKindCode] || row.kind;
        return {
            kindCode: finalKindCode,
            kind: finalKind,
            id: ch.id || '',
            name: ch.name || ch.id || kindLabels.malou,
            sourceRaw: rawSource,
            sourceId: sourceChar && sourceChar.id ? sourceChar.id : '',
            sourceName: sourceChar && sourceChar.name ? sourceChar.name : rawSource
        };
    },

    resolveCharacterPool(step) {
        const roster = this.storyData && Array.isArray(this.storyData.characterRoster) ? this.storyData.characterRoster : [];
        const source = step && step.charPoolSource === 'type' ? 'type' : 'all';
        const typeIds = Array.isArray(step && step.charPoolTypeIds)
            ? step.charPoolTypeIds.map(x => String(x || '').trim()).filter(Boolean)
            : String((step && step.charPoolTypeId) || '').trim()
              ? [String(step.charPoolTypeId).trim()]
              : [];
        return roster.filter(c => {
            if (!c || !c.id) return false;
            if (source === 'type' && typeIds.length) return typeIds.includes(String(c.characterTypeId || '').trim());
            return true;
        });
    },

    evalCharacterPoolCondition(cond, candidate) {
        if (!cond) return true;
        if (typeof cond === 'boolean') return cond;
        if (Array.isArray(cond.and)) return cond.and.every(c => this.evalCharacterPoolCondition(c, candidate));
        if (Array.isArray(cond.or)) return cond.or.some(c => this.evalCharacterPoolCondition(c, candidate));
        const cid = candidate && candidate.id ? candidate.id : '';
        const roleId = raw => {
            const v = String(raw || '').trim();
            return this.resolveCharacterRef(v, cid);
        };
        if (cond.type === 'unified') {
            const charId = roleId(cond.charId);
            if (!charId || !cond.key || cond.op === '' || cond.op == null) return false;
            const cur = typeof GameState !== 'undefined' && GameState.getUnified ? GameState.getUnified(charId, cond.key) : undefined;
            if (this._isUnifiedBoolConditionKey(cond.key)) return this._boolConditionValue(cur) === this._boolConditionValue(cond.value);
            return this._cmp(cur, cond.op, cond.value);
        }
        if (cond.type === 'relation') {
            const from = roleId(cond.from);
            const to = roleId(cond.to);
            if (!from || !to || cond.op === '' || cond.op == null) return false;
            const cur = typeof GameState !== 'undefined' && GameState.getRelationAffection ? GameState.getRelationAffection(from, to) : undefined;
            return this._cmp(cur, cond.op, cond.value);
        }
        if (cond.type === 'loveGroup') {
            if (cond.mode === 'activeCount') {
                if (typeof LoveGroupManager === 'undefined') return false;
                return this._cmp(LoveGroupManager.activeGroupCount(), cond.op || '>=', cond.value);
            }
            if (cond.mode === 'pairLovers' || cond.mode === 'pairSameGroup') {
                if (typeof LoveGroupManager === 'undefined') return false;
                const a = roleId(cond.charA);
                const b = roleId(cond.charB);
                const hit =
                    cond.mode === 'pairSameGroup'
                        ? LoveGroupManager.sameGroup(a, b)
                        : LoveGroupManager.areLovers(a, b);
                return cond.expect === false || cond.expect === 0 || cond.expect === '0' ? !hit : hit;
            }
            const charId = roleId(cond.charId);
            if (!charId || typeof LoveGroupManager === 'undefined') return false;
            const inGroup = LoveGroupManager.isInGroup(charId);
            if (cond.state === 'out') return !inGroup;
            const role = cond.role === 'uke' || cond.role === 'seme' ? cond.role : 'any';
            return LoveGroupManager.hasRole(charId, role);
        }
        return this.evalCondition(cond);
    },

    pickCharacterPool(step) {
        const pool = this.resolveCharacterPool(step).filter(c => {
            const conditions = Array.isArray(step && step.charPoolConditions) ? step.charPoolConditions : [];
            return conditions.every(cond => this.evalCharacterPoolCondition(cond, c));
        });
        const count = Math.max(1, Math.floor(Number((step && step.charPoolCount) || 1)));
        const order = step && step.charPoolOrder === 'list' ? 'list' : 'random';
        if (order === 'list') return pool.slice(0, count);
        const arr = pool.slice();
        for (let i = arr.length - 1; i > 0; i--) {
            const r = typeof GameState !== 'undefined' && GameState.random ? GameState.random() : Math.random();
            const j = Math.floor(r * (i + 1));
            const tmp = arr[i];
            arr[i] = arr[j];
            arr[j] = tmp;
        }
        return arr.slice(0, count);
    },

    pickLovePairPool(step) {
        const all =
            typeof LoveGroupManager !== 'undefined' && LoveGroupManager.listPairCandidates
                ? LoveGroupManager.listPairCandidates(this.storyData)
                : [];
        const count = Math.max(1, Math.floor(Number((step && step.charPoolCount) || 1)));
        const order = step && step.charPoolOrder === 'list' ? 'list' : 'random';
        if (order === 'list') return all.slice(0, count);
        const arr = all.slice();
        for (let i = arr.length - 1; i > 0; i--) {
            const r = typeof GameState !== 'undefined' && GameState.random ? GameState.random() : Math.random();
            const j = Math.floor(r * (i + 1));
            const tmp = arr[i];
            arr[i] = arr[j];
            arr[j] = tmp;
        }
        return arr.slice(0, count);
    },

    _applyReuseFixedExits(bindings) {
        if (!bindings || !Array.isArray(bindings)) return;
        bindings.forEach(b => {
            if (!b || b.sourceKind !== 'fixed') return;
            const k = String(b.varName || '').trim();
            if (!k || typeof GameState === 'undefined' || !GameState.set) return;
            GameState.set(k, b.fixedValue != null ? b.fixedValue : '');
        });
    },

    /** 模块子场景播完弹栈时：把「弹栈写回」清单写入记忆槽（变量） */
    _applyReusePopBindings(bindings, entryKeyUsed) {
        if (!bindings || !Array.isArray(bindings) || typeof GameState === 'undefined' || !GameState.set) return;
        bindings.forEach(b => {
            if (!b || typeof b !== 'object') return;
            const k = String(b.varName || '').trim();
            if (!k) return;
            const wk = b.writeKind || 'literal';
            if (wk === 'usedEntryKey') {
                GameState.set(k, entryKeyUsed != null ? String(entryKeyUsed) : '');
            } else if (wk === 'boolTrue') {
                GameState.set(k, 1);
            } else if (wk === 'boolFalse') {
                GameState.set(k, 0);
            } else {
                GameState.set(k, b.literalValue != null ? String(b.literalValue) : '');
            }
        });
    },

    _resolveReuseExitWriteValue(b, ctx) {
        const kind = ctx && ctx.kind;
        let mode = b && b.valueMode != null ? String(b.valueMode).trim() : '';
        if (!mode) {
            if (kind === 'choice') mode = 'optionCharacterId';
            else if (kind === 'random') mode = 'rowName';
        }
        if (mode === 'literal') return b.literalValue != null ? b.literalValue : '';
        if (kind === 'choice') {
            const opt = (ctx && ctx.opt) || {};
            if (mode === 'optionCharacterId') return opt.characterId != null ? String(opt.characterId) : '';
            if (mode === 'optionText') return opt.text != null ? String(opt.text) : '';
            return opt.characterId != null ? String(opt.characterId) : '';
        }
        if (kind === 'random') {
            const row = (ctx && ctx.row) || {};
            if (mode === 'rowName') return row.name != null ? String(row.name) : '';
            if (mode === 'rowCharacterId') return row.characterId != null ? String(row.characterId) : '';
            return row.name != null ? String(row.name) : '';
        }
        return '';
    },

    applyReuseExitOnChoice(sceneId, step, optionIndexOriginal, opt) {
        const st = this._storyModuleStack;
        if (!st || !st.length || !step || typeof GameState === 'undefined' || !GameState.set) return;
        const top = st[st.length - 1];
        if (!top || !Array.isArray(top.reuseExitBindings) || !top.reuseExitBindings.length) return;
        if (top.moduleSceneId !== sceneId) return;
        const sid = step.id != null ? String(step.id) : '';
        top.reuseExitBindings.forEach(b => {
            if (!b || b.sourceKind !== 'choice') return;
            if (String(b.sourceStepId || '') !== sid) return;
            if (Number(b.optionIndex) !== Number(optionIndexOriginal)) return;
            if (b.branchSceneId && String(b.branchSceneId) !== String(sceneId)) return;
            const key = String(b.varName || '').trim();
            if (!key) return;
            const val = this._resolveReuseExitWriteValue(b, { kind: 'choice', opt });
            GameState.set(key, val);
        });
    },

    applyReuseExitOnRandom(sceneId, stepId, picked) {
        const st = this._storyModuleStack;
        if (!st || !st.length || !picked || typeof GameState === 'undefined' || !GameState.set) return;
        const top = st[st.length - 1];
        if (!top || !Array.isArray(top.reuseExitBindings) || !top.reuseExitBindings.length) return;
        if (top.moduleSceneId !== sceneId) return;
        const sid = stepId != null ? String(stepId) : '';
        const ri = picked._ri;
        if (!Number.isFinite(ri)) return;
        top.reuseExitBindings.forEach(b => {
            if (!b || b.sourceKind !== 'random') return;
            if (String(b.sourceStepId || '') !== sid) return;
            if (Number(b.randomRowIndex) !== Number(ri)) return;
            if (b.branchSceneId && String(b.branchSceneId) !== String(sceneId)) return;
            const key = String(b.varName || '').trim();
            if (!key) return;
            const val = this._resolveReuseExitWriteValue(b, { kind: 'random', row: picked });
            GameState.set(key, val);
        });
    },

    recordReuseEntryOutcome(stepId, value) {
        if (!stepId) return;
        if (!this._reuseEntryOutcomeByStepId) this._reuseEntryOutcomeByStepId = Object.create(null);
        const v = value != null ? String(value).trim() : '';
        this._reuseEntryOutcomeByStepId[String(stepId)] = v;
    },

    getReuseEntryOutcome(stepId) {
        if (!stepId || !this._reuseEntryOutcomeByStepId) return '';
        return String(this._reuseEntryOutcomeByStepId[String(stepId)] || '').trim();
    },

    resolveChoiceOptionReuseEntryKey(opt, optionIndex, step) {
        if (!opt || typeof opt !== 'object') return String(optionIndex);
        const mode =
            step && ['characterId', 'optionIndex', 'optionText'].includes(step.choiceReuseEntryAs)
                ? step.choiceReuseEntryAs
                : 'characterId';
        if (mode === 'optionIndex') return String(optionIndex);
        if (mode === 'optionText') {
            const tx = opt.text != null ? String(opt.text).trim() : '';
            return tx || String(optionIndex);
        }
        const cid = opt.characterId != null ? String(opt.characterId).trim() : '';
        if (cid) return cid;
        return String(optionIndex);
    },

    resolveRandomRowReuseEntryKey(row, rowIndex, step) {
        if (!row || typeof row !== 'object') return String(rowIndex);
        const mode =
            step && ['name', 'characterId', 'rowIndex'].includes(step.randomReuseEntryAs)
                ? step.randomReuseEntryAs
                : 'name';
        if (mode === 'rowIndex') return String(rowIndex);
        if (mode === 'characterId') {
            const cid = row.characterId != null ? String(row.characterId).trim() : '';
            return cid || String(rowIndex);
        }
        const nm = row.name != null ? String(row.name).trim() : '';
        if (nm) return nm;
        const cid = row.characterId != null ? String(row.characterId).trim() : '';
        if (cid) return cid;
        return String(rowIndex);
    },

    _pickQuizQuestion(step) {
        if (!step || !step.quizGameId || typeof QuizGameConfig === 'undefined') return null;
        const game = QuizGameConfig.findGame(this.storyData, step.quizGameId);
        if (!game || !Array.isArray(game.questions) || !game.questions.length) return null;
        const all = game.questions.filter(Boolean);
        const seenKey = qid => `quiz_seen_${game.id}_${qid}`;
        const unseen = all.filter(q => {
            if (!q || !q.id) return false;
            if (typeof GameState === 'undefined' || !GameState.get) return true;
            return Number(GameState.get(seenKey(q.id)) || 0) !== 1;
        });
        const pickPool = step.quizPickMode === 'randomAll' ? all : unseen.length ? unseen : [];
        if (!pickPool.length) return { game, question: null };
        const r = typeof GameState !== 'undefined' && GameState.random ? GameState.random() : Math.random();
        const ix = Math.max(0, Math.min(pickPool.length - 1, Math.floor(r * pickPool.length)));
        return { game, question: pickPool[ix] };
    },

    _buildQuizOptions(question) {
        if (!question) return [];
        const keyOf = i => (i >= 0 && i < 26 ? String.fromCharCode(65 + i) : `opt_${i + 1}`);
        const rows = [];
        const pushIf = (key, text) => {
            const t = String(text || '').trim();
            if (!t) return;
            rows.push({ key, text: `${key}. ${t}` });
        };
        if (Array.isArray(question.options) && question.options.length) {
            question.options.forEach((opt, i) => {
                const key = String(opt && (opt.key || opt.id || '')).trim() || keyOf(i);
                pushIf(key, opt && (opt.text != null ? opt.text : opt.label));
            });
        } else {
            pushIf('A', question.optionA);
            pushIf('B', question.optionB);
            pushIf('C', question.optionC);
            pushIf('D', question.optionD);
        }
        return rows;
    },

    _quizDeltaText(delta) {
        const n = Number(delta) || 0;
        if (n > 0) return `加${Math.abs(n)}分`;
        if (n < 0) return `扣${Math.abs(n)}分`;
        return '分数不变';
    },

    _applyQuizScoreDelta(game, delta) {
        const d = Number(delta) || 0;
        const targetCharId = String((game && game.scoreTargetCharId) || '').trim();
        const targetKey = String((game && game.scoreTargetKey) || '').trim();
        if (targetCharId && targetKey && typeof GameState !== 'undefined') {
            if (GameState.applyEffects) {
                GameState.applyEffects([{ kind: 'unified', charId: targetCharId, key: targetKey, op: 'add', val: d }]);
            } else if (GameState.setUnified && GameState.getUnified) {
                const resolved =
                    GameState.resolveCharacterRef && typeof GameState.resolveCharacterRef === 'function'
                        ? GameState.resolveCharacterRef(targetCharId)
                        : targetCharId;
                const cur = Number(GameState.getUnified(resolved, targetKey)) || 0;
                GameState.setUnified(resolved, targetKey, cur + d);
            }
            const resolved =
                GameState.resolveCharacterRef && typeof GameState.resolveCharacterRef === 'function'
                    ? GameState.resolveCharacterRef(targetCharId)
                    : targetCharId;
            const next = GameState.getUnified ? Number(GameState.getUnified(resolved, targetKey)) || 0 : 0;
            return { scoreAfter: next, targetCharId: resolved, targetKey };
        }
        if (typeof GameState !== 'undefined' && GameState.set) {
            const scoreKey = (game && game.scoreVarName) || 'quiz_score';
            const cur = Number((GameState.get && GameState.get(scoreKey)) || 0);
            const nextScore = cur + d;
            GameState.set(scoreKey, nextScore);
            return { scoreAfter: nextScore, scoreKey };
        }
        return { scoreAfter: d };
    },

    _formatQuizFeedback(game, isCorrect, delta, scoreAfter, effective) {
        const fb = game && game.feedbackTemplates && typeof game.feedbackTemplates === 'object' ? game.feedbackTemplates : {};
        const pool = Array.isArray(isCorrect ? fb.correct : fb.wrong) ? (isCorrect ? fb.correct : fb.wrong) : [];
        const fallback = isCorrect ? '回答正确，给你加X分。' : '错啦错啦，扣掉X分，不好意思啦。';
        const picked =
            pool.length > 0
                ? pool[Math.floor((typeof GameState !== 'undefined' && GameState.random ? GameState.random() : Math.random()) * pool.length)]
                : isCorrect
                  ? effective.hintCorrect || fallback
                  : effective.hintWrong || fallback;
        const abs = Math.abs(Number(delta) || 0);
        const txt = this._quizDeltaText(delta);
        const rendered = String(picked || fallback)
            .replace(/\{deltaText\}/g, txt)
            .replace(/\{deltaAbs\}/g, String(abs))
            .replace(/\{delta\}/g, String(Number(delta) || 0))
            .replace(/\{score\}/g, String(Number(scoreAfter) || 0))
            .replace(/X/g, String(abs));
        if (!/\{score\}/.test(String(picked || '')) && !/总分|当前分/.test(rendered)) {
            return `${rendered}（当前总分：${Number(scoreAfter) || 0}）`;
        }
        return rendered;
    },

    maybeTriggerAutoJump(reason = '') {
        if (this._autoJumpBusy) return false;
        const project = this.storyData;
        const rules = project && Array.isArray(project.autoJumpRules) ? project.autoJumpRules : [];
        if (!rules.length) return false;
        const jumped = this._autoJumpedRules || (this._autoJumpedRules = {});
        const scene = this.getScene(this.currentSceneId);
        const step = scene && scene.steps ? scene.steps[this.currentStepIndex] : null;
        const curLabel = step && step.labelSuffix != null ? String(step.labelSuffix).trim() : '';
        for (let i = 0; i < rules.length; i++) {
            const r = rules[i];
            if (!r || typeof r !== 'object' || !r.id) continue;
            const firedKey = `aj:${r.id}`;
            if (jumped[firedKey]) continue;
            if (!r.enabled || !r.published) continue;
            const targetScene = String(r.sceneId || '').trim();
            const rawTargetLabel = r.labelSuffix != null ? String(r.labelSuffix).trim() : '';
            if (!targetScene) continue;
            if (!this.evalCondition(r.condition)) continue;
            const targetSc = this.getScene(targetScene);
            const targetLabel =
                rawTargetLabel &&
                targetSc &&
                Array.isArray(targetSc.steps) &&
                targetSc.steps.some(st => st && String(st.labelSuffix || '').trim() === rawTargetLabel)
                    ? rawTargetLabel
                    : '';
            if (targetScene === this.currentSceneId && targetLabel === curLabel) continue;
            this._autoJumpBusy = true;
            try {
                if (typeof UIManager !== 'undefined' && UIManager.hideOptions) UIManager.hideOptions();
                if (typeof StoryEffects !== 'undefined' && StoryEffects.stopLoopingStepSound) {
                    StoryEffects.stopLoopingStepSound();
                }
                if (typeof console !== 'undefined' && console.log) {
                    console.log('[AutoJump] trigger', {
                        ruleId: r.id,
                        reason,
                        currentSceneId: this.currentSceneId,
                        targetScene,
                        targetLabel,
                        returnInPlace: r.returnInPlace === true
                    });
                }
                if (r.returnInPlace === true) {
                    this._pushReturnFrame();
                }
                jumped[firedKey] = true;
                this.jumpToScene(targetScene, targetLabel);
                return true;
            } finally {
                this._autoJumpBusy = false;
            }
        }
        return false;
    },

    maybeTriggerAutoAnnouncement(reason = '') {
        if (this._autoAnnounceBusy) return false;
        const project = this.storyData;
        const scenes = (project && project.scenes) || [];
        const fired = this._autoAnnouncedScenes || (this._autoAnnouncedScenes = {});
        const rules = project && Array.isArray(project.autoAnnouncementRules) ? project.autoAnnouncementRules : [];
        const tryFire = (firedKey, msg, logDetail) => {
            this._autoAnnounceBusy = true;
            fired[firedKey] = true;
            try {
                const text = String(msg || '').trim();
                if (!text) return false;
                if (typeof UIManager !== 'undefined' && UIManager.showSystemAnnouncement) {
                    UIManager.showSystemAnnouncement(text);
                } else if (typeof alert === 'function') {
                    alert(text);
                }
                if (typeof console !== 'undefined' && console.log) {
                    console.log('[AutoAnnounce] trigger', { ...logDetail, reason, currentSceneId: this.currentSceneId });
                }
                return true;
            } finally {
                this._autoAnnounceBusy = false;
            }
        };
        for (let i = 0; i < rules.length; i++) {
            const r = rules[i];
            if (!r || typeof r !== 'object' || !r.id) continue;
            const fk = `ar:${r.id}`;
            if (fired[fk]) continue;
            if (!r.enabled || !r.published) continue;
            if (!this.evalCondition(r.condition)) continue;
            const msg =
                (typeof r.message === 'string' && r.message.trim()) ||
                (typeof r.name === 'string' && r.name.trim() ? `系统宣布：${r.name.trim()}` : '') ||
                `系统宣布：${r.id}`;
            return tryFire(fk, msg, { ruleId: r.id, source: 'project.autoAnnouncementRules' });
        }
        if (!scenes.length) return false;
        const hit = scenes.find(sc => {
            if (!sc || !sc.id) return false;
            if (fired[sc.id]) return false;
            const aa = sc.autoAnnounce && typeof sc.autoAnnounce === 'object' ? sc.autoAnnounce : null;
            if (!aa || !aa.enabled || !aa.published) return false;
            return this.evalCondition(aa.condition);
        });
        if (!hit) return false;
        const msg =
            (hit.autoAnnounce && typeof hit.autoAnnounce.message === 'string' && hit.autoAnnounce.message.trim()) ||
            (hit.steps || []).map(st => (st && typeof st.text === 'string' ? st.text.trim() : '')).find(Boolean) ||
            (typeof hit.text === 'string' ? hit.text.trim() : '') ||
            `系统宣布：${hit.name || hit.id}`;
        return tryFire(hit.id, msg, { ruleSceneId: hit.id, source: 'scene.autoAnnounce' });
    },

    getQuizModuleRemainingCount(moduleId) {
        const game =
            typeof QuizGameConfig !== 'undefined' && QuizGameConfig.findGame
                ? QuizGameConfig.findGame(this.storyData, moduleId)
                : null;
        const fallback =
            !game && this.storyData && Array.isArray(this.storyData.quizGames)
                ? this.storyData.quizGames.find(g => g && g.id === moduleId)
                : null;
        const g = game || fallback;
        const questions = g && Array.isArray(g.questions) ? g.questions.filter(q => q && q.id) : [];
        if (!questions.length) return 0;
        return questions.filter(q => {
            if (typeof GameState === 'undefined' || !GameState.get) return true;
            return Number(GameState.get(`quiz_seen_${g.id}_${q.id}`) || 0) !== 1;
        }).length;
    },

    getRandomDisplayModuleRemainingCount(moduleId) {
        const module =
            typeof RandomDisplayConfig !== 'undefined' && RandomDisplayConfig.findModule
                ? RandomDisplayConfig.findModule(this.storyData, moduleId)
                : null;
        const fallback =
            !module && this.storyData && Array.isArray(this.storyData.randomDisplayModules)
                ? this.storyData.randomDisplayModules.find(m => m && m.id === moduleId)
                : null;
        const m = module || fallback;
        const items = m && Array.isArray(m.items) ? m.items.filter(it => it && it.id) : [];
        if (!items.length) return 0;
        const seenKey =
            typeof RandomDisplayConfig !== 'undefined' && RandomDisplayConfig.seenVarKey
                ? itemId => RandomDisplayConfig.seenVarKey(m.id, itemId)
                : itemId => `rd_seen_${String(m.id || '').replace(/[^\w]/g, '_')}_${String(itemId || '').replace(/[^\w]/g, '_')}`;
        return items.filter(it => {
            if (typeof GameState === 'undefined' || !GameState.get) return true;
            return Number(GameState.get(seenKey(it.id)) || 0) !== 1;
        }).length;
    },

    evalModuleStockCondition(cond) {
        const moduleId = String((cond && cond.moduleId) || '').trim();
        if (!moduleId) return false;
        const remaining =
            cond.moduleKind === 'randomDisplay'
                ? this.getRandomDisplayModuleRemainingCount(moduleId)
                : this.getQuizModuleRemainingCount(moduleId);
        const exhausted = remaining <= 0;
        return cond.state === 'exhausted' ? exhausted : !exhausted;
    },

    evalCondition(cond) {
        if (!cond) return true;
        if (typeof cond === 'boolean') return cond;
        if (Array.isArray(cond.and)) {
            if (!cond.and.length) return false;
            return cond.and.every(c => this.evalCondition(c));
        }
        if (Array.isArray(cond.or)) return cond.or.some(c => this.evalCondition(c));
        if (cond.type === 'var') {
            if (!cond.key || cond.op === '' || cond.op == null) return false;
            const cur = typeof GameState !== 'undefined' && GameState.get ? GameState.get(cond.key) : undefined;
            return this._cmp(cur, cond.op, cond.value);
        }
        if (cond.type === 'unified') {
            const charId = this.resolveCharacterRef(cond.charId);
            if (!charId || !cond.key) return false;
            if (cond.op === '' || cond.op == null) return false;
            const cur = typeof GameState !== 'undefined' && GameState.getUnified ? GameState.getUnified(charId, cond.key) : undefined;
            if (this._isUnifiedBoolConditionKey(cond.key)) return this._boolConditionValue(cur) === this._boolConditionValue(cond.value);
            return this._cmp(cur, cond.op, cond.value);
        }
        if (cond.type === 'loveGroup') {
            if (cond.mode === 'activeCount') {
                if (typeof LoveGroupManager === 'undefined') return false;
                return this._cmp(LoveGroupManager.activeGroupCount(), cond.op || '>=', cond.value);
            }
            if (cond.mode === 'pairLovers' || cond.mode === 'pairSameGroup') {
                if (typeof LoveGroupManager === 'undefined') return false;
                const a = this.resolveCharacterRef(cond.charA);
                const b = this.resolveCharacterRef(cond.charB);
                const hit =
                    cond.mode === 'pairSameGroup'
                        ? LoveGroupManager.sameGroup(a, b)
                        : LoveGroupManager.areLovers(a, b);
                return cond.expect === false || cond.expect === 0 || cond.expect === '0' ? !hit : hit;
            }
            const charId = this.resolveCharacterRef(cond.charId);
            if (!charId || typeof LoveGroupManager === 'undefined') return false;
            const inGroup = LoveGroupManager.isInGroup(charId);
            if (cond.state === 'out') return !inGroup;
            const role = cond.role === 'uke' || cond.role === 'seme' ? cond.role : 'any';
            return LoveGroupManager.hasRole(charId, role);
        }
        if (cond.type === 'characterType') {
            const charId = this.resolveCharacterRef(cond.charId);
            if (!charId || !cond.typeId) return false;
            const ch = this.findCharacterByNameOrId(charId);
            if (!ch || !ch.id) return false;
            const cur = String(ch.characterTypeId || '').trim();
            const want = String(cond.typeId || '').trim();
            return cond.op === '!=' ? cur !== want : cur === want;
        }
        if (cond.type === 'relation') {
            const from = this.resolveCharacterRef(cond.from);
            const to = this.resolveCharacterRef(cond.to);
            if (!from || !to) return false;
            if (cond.op === '' || cond.op == null) return false;
            const cur = typeof GameState !== 'undefined' && GameState.getRelationAffection ? GameState.getRelationAffection(from, to) : undefined;
            return this._cmp(cur, cond.op, cond.value);
        }
        if (cond.type === 'relationCompare') {
            const from = this.resolveCharacterRef(cond.from);
            const toA = this.resolveCharacterRef(cond.toA);
            const toB = this.resolveCharacterRef(cond.toB);
            if (!from || !toA || !toB) return false;
            if (cond.op === '' || cond.op == null) return false;
            const ga =
                typeof GameState !== 'undefined' && GameState.getRelationAffection
                    ? GameState.getRelationAffection(from, toA)
                    : undefined;
            const gb =
                typeof GameState !== 'undefined' && GameState.getRelationAffection
                    ? GameState.getRelationAffection(from, toB)
                    : undefined;
            return this._cmp(ga, cond.op, gb);
        }
        if (cond.type === 'relationExtreme') {
            const fromId = this.resolveCharacterRef(cond.from);
            const winnerWant = this.resolveCharacterRef(cond.winner);
            if (!fromId || !winnerWant || (cond.mode !== 'min' && cond.mode !== 'max')) return false;
            const rel =
                typeof GameState !== 'undefined' &&
                GameState.characters &&
                GameState.characters[fromId] &&
                GameState.characters[fromId].relations
                    ? GameState.characters[fromId].relations
                    : null;
            if (!rel || typeof rel !== 'object') return false;
            const getAff =
                typeof GameState !== 'undefined' && GameState.getRelationAffection
                    ? (f, t) => GameState.getRelationAffection(f, t)
                    : () => 0;
            const entries = Object.keys(rel).map(toId => ({
                toId,
                v: Number(getAff(fromId, toId))
            }));
            if (!entries.length) return false;
            const vals = entries.map(e => e.v);
            const bound = cond.mode === 'min' ? Math.min(...vals) : Math.max(...vals);
            const winners = entries.filter(e => e.v === bound).map(e => e.toId);
            return winners.indexOf(winnerWant) >= 0;
        }
        if (cond.type === 'moduleStock') {
            return this.evalModuleStockCondition(cond);
        }
        if (cond.type === 'appearance') {
            const want = Number(cond.value) ? 1 : 0;
            const tt = cond.targetType;
            if (tt !== 'scene' && tt !== 'step' && tt !== 'stepFragment') return false;
            if (tt === 'scene') {
                const resolveId = cond.sceneId || cond.targetId || '';
                if (!resolveId) return false;
                let cur = 0;
                if (typeof GameState !== 'undefined') {
                    cur = Number(GameState.sceneAppearances && GameState.sceneAppearances[resolveId]) ? 1 : 0;
                    if (!cur && GameState.get) cur = Number(GameState.get(`scene_seen_${resolveId}`)) ? 1 : 0;
                }
                return cur === want;
            }
            if (tt === 'stepFragment') {
                const fid = cond.fragmentId || cond.targetId || '';
                if (!fid) return false;
                let cur = 0;
                if (typeof GameState !== 'undefined') {
                    cur = Number(GameState.fragmentAppearances && GameState.fragmentAppearances[fid]) ? 1 : 0;
                    if (!cur && GameState.get) cur = Number(GameState.get(`fragment_seen_${fid}`)) ? 1 : 0;
                }
                return cur === want;
            }
            let resolveId = '';
            if (cond.sceneId != null && cond.sceneId !== '') {
                const suf = cond.labelSuffix != null ? String(cond.labelSuffix) : '';
                resolveId = this.resolveStepIdFromSceneLabel(cond.sceneId, suf);
            }
            if (!resolveId) resolveId = cond.targetId || '';
            if (!resolveId) return false;
            let cur = 0;
            if (typeof GameState !== 'undefined') {
                cur = Number(GameState.stepAppearances && GameState.stepAppearances[resolveId]) ? 1 : 0;
                if (!cur && GameState.get) cur = Number(GameState.get(`step_seen_${resolveId}`)) ? 1 : 0;
            }
            return cur === want;
        }
        return true;
    },

    /**
     * 选项/随机「出现」语义：若 next 指向的场景（整场景）、带标签步骤、或片段已在游玩中出现过，返回 true。
     * return 类 next 不参与判定。
     */
    isJumpTargetAlreadyAppeared(next) {
        if (!next || typeof next !== 'object') return false;
        const t = next.type;
        if (t === 'loadSave') return false;
        if (t === 'return') return false;
        if (t === 'fragment') {
            const fid = next.fragmentId || '';
            if (!fid) return false;
            let cur = 0;
            if (typeof GameState !== 'undefined') {
                cur = Number(GameState.fragmentAppearances && GameState.fragmentAppearances[fid]) ? 1 : 0;
                if (!cur && GameState.get) cur = Number(GameState.get(`fragment_seen_${fid}`)) ? 1 : 0;
            }
            return cur === 1;
        }
        if (t === 'scene' || t === 'ending' || t === 'label' || !t) {
            let sid = next.sceneId || '';
            if (!sid && t === 'label' && this.currentSceneId) sid = this.currentSceneId;
            if (!sid) return false;
            const lab = next.labelSuffix != null ? String(next.labelSuffix).trim() : '';
            if (!lab) {
                let cur = 0;
                if (typeof GameState !== 'undefined') {
                    cur = Number(GameState.sceneAppearances && GameState.sceneAppearances[sid]) ? 1 : 0;
                    if (!cur && GameState.get) cur = Number(GameState.get(`scene_seen_${sid}`)) ? 1 : 0;
                }
                return cur === 1;
            }
            const stepId = this.resolveStepIdFromSceneLabel(sid, lab);
            if (!stepId) return false;
            let cur = 0;
            if (typeof GameState !== 'undefined') {
                cur = Number(GameState.stepAppearances && GameState.stepAppearances[stepId]) ? 1 : 0;
                if (!cur && GameState.get) cur = Number(GameState.get(`step_seen_${stepId}`)) ? 1 : 0;
            }
            return cur === 1;
        }
        return false;
    },

    /** 按人物预设「姓名」或 id 精确匹配 displayLabel；未匹配到人物时不筛除 */
    _findCharacterByOptionLabel(displayLabel) {
        const t = String(displayLabel || '').trim();
        if (!t || !this.storyData || !Array.isArray(this.storyData.characterRoster)) return null;
        return this.storyData.characterRoster.find(c => c && (c.name === t || c.id === t)) || null;
    },

    /** 统一属性「存在」为真时通过；未匹配到预设人物时通过（避免误伤纯文案选项） */
    optionLabelPassesSpeakerExist(displayLabel) {
        const ch = this._findCharacterByOptionLabel(displayLabel);
        if (!ch || !ch.id) return true;
        return this._unifiedExistPassForCharId(ch.id);
    },

    _unifiedExistPassForCharId(charId) {
        if (!charId || typeof GameState === 'undefined' || !GameState.getUnified) return true;
        const v = GameState.getUnified(charId, '存在');
        if (v === false || v === 0 || v === '0') return false;
        return true;
    },

    /** 选项：若绑定了 characterId 则按 id 判「存在」，否则按选项文案匹配预设姓名/id */
    choiceOptionPassesSpeakerExist(opt) {
        if (!opt) return true;
        const id = opt.characterId != null ? String(opt.characterId).trim() : '';
        if (id) {
            if (!this.storyData || !Array.isArray(this.storyData.characterRoster)) return true;
            if (!this.storyData.characterRoster.some(c => c && c.id === id)) return true;
            return this._unifiedExistPassForCharId(id);
        }
        return this.optionLabelPassesSpeakerExist(opt.text);
    },

    /** 随机行：若绑定了 characterId 则按 id 判「存在」，否则按名称文案匹配 */
    randomRowPassesSpeakerExist(r) {
        if (!r) return true;
        const id = r.characterId != null ? String(r.characterId).trim() : '';
        if (id) {
            if (!this.storyData || !Array.isArray(this.storyData.characterRoster)) return true;
            if (!this.storyData.characterRoster.some(c => c && c.id === id)) return true;
            return this._unifiedExistPassForCharId(id);
        }
        return this.optionLabelPassesSpeakerExist(r.name);
    },

    _isUnifiedBoolConditionKey(key) {
        if (key === '存在') return true;
        const defs = this.storyData && Array.isArray(this.storyData.unifiedAttributes) ? this.storyData.unifiedAttributes : [];
        const row = defs.find(d => d && d.key === key);
        return !!(row && row.type === 'bool');
    },

    _boolConditionValue(v) {
        if (v === true || v === 1 || v === '1' || v === '是' || v === 'true') return 1;
        return 0;
    },

    _cmp(cur, op, value) {
        const a = typeof cur === 'boolean' ? cur : Number(cur);
        const b = typeof value === 'boolean' ? value : Number(value);
        if (op === '==') return a == b;
        if (op === '!=') return a != b;
        if (op === '>=') return a >= b;
        if (op === '<=') return a <= b;
        if (op === '>') return a > b;
        if (op === '<') return a < b;
        return !!a;
    },

    /**
     * 从当前 CG 步点「下一条」时：若同场景/片段内还有下一步，则 CG 画面往往仍延续（未设停步或停步在更后），
     * 此时不应在 CG 步结束时做淡出——淡出应在真正关 layer-story 时（命中 cgStopAtStepId 或清会话）再做。
     * 仅当没有「同场下一步」（片段末跳出、线性走出场景等）时，才在离开本 CG 步时保留原有淡出。
     */
    _skipCgFadeWhenLeavingCurrentCgStep(scene, cgStep) {
        if (!scene || !Array.isArray(scene.steps) || !cgStep || cgStep.type !== 'cg') return false;
        const steps = scene.steps;
        if (this._fragmentSession) {
            const ord = this._fragmentSession.orderedIndices || [];
            const pos = ord.indexOf(this.currentStepIndex);
            if (pos >= 0 && pos < ord.length - 1) return true;
            return false;
        }
        const ni = this.currentStepIndex + 1;
        return ni < steps.length;
    },

    /** 非循环且为视频媒体（非静图）的 CG 步：适用「须播完再离开 / 再换场」规则 */
    _cgStepUsesNonLoopVideo(cgStep) {
        if (!cgStep || cgStep.type !== 'cg' || cgStep.cgLoop !== false) return false;
        const sg = cgStep.cg || {};
        const url = String(sg.url || '');
        if (String(sg.mediaType || '').toLowerCase() === 'video') return true;
        if (url.startsWith('data:video')) return true;
        return /\.(mp4|webm|ogg)(\?|#|$)/i.test(url);
    },

    /**
     * CG 为视频且未勾选循环：须等视频自然播完（ended）后，才允许点击离开本步 / 跨场景清层。
     * 依赖 layer-story 内当前 video 元素（与 UIManager._showCg 一致）。
     * 视频尚未插入 DOM（加载中）时一律拦截，避免淡入期狂点后瞬间跳过。
     */
    _cgVideoPlaythroughBlocksAdvance(cgStep) {
        if (!this._cgStepUsesNonLoopVideo(cgStep)) return false;
        const story = typeof document !== 'undefined' ? document.getElementById('layer-story') : null;
        const v = story && story.querySelector('video');
        if (!v) return true;
        if (v.error) return false;
        if (v.ended) return false;
        const d = Number(v.duration);
        if (!Number.isFinite(d) || d <= 0) return true;
        const ct = Number(v.currentTime);
        if (!Number.isFinite(ct)) return true;
        return ct < d - 0.06;
    },

    /**
     * 从当前 CG 步点「下一条」后 layer-story 是否仍按会话延续（同场有下一步 / 片段内未到末步）。
     * 用于步骤特效：三阶段组合在 CG 上时，此种情况下不得在 advance 离开 CG 步时播「出场」，须待 CG 会话结束（runCgEndExitSequence 等）。
     */
    isCgOverlayPersistingAfterLeavingThisCgStep(cgStep) {
        const scene = this.getScene(this.currentSceneId);
        return this._skipCgFadeWhenLeavingCurrentCgStep(scene, cgStep);
    },

    getActiveCgOverlayStep() {
        const sess = this._cgSession;
        if (!sess || !sess.visualActive || sess.visualClosing || !sess.sourceStep) return null;
        return sess.sourceStep;
    },

    /** 点击推进（对话翻页 / CG关闭 / 进入下一步） */
    onAdvance() {
        const step = this.getCurrentStep();
        if (!step) return;
        if (typeof performance !== 'undefined' && performance.now() < this._afterCgInputBlockUntilMs) return;

        if (this.uiMode.mode === 'choice') {
            // 等玩家点选项按钮
            return;
        }

        if (this.uiMode.mode === 'gallery') {
            return;
        }

        if (this.uiMode.mode === 'hidden_map') {
            return;
        }

        if (this.uiMode.mode === 'graphic_reading') {
            if (typeof UIManager !== 'undefined' && UIManager.consumeTypewriterSkipIfBusy) {
                if (UIManager.consumeTypewriterSkipIfBusy()) return;
            }
            if (typeof UIManager !== 'undefined' && UIManager.nextPage && UIManager.isAtEndOfStep) {
                if (!UIManager.isAtEndOfStep()) {
                    UIManager.nextPage();
                    return;
                }
            }
            this._advanceGraphicReadingSession();
            return;
        }

        if (this.uiMode.mode === 'gallery_rd_preview_done') {
            this._endGalleryRandomDisplayPreview();
            return;
        }

        if (this.uiMode.mode === 'cg') {
            if (typeof UIManager !== 'undefined' && UIManager.consumeTypewriterSkipIfBusy) {
                if (UIManager.consumeTypewriterSkipIfBusy()) return;
            }
            if (typeof UIManager !== 'undefined' && UIManager.nextPage && UIManager.isAtEndOfStep) {
                if (!UIManager.isAtEndOfStep()) {
                    UIManager.nextPage();
                    return;
                }
            }
            if (typeof performance !== 'undefined' && performance.now() < this._cgFadeInBlockUntilMs) return;
            if (this._cgFadeBusy) return;
            if (this._cgExitInProgress) return;
            const scene = this.getScene(this.currentSceneId);
            const cgStep =
                this._randomDisplaySession && this._randomDisplaySession.synthCgStep
                    ? this._randomDisplaySession.synthCgStep
                    : step;
            const isRandomDisplayCg = !!(
                this._randomDisplaySession && this._randomDisplaySession.synthCgStep
            );
            if (this._cgVideoPlaythroughBlocksAdvance(cgStep)) return;

            this._cgExitInProgress = true;
            const skipFade = this._skipCgFadeWhenLeavingCurrentCgStep(scene, cgStep);
            if (!isRandomDisplayCg && typeof UIManager !== 'undefined' && UIManager.pauseLayerStoryMediaForCgExit) {
                UIManager.pauseLayerStoryMediaForCgExit();
            }

            const afterCgExit = () => {
                this._cgFadeBusy = false;
                if (typeof StoryEffects !== 'undefined' && StoryEffects.stopLoopingStepSound) {
                    StoryEffects.stopLoopingStepSound();
                }
                this.uiMode = { mode: 'none' };
                if (this._randomDisplaySession && this._randomDisplaySession.synthCgStep) {
                    const rd = this._randomDisplaySession;
                    const overlayCg = this.getActiveCgOverlayStep();
                    if (typeof performance !== 'undefined') {
                        this._afterCgInputBlockUntilMs = performance.now() + 600;
                    }
                    this._randomDisplayAfterCg(scene, rd.rdStep, rd.module, rd.item, overlayCg);
                } else {
                    this.advanceStep();
                }
                this._cgExitInProgress = false;
                if (typeof performance !== 'undefined') {
                    this._afterCgInputBlockUntilMs = Math.max(this._afterCgInputBlockUntilMs || 0, performance.now() + 240);
                } else {
                    this._afterCgInputBlockUntilMs = 0;
                }
            };

            const useFadeOut = !skipFade && !isRandomDisplayCg;
            if (useFadeOut && typeof UIManager !== 'undefined' && UIManager.beginCgStepExit) {
                const sess = this._cgSession;
                const started = UIManager.beginCgStepExit(cgStep, afterCgExit);
                if (started) {
                    if (sess && sess.sourceStep && String(sess.sourceStep.id) === String(cgStep.id)) {
                        sess.visualClosing = true;
                    }
                    this._cgFadeBusy = true;
                    return;
                }
            }

            const runExit = () => {
                afterCgExit();
            };
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(() => requestAnimationFrame(runExit));
            } else {
                window.setTimeout(runExit, 0);
            }
            return;
        }

        if (this.uiMode.mode === 'quiz_result') {
            if (typeof StoryEffects !== 'undefined' && StoryEffects.stopLoopingStepSound) {
                StoryEffects.stopLoopingStepSound();
            }
            this.uiMode = { mode: 'none' };
            this.advanceStep();
            return;
        }

        if (this.uiMode.mode === 'random_display' && this._randomDisplaySession && this._randomDisplaySession.exhausted) {
            if (typeof StoryEffects !== 'undefined' && StoryEffects.stopLoopingStepSound) {
                StoryEffects.stopLoopingStepSound();
            }
            this._randomDisplaySession = null;
            this.uiMode = { mode: 'none' };
            this.advanceStep();
            return;
        }

        if (this.uiMode.mode === 'random_display' && this._randomDisplaySession && !this._randomDisplaySession.exhausted) {
            if (typeof UIManager !== 'undefined' && UIManager.consumeTypewriterSkipIfBusy) {
                if (UIManager.consumeTypewriterSkipIfBusy()) return;
            }
            if (typeof UIManager !== 'undefined' && UIManager.nextPage && UIManager.isAtEndOfStep) {
                if (!UIManager.isAtEndOfStep()) {
                    UIManager.nextPage();
                    return;
                }
                if (typeof StoryEffects !== 'undefined' && StoryEffects.stopLoopingStepSound) {
                    StoryEffects.stopLoopingStepSound();
                }
                const rd = this._randomDisplaySession;
                if (
                    rd &&
                    rd.narrationShownAt &&
                    typeof performance !== 'undefined' &&
                    performance.now() - rd.narrationShownAt < 600
                ) {
                    return;
                }
                const scene3 = this.getScene(this.currentSceneId);
                const overlayCg = this.getActiveCgOverlayStep();
                this._randomDisplayEnterCopyOrFinish(scene3, rd.rdStep, rd.module, rd.item, overlayCg);
                return;
            }
        }

        if (this.uiMode.mode === 'random_display_guess_feedback' && this._randomDisplaySession) {
            if (typeof UIManager !== 'undefined' && UIManager.consumeTypewriterSkipIfBusy) {
                if (UIManager.consumeTypewriterSkipIfBusy()) return;
            }
            if (typeof UIManager !== 'undefined' && UIManager.nextPage && UIManager.isAtEndOfStep) {
                if (!UIManager.isAtEndOfStep()) {
                    UIManager.nextPage();
                    return;
                }
            }
            const rd = this._randomDisplaySession;
            if (typeof StoryEffects !== 'undefined' && StoryEffects.stopLoopingStepSound) {
                StoryEffects.stopLoopingStepSound();
            }
            const scene3 = this.getScene(this.currentSceneId);
            const overlayCg = this.getActiveCgOverlayStep();
            this._randomDisplayRunFlowFromStart(scene3, rd.rdStep, rd.module, rd.item, overlayCg);
            return;
        }

        if (this.uiMode.mode === 'random_display_copy' && typeof UIManager !== 'undefined' && UIManager.onRandomDisplayCopyAdvance) {
            if (UIManager.onRandomDisplayCopyAdvance()) return;
        }

        if (this.uiMode.mode === 'topic_pool' || this.uiMode.mode === 'topic_pool_end') {
            if (typeof UIManager !== 'undefined' && UIManager.consumeTypewriterSkipIfBusy) {
                if (UIManager.consumeTypewriterSkipIfBusy()) return;
            }
            if (typeof UIManager !== 'undefined' && UIManager.nextPage && UIManager.isAtEndOfStep) {
                if (!UIManager.isAtEndOfStep()) {
                    UIManager.nextPage();
                    return;
                }
            }
            if (typeof StoryEffects !== 'undefined' && StoryEffects.stopLoopingStepSound) {
                StoryEffects.stopLoopingStepSound();
            }
            this._advanceTopicPoolSession();
            return;
        }

        if (typeof UIManager !== 'undefined' && UIManager.consumeTypewriterSkipIfBusy) {
            if (UIManager.consumeTypewriterSkipIfBusy()) return;
        }

        const stepEnd = this.getCurrentStep();
        const sessEnd = this._cgSession;
        if (
            sessEnd &&
            sessEnd.deferredCgVisualClose &&
            sessEnd.visualActive &&
            sessEnd.sourceStep &&
            stepEnd &&
            typeof UIManager !== 'undefined' &&
            UIManager.isAtEndOfStep &&
            UIManager.isAtEndOfStep() &&
            String(stepEnd.id) === String(sessEnd.sourceStep.cgStopAtStepId)
        ) {
            if (typeof StoryEffects !== 'undefined' && StoryEffects.stopLoopingStepSound) {
                StoryEffects.stopLoopingStepSound();
            }
            const sceneEnd = this.getScene(this.currentSceneId);
            const srcEnd = sessEnd.sourceStep;
            sessEnd.deferredCgVisualClose = false;
            sessEnd.visualClosing = true;
            const fout = 0;
            const closeCgAndGo = () => {
                if (
                    typeof UIManager !== 'undefined' &&
                    UIManager.beginCgStepExit &&
                    UIManager.closeCgStep &&
                    Number.isFinite(fout) &&
                    fout > 0
                ) {
                    const started = UIManager.beginCgStepExit(srcEnd, () => {
                        UIManager.closeCgStep();
                        sessEnd.visualActive = false;
                        if (!sessEnd.visualActive && !sessEnd.musicActive) {
                            this._cgSession = null;
                        }
                        if (typeof StoryFxEngine !== 'undefined' && StoryFxEngine.clearV2Dom) {
                            StoryFxEngine.clearV2Dom();
                        }
                        this.advanceStep();
                    });
                    if (!started) {
                        if (UIManager.closeCgStep) UIManager.closeCgStep();
                        sessEnd.visualActive = false;
                        if (!sessEnd.visualActive && !sessEnd.musicActive) {
                            this._cgSession = null;
                        }
                        if (typeof StoryFxEngine !== 'undefined' && StoryFxEngine.clearV2Dom) {
                            StoryFxEngine.clearV2Dom();
                        }
                        this.advanceStep();
                    }
                } else {
                    if (typeof UIManager !== 'undefined' && UIManager.closeCgStep) UIManager.closeCgStep();
                    sessEnd.visualActive = false;
                    if (!sessEnd.visualActive && !sessEnd.musicActive) {
                        this._cgSession = null;
                    }
                    if (typeof StoryFxEngine !== 'undefined' && StoryFxEngine.clearV2Dom) {
                        StoryFxEngine.clearV2Dom();
                    }
                    this.advanceStep();
                }
            };
            if (typeof StoryFxEngine !== 'undefined' && StoryFxEngine.runCgEndExitSequence) {
                StoryFxEngine.runCgEndExitSequence(srcEnd, sceneEnd, closeCgAndGo);
            } else {
                closeCgAndGo();
            }
            return;
        }

        if (typeof UIManager !== 'undefined' && UIManager.nextPage && UIManager.isAtEndOfStep) {
            if (!UIManager.isAtEndOfStep()) {
                // 若下一步是选项：点击一次直接展开全部对白并立即弹出选项
                UIManager.nextPage();
                return;
            }
            // 已到本步末尾：进入下一步
            if (typeof StoryEffects !== 'undefined' && StoryEffects.stopLoopingStepSound) {
                StoryEffects.stopLoopingStepSound();
            }
            this.advanceStep();
        }
    },

    /**
     * 将 advanceStep 推迟到当前调用栈结束之后，再给浏览器一帧机会绘制（如 layer-story 上的 CG 视频）。
     * 用于：enterCurrentStep 内若立刻再 advance，会与「离开 CG 的同一记点击」连成同步链，导致画面尚未出现就进到随机/复用等步。
     * 使用双 requestAnimationFrame，尽量在首帧绘制之后再推进。
     */
    deferAdvanceStep() {
        const sm = this;
        const run = () => {
            if (sm._deferredCrossSceneJumpActive) return;
            const src = sm.getActiveCgOverlayStep();
            if (src && sm._cgVideoPlaythroughBlocksAdvance(src)) {
                sm._armCgNonLoopVideoWait(() => {
                    sm.advanceStep();
                });
                return;
            }
            sm.advanceStep();
        };
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => {
                requestAnimationFrame(run);
            });
        } else {
            window.setTimeout(run, 0);
        }
    },

    advanceStep() {
        if (this._advanceStepSuppressRomanticExitOnce) {
            this._advanceStepSuppressRomanticExitOnce = false;
        } else {
            const leaving = this.getCurrentStep();
            const dEng =
                typeof StoryFxEngine !== 'undefined' && StoryFxEngine.getLeavingExitDelayMs
                    ? StoryFxEngine.getLeavingExitDelayMs(leaving)
                    : -1;
            if (dEng >= 0 && typeof StoryFxEngine.playLeavingExit === 'function') {
                StoryFxEngine.playLeavingExit(leaving, () => {
                    this._advanceStepSuppressRomanticExitOnce = true;
                    this.advanceStep();
                });
                return;
            }
            const delay =
                typeof StoryEffects !== 'undefined' && StoryEffects.getLegacyRomanticExitDelayMs
                    ? StoryEffects.getLegacyRomanticExitDelayMs(leaving)
                    : 0;
            if (delay > 0 && typeof StoryEffects.applyRomanticExitFromStep === 'function') {
                StoryEffects.applyRomanticExitFromStep(leaving);
                this._advanceStepSuppressRomanticExitOnce = true;
                window.setTimeout(() => this.advanceStep(), delay);
                return;
            }
        }
        this._advanceStepExecute();
    },

    _advanceStepExecute() {
        if (this._deferredCrossSceneJumpActive) return;
        const scene = this.getScene(this.currentSceneId);
        if (!scene || !Array.isArray(scene.steps)) return;

        if (this._fragmentSession) {
            const sess = this._fragmentSession;
            const ord = sess.orderedIndices;
            const pos = ord.indexOf(this.currentStepIndex);
            if (pos >= 0 && pos < ord.length - 1) {
                const curSt = scene.steps[this.currentStepIndex];
                const fj = this._readFinishJump(curSt);
                if (fj) {
                    this._fragmentSession = null;
                    if (fj.type === 'return') {
                        this._queueDeferredReturnPushIfNeeded();
                        this.resumeFromReturnStack();
                        return;
                    }
                    if (this._shouldPushReturnFrame()) this._pushReturnFrame();
                    this.jumpToScene(fj.sceneId, fj.labelSuffix, fj.reuseModuleStay ? { reuseModuleStay: true } : null);
                    return;
                }
                this.currentStepIndex = ord[pos + 1];
                this.enterCurrentStep();
                return;
            }
            const sid = sess.sceneId;
            const sc2 = this.getScene(sid);
            if (sess.editorPreview) {
                this._fragmentSession = null;
                if (sc2) this.clearCgSessionHard(sc2);
                if (typeof StoryEffects !== 'undefined' && StoryEffects.stopLoopingStepSound) {
                    StoryEffects.stopLoopingStepSound();
                }
                this.uiMode = { mode: 'none' };
                if (typeof UIManager !== 'undefined' && UIManager.hideOptions) UIManager.hideOptions();
                const msg =
                    '片段预览已结束（仅播放片段内步骤，不含片段之后的剧情）。\n\n' +
                    '若 CG 或场景音乐未自动响起，请先在本窗口内任意点击或按一次键：浏览器会拦截无手势的自动播放。';
                if (typeof UIManager !== 'undefined' && UIManager.showGameOver) UIManager.showGameOver(msg);
                else alert(msg);
                return;
            }
            const ret = sess.returnInPlace !== false;
            const exitIdx = sess.exitStepIndex;
            const curSt = scene.steps[this.currentStepIndex];
            const fj = this._readFinishJump(curSt);
            this._fragmentSession = null;
            if (fj) {
                this._traceJump('fragment-finish-jump', {
                    stepId: curSt && curSt.id ? curSt.id : '',
                    stepType: curSt && curSt.type ? curSt.type : '',
                    stepLabel: curSt && curSt.labelSuffix ? curSt.labelSuffix : '',
                    next: fj
                });
                if (fj.type === 'return') {
                    this._queueDeferredReturnPushIfNeeded();
                    this.resumeFromReturnStack();
                    return;
                }
                if (this._shouldPushReturnFrame()) this._pushReturnFrame();
                const jopts = fj.reuseModuleStay ? { reuseModuleStay: true } : null;
                this.jumpToScene(fj.sceneId, fj.labelSuffix, jopts);
                return;
            }
            if (ret) {
                this.applyNext({ type: 'return' });
                return;
            }
            this.currentSceneId = sid;
            const len = sc2 && sc2.steps ? sc2.steps.length : 0;
            if (exitIdx >= len) {
                this._traceJump('fragment-exit-fallback-start', { sceneId: sid, exitStepIndex: exitIdx });
                this.jumpToScene('start', '');
                return;
            }
            this.currentStepIndex = exitIdx;
            this.enterCurrentStep();
            return;
        }

        const leavingStep = scene.steps[this.currentStepIndex];
        const fj = this._readFinishJump(leavingStep);
        if (fj) {
            this._traceJump('finish-jump', {
                stepId: leavingStep && leavingStep.id ? leavingStep.id : '',
                stepType: leavingStep && leavingStep.type ? leavingStep.type : '',
                stepLabel: leavingStep && leavingStep.labelSuffix ? leavingStep.labelSuffix : '',
                next: fj
            });
            if (fj.type === 'return') {
                this._queueDeferredReturnPushIfNeeded();
                this.resumeFromReturnStack();
                return;
            }
            if (this._shouldPushReturnFrame()) this._pushReturnFrame();
            const jopts = fj.reuseModuleStay ? { reuseModuleStay: true } : null;
            this.jumpToScene(fj.sceneId, fj.labelSuffix, jopts);
            return;
        }

        this.currentStepIndex = Math.min(scene.steps.length, this.currentStepIndex + 1);
        if (this.currentStepIndex >= scene.steps.length) {
            if (this._storyModuleStack && this._storyModuleStack.length) {
                const top = this._storyModuleStack[this._storyModuleStack.length - 1];
                if (top && top.moduleSceneId === scene.id) {
                    if (top.reuseExitBindings) this._applyReuseFixedExits(top.reuseExitBindings);
                    if (top.reusePopBindings && top.reusePopBindings.length) {
                        this._applyReusePopBindings(top.reusePopBindings, top.reuseEntryKeyUsed);
                    }
                    this._storyModuleStack.pop();
                    this._syncReuseResumeSceneGameState();
                    this._resumeAfterStoryModule(top);
                    return;
                    this.currentSceneId = top.callerSceneId || 'start';
                    const scBack = this.getScene(this.currentSceneId);
                    const stepsBack = scBack && scBack.steps ? scBack.steps : [];
                    let idxBack = Number(top.callerStepIndex);
                    if (!Number.isFinite(idxBack) || idxBack < 0) idxBack = 0;
                    if (idxBack >= stepsBack.length) {
                        if (typeof console !== 'undefined' && console.warn) {
                            console.warn('[SceneManager] 剧情模块返回：调用方下一步超出范围，落在场景末步');
                        }
                        idxBack = Math.max(0, stepsBack.length - 1);
                    }
                    this.currentStepIndex = idxBack;
                    this._activateFragmentSessionIfStepInFragment(scBack, idxBack);
                    if (typeof StoryEffects !== 'undefined' && StoryEffects.playMusicForScene) {
                        StoryEffects.playMusicForScene(scBack);
                    }
                    if (typeof Renderer !== 'undefined' && Renderer.renderScene) Renderer.renderScene(scBack);
                    this._effectsFreshFromSceneRender = true;
                    this.uiMode = { mode: 'none' };
                    this.enterCurrentStep();
                    return;
                }
                if (top && top.moduleSceneId && scene.id !== top.moduleSceneId) {
                    // 复用模块：从分支目标场景经「保留栈」跳到侧线场景后，侧线场景整段播完 → 结束本次复用，弹栈回调用方
                    if (top.reuseExitBindings) this._applyReuseFixedExits(top.reuseExitBindings);
                    if (top.reusePopBindings && top.reusePopBindings.length) {
                        this._applyReusePopBindings(top.reusePopBindings, top.reuseEntryKeyUsed);
                    }
                    this._storyModuleStack.pop();
                    this._syncReuseResumeSceneGameState();
                    this._resumeAfterStoryModule(top);
                    return;
                    this.currentSceneId = top.callerSceneId || 'start';
                    const scBack = this.getScene(this.currentSceneId);
                    const stepsBack = scBack && scBack.steps ? scBack.steps : [];
                    let idxBack = Number(top.callerStepIndex);
                    if (!Number.isFinite(idxBack) || idxBack < 0) idxBack = 0;
                    if (idxBack >= stepsBack.length) {
                        if (typeof console !== 'undefined' && console.warn) {
                            console.warn('[SceneManager] 剧情模块返回：调用方下一步超出范围，落在场景末步');
                        }
                        idxBack = Math.max(0, stepsBack.length - 1);
                    }
                    this.currentStepIndex = idxBack;
                    this._activateFragmentSessionIfStepInFragment(scBack, idxBack);
                    if (typeof StoryEffects !== 'undefined' && StoryEffects.playMusicForScene) {
                        StoryEffects.playMusicForScene(scBack);
                    }
                    if (typeof Renderer !== 'undefined' && Renderer.renderScene) Renderer.renderScene(scBack);
                    this._effectsFreshFromSceneRender = true;
                    this.uiMode = { mode: 'none' };
                    this.enterCurrentStep();
                    return;
                }
            }
            if (this._returnStack && this._returnStack.length) {
                this._traceJump('scene-ended-return-stack', { sceneId: scene.id, sceneName: scene.name || '' });
                this.resumeFromReturnStack();
                return;
            }
            // 场景跑完：回到 start 或停住
            this._traceJump('scene-ended-fallback-start', { sceneId: scene.id, sceneName: scene.name || '' });
            this.jumpToScene('start', '');
            return;
        }
        this.enterCurrentStep();
    },

    /** 对白 / 旁白 / CG 步完成后跳转：scene 为 { sceneId, labelSuffix }；return 为弹出返回栈 */
    _readFinishJump(step) {
        const j = step && step.finishJump && typeof step.finishJump === 'object' ? step.finishJump : null;
        if (!j) return null;
        if (j.type === 'return') return { type: 'return' };
        if (j.type !== 'scene') return null;
        const sid = String(j.sceneId || '').trim();
        if (!sid) return null;
        const labelSuffix = typeof j.labelSuffix === 'string' ? j.labelSuffix : '';
        return { type: 'scene', sceneId: sid, labelSuffix, reuseModuleStay: !!j.reuseModuleStay };
    },

    _readModuleNoReplayNext(step) {
        const n = step && step.moduleNoReplayNext && typeof step.moduleNoReplayNext === 'object' ? step.moduleNoReplayNext : null;
        if (!n) return null;
        if (n.type === 'return') return { type: 'return' };
        if (n.type !== 'scene') return null;
        const sid = String(n.sceneId || '').trim();
        if (!sid) return null;
        return { type: 'scene', sceneId: sid, labelSuffix: typeof n.labelSuffix === 'string' ? n.labelSuffix : '' };
    },

    _skipNoReplayModuleStep(step) {
        const n = this._readModuleNoReplayNext(step);
        if (n) {
            this.applyNext(n);
            return;
        }
        this.deferAdvanceStep();
    },

    _resumeAfterStoryModule(top) {
        if (!top) return false;
        const callerSceneId = top.callerSceneId || 'start';
        const scBack = this.getScene(callerSceneId);
        const stepsBack = scBack && scBack.steps ? scBack.steps : [];
        let callerIdx = Number(top.callerOriginalStepIndex);
        if (!Number.isFinite(callerIdx) || callerIdx < 0) callerIdx = Number(top.callerStepIndex) - 1;
        const callerStep = callerIdx >= 0 && callerIdx < stepsBack.length ? stepsBack[callerIdx] : null;
        const fj = this._readFinishJump(callerStep);
        if (fj) {
            this.currentSceneId = callerSceneId;
            this.currentStepIndex = callerIdx >= 0 ? callerIdx : 0;
            if (fj.type === 'return') {
                this.resumeFromReturnStack();
                return true;
            }
            const jopts = fj.reuseModuleStay ? { reuseModuleStay: true } : null;
            this.jumpToScene(fj.sceneId, fj.labelSuffix, jopts);
            return true;
        }
        this.currentSceneId = callerSceneId;
        let idxBack = Number(top.callerStepIndex);
        if (!Number.isFinite(idxBack) || idxBack < 0) idxBack = 0;
        if (idxBack >= stepsBack.length) {
            const fallbackIdx = Math.max(0, stepsBack.length - 1);
            if (callerStep && callerStep.type === 'storyModule' && callerStep.finishJump) return false;
            if (typeof console !== 'undefined' && console.warn) {
                console.warn('[SceneManager] 剧情模块返回：调用方下一步超出范围，落在场景末步');
            }
            idxBack = fallbackIdx;
        }
        this.currentStepIndex = idxBack;
        this._activateFragmentSessionIfStepInFragment(scBack, idxBack);
        if (typeof StoryEffects !== 'undefined' && StoryEffects.playMusicForScene) {
            StoryEffects.playMusicForScene(scBack);
        }
        if (typeof Renderer !== 'undefined' && Renderer.renderScene) Renderer.renderScene(scBack);
        this._effectsFreshFromSceneRender = true;
        this.uiMode = { mode: 'none' };
        this.enterCurrentStep();
        return true;
    },

    tryContinueFromPlaySave() {
        const project = this.storyData;
        if (typeof PlaySave === 'undefined' || !project || !PlaySave.readSnapshot) {
            alert('尚未有存档');
            return false;
        }
        const snap = PlaySave.readSnapshot(project);
        if (!snap) {
            alert('尚未有存档');
            return false;
        }
        if (typeof PlaySave.restoreAndEnter === 'function') {
            return !!PlaySave.restoreAndEnter(project, snap);
        }
        alert('尚未有存档');
        return false;
    },

    applyNext(next) {
        if (!next || typeof next !== 'object') return;
        if (next.type === 'loadSave') {
            this.tryContinueFromPlaySave();
            return;
        }
        if (this._fragmentSession && this._fragmentSession.singleStepReturnInPlace && next.type === 'return') {
            this._fragmentSession = null;
            this.resumeFromReturnStack();
            return;
        }
        if (next.type === 'return') {
            this._queueDeferredReturnPushIfNeeded();
            this.resumeFromReturnStack();
            return;
        }
        if (next.type === 'scene') {
            const targetSid = String(next.sceneId || 'start').trim();
            const lab = String(next.labelSuffix || '').trim();
            const curSid = String(this.currentSceneId || '').trim();
            if (
                !lab &&
                targetSid === curSid &&
                this.uiMode &&
                this.uiMode.mode === 'choice'
            ) {
                const scene = this.getScene(curSid);
                const nextIdx = this.currentStepIndex + 1;
                if (scene && Array.isArray(scene.steps) && nextIdx < scene.steps.length) {
                    this.uiMode = { mode: 'none' };
                    this.currentStepIndex = nextIdx;
                    this._activateFragmentSessionIfStepInFragment(scene, nextIdx);
                    this.enterCurrentStep();
                    return;
                }
            }
            if (this._shouldPushReturnFrame()) this._pushReturnFrame();
            this.jumpToScene(targetSid || 'start', lab);
            return;
        }
        if (next.type === 'label') {
            if (this._shouldPushReturnFrame()) this._pushReturnFrame();
            const scene = this.getScene(this.currentSceneId);
            if (!scene) return;
            const idx = (scene.steps || []).findIndex(s => s && s.labelSuffix === next.labelSuffix);
            if (idx >= 0) {
                this.currentStepIndex = idx;
                this._activateFragmentSessionIfStepInFragment(scene, idx);
                this.enterCurrentStep();
            }
            return;
        }
        if (next.type === 'fragment') {
            if (this._shouldPushReturnFrame()) this._pushReturnFrame();
            const sid = next.sceneId || this.currentSceneId;
            const ok = this.enterFragment(next.fragmentId || '', sid, next.labelSuffix || '');
            if (!ok && typeof console !== 'undefined' && console.warn) {
                console.warn('[SceneManager] 无法进入片段', next.fragmentId);
            }
            return;
        }
        if (next.type === 'randomDisplay') {
            this._playRandomDisplayNextInline(next);
            return;
        }
        if (next.type === 'graphicReading') {
            this._playGraphicReadingNextInline(next);
            return;
        }
        if (next.type === 'topicPool') {
            this._playTopicPoolNextInline(next);
            return;
        }
        if (next.type === 'gallery' || next.type === 'ownedGallery') {
            this._playGalleryNextInline(next);
            return;
        }
        if (next.type === 'storyModule') {
            this._enterStoryModuleNextInline(next);
            return;
        }
        if (next.type === 'ending') {
            // 结局先用跳场景实现
            this.jumpToScene(next.sceneId || 'start', next.labelSuffix || '');
        }
    },

    _playGalleryNextInline(next) {
        const baseStep = this.getCurrentStep() || {};
        const step = {
            ...next,
            id: `${baseStep.id || 'inline'}_gallery_${String(next.galleryModuleId || '').replace(/[^\w-]/g, '_')}`,
            type: 'gallery',
            galleryModuleId: String(next.galleryModuleId || '').trim()
        };
        this.uiMode = { mode: 'gallery', stepId: step.id };
        if (typeof UIManager !== 'undefined' && UIManager.showGalleryModule) {
            const shown = UIManager.showGalleryModule(step.galleryModuleId, {
                source: 'choice',
                onReturn: () => {
                    this.uiMode = { mode: 'none' };
                    this._returnToCurrentChoiceStep();
                }
            });
            if (shown === false) {
                this.uiMode = { mode: 'none' };
            }
        } else {
            this.uiMode = { mode: 'none' };
            this._returnToCurrentChoiceStep();
        }
    },

    _returnToCurrentChoiceStep() {
        const step = this.getCurrentStep();
        const scene = this.getScene(this.currentSceneId);
        if (step && step.type === 'choice' && typeof UIManager !== 'undefined' && UIManager.showChoiceStep) {
            this.uiMode = { mode: 'choice', stepId: step.id };
            UIManager.showChoiceStep(step);
            this._scheduleCharacterRedraw(scene, step, false);
            return;
        }
        if (typeof this.enterCurrentStep === 'function') {
            this.enterCurrentStep();
        }
    },

    _playOwnedGalleryNextInline(next) {
        const baseStep = this.getCurrentStep() || {};
        const step = {
            ...next,
            id: `${baseStep.id || 'inline'}_owned_gallery`,
            type: 'ownedGallery'
        };
        this.uiMode = { mode: 'gallery', stepId: step.id };
        if (typeof UIManager !== 'undefined' && UIManager.showOwnedGallery) {
            UIManager.showOwnedGallery(step, () => {
                this.uiMode = { mode: 'none' };
                this.advanceStep();
            });
        } else {
            this.deferAdvanceStep();
        }
    },

    _playRandomDisplayNextInline(next) {
        if (typeof RandomDisplayConfig === 'undefined') {
            this.deferAdvanceStep();
            return;
        }
        const scene = this.getScene(this.currentSceneId);
        const baseStep = this.getCurrentStep() || {};
        const step = {
            id: `${baseStep.id || 'inline'}_rd_${String(next.randomDisplayModuleId || '').replace(/[^\w-]/g, '_')}`,
            type: 'randomDisplay',
            randomDisplayModuleId: String(next.randomDisplayModuleId || '').trim(),
            randomDisplayPickMode: next.randomDisplayPickMode === 'randomAll' ? 'randomAll' : 'randomUnseen'
        };
        const overlayCg = this.getActiveCgOverlayStep();
        this._randomDisplaySession = null;
        const picked = RandomDisplayConfig.pickModuleItem(this.storyData, step);
        const module = picked && picked.module;
        const item = picked && picked.item;
        if (!module || !item) {
            this.deferAdvanceStep();
            return;
        }
        RandomDisplayConfig.markItemSeen(module, item);
        this._randomDisplaySession = { rdStep: step, module, item, synthCgStep: null };
        this.uiMode = { mode: 'random_display', stepId: step.id };
        this._randomDisplayRunFlowFromStart(scene, step, module, item, overlayCg);
    },

    _playGraphicReadingNextInline(next) {
        const scene = this.getScene(this.currentSceneId);
        const baseStep = this.getCurrentStep() || {};
        const moduleId = String(next.graphicReadingModuleId || '').trim();
        const step = {
            id: `${baseStep.id || 'inline'}_gr_${moduleId.replace(/[^\w-]/g, '_')}`,
            type: 'graphicReading',
            graphicReadingModuleId: moduleId
        };
        this._startGraphicReadingStep(scene, step);
    },

    _playTopicPoolNextInline(next) {
        const scene = this.getScene(this.currentSceneId);
        const baseStep = this.getCurrentStep() || {};
        const step = {
            id: `${baseStep.id || 'inline'}_tp_${String(next.topicPoolModuleId || '').replace(/[^\w-]/g, '_')}_${String(next.topicPoolItemId || '').replace(/[^\w-]/g, '_')}`,
            type: 'topicPool',
            topicPoolMode: 'direct',
            topicPoolModuleId: String(next.topicPoolModuleId || '').trim(),
            topicPoolItemId: String(next.topicPoolItemId || '').trim(),
            topicPoolPickMode: 'randomAll'
        };
        this._startTopicPoolStep(scene, step);
    },

    _startGraphicReadingStep(scene, step) {
        if (typeof GraphicReadingConfig === 'undefined') {
            this.deferAdvanceStep();
            return;
        }
        GraphicReadingConfig.normalizeProject(this.storyData);
        const module = GraphicReadingConfig.findModule(this.storyData, step && step.graphicReadingModuleId);
        if (!module) {
            if (typeof UIManager !== 'undefined' && UIManager.showTextStep) {
                UIManager.showTextStep(scene, { ...step, type: 'narration', text: '图文朗读模块不存在，请检查。' }, null);
            }
            this.uiMode = { mode: 'graphic_reading', stepId: step.id };
            this._graphicReadingSession = { step, doneMessage: true, segments: [], index: 0 };
            return;
        }
        if (typeof GameState !== 'undefined' && GameState.set) {
            GameState.set(this.graphicReadingSeenVarKey(module.id), 1);
        }
        const segments = GraphicReadingConfig.buildSegments(module);
        this._graphicReadingSession = { step, module, segments, index: 0 };
        const musicAlias = String(module.cgMusicAlias || '').trim();
        if (musicAlias && typeof StoryEffects !== 'undefined' && StoryEffects.playCgMusic) {
            StoryEffects.playCgMusic(musicAlias, true);
        }
        this.uiMode = { mode: 'graphic_reading', stepId: step.id };
        this._showGraphicReadingSegment(scene);
    },

    _showGraphicReadingSegment(scene) {
        const sess = this._graphicReadingSession;
        if (!sess || !sess.module) return;
        const segment = sess.segments[sess.index];
        if (!segment) {
            this._finishGraphicReadingStep(scene);
            return;
        }
        if (typeof UIManager !== 'undefined' && UIManager.showTextStep) {
            UIManager.showTextStep(
                scene,
                {
                    ...sess.step,
                    type: 'narration',
                    text: segment.text || '',
                    _rdUseModuleTypewriter: true,
                    typewriterMsPerChar: sess.module.narrationTypewriterMsPerChar,
                    _rdLinesPerPage: sess.module.narrationLinesPerPage,
                    _rdNarrationFontPx: sess.module.narrationFontPx,
                    _rdNarrationColor: sess.module.narrationColor
                },
                null
            );
        }
        const img = GraphicReadingConfig.imageForSegment(sess.module, segment);
        const tr = GraphicReadingConfig.transitionInfo(sess.module.transition);
        if (img && typeof UIManager !== 'undefined' && UIManager.showGraphicReadingImage) {
            const ms = GraphicReadingConfig.transitionDurationMs
                ? GraphicReadingConfig.transitionDurationMs(sess.module)
                : tr.ms;
            UIManager.showGraphicReadingImage(img.alias, tr.id, ms);
        }
        if (typeof UIManager !== 'undefined' && UIManager._showCharacter) UIManager._showCharacter(false);
    },

    _advanceGraphicReadingSession() {
        const scene = this.getScene(this.currentSceneId);
        const sess = this._graphicReadingSession;
        if (!sess || sess.doneMessage) {
            this._finishGraphicReadingStep(scene);
            return;
        }
        sess.index = (Number(sess.index) || 0) + 1;
        this._showGraphicReadingSegment(scene);
    },

    _finishGraphicReadingStep(scene) {
        const step = this._graphicReadingSession && this._graphicReadingSession.step;
        if (typeof StoryEffects !== 'undefined' && StoryEffects.stopCgMusicResumeBgm) {
            StoryEffects.stopCgMusicResumeBgm(scene, 0);
        } else if (typeof StoryEffects !== 'undefined' && StoryEffects.stopCgMusicOnly) {
            StoryEffects.stopCgMusicOnly();
            if (scene && StoryEffects.playMusicForScene) StoryEffects.playMusicForScene(scene);
        }
        if (typeof UIManager !== 'undefined' && UIManager.closeGraphicReading) UIManager.closeGraphicReading();
        this._graphicReadingSession = null;
        this.uiMode = { mode: 'none' };
        const next = this._readFinishJump(step) || (step && step.next && typeof step.next === 'object' ? step.next : null);
        if (next) this.applyNext(next);
        else this.advanceStep();
    },

    _topicPoolSpeakerExists(displayStep) {
        if (!displayStep || displayStep.type !== 'dialogue') return true;
        const rawRef = String(displayStep.speakerRef || displayStep.speakerName || '').trim();
        if (!rawRef) return true;
        const ch = this.findCharacterByNameOrId(rawRef);
        if (!ch || !ch.id) return false;
        return this._unifiedExistPassForCharId(ch.id);
    },

    _topicPoolItemPassesPresence(module, item) {
        if (!module || !item || module.requirePresentSpeakers !== true) return true;
        const steps = Array.isArray(item.steps) ? item.steps : [];
        return !steps.some(st => st && st.type === 'dialogue' && !this._topicPoolSpeakerExists(st));
    },

    _pickTopicPoolItem(step) {
        if (typeof TopicPoolConfig === 'undefined') return { module: null, item: null };
        TopicPoolConfig.normalizeProject(this.storyData);
        const module = TopicPoolConfig.findModule(this.storyData, step && step.topicPoolModuleId);
        if (!module) return { module: null, item: null };
        if (module.enabled === false) return { module, item: null };
        if (module.condition && typeof this.evalCondition === 'function' && !this.evalCondition(module.condition)) {
            return { module, item: null };
        }
        if (step && step.topicPoolMode === 'direct') {
            const itemId = String(step.topicPoolItemId || '').trim();
            const item = itemId && Array.isArray(module.items) ? module.items.find(it => it && it.id === itemId) || null : null;
            if (!item || item.enabled === false) return { module, item: null };
            if (item.condition && typeof this.evalCondition === 'function' && !this.evalCondition(item.condition)) {
                return { module, item: null };
            }
            if (step.topicPoolPickMode !== 'randomAll' && typeof GameState !== 'undefined' && GameState.get) {
                if (Number(GameState.get(TopicPoolConfig.seenVarKey(module.id, item.id)) || 0) === 1) {
                    return { module, item: null, skippedSeen: true };
                }
            }
            if (item && (!Array.isArray(item.steps) || !item.steps.length) && item.rawText) {
                TopicPoolConfig.updateItemFromRawText(this.storyData, item, item.rawText);
            }
            if (!this._topicPoolItemPassesPresence(module, item)) return { module, item: null };
            return { module, item };
        }
        const available = TopicPoolConfig.listAvailableItems(this.storyData, module).filter(item =>
            this._topicPoolItemPassesPresence(module, item)
        );
        const mode = step && step.topicPoolPickMode === 'randomAll' ? 'randomAll' : 'randomUnseen';
        const pool = available.filter(item => {
            if (mode === 'randomAll') return true;
            if (typeof GameState === 'undefined' || !GameState.get) return true;
            return Number(GameState.get(TopicPoolConfig.seenVarKey(module.id, item.id)) || 0) !== 1;
        });
        if (!pool.length) return { module, item: null };
        const r = typeof GameState !== 'undefined' && GameState.random ? GameState.random() : Math.random();
        const ix = Math.max(0, Math.min(pool.length - 1, Math.floor(r * pool.length)));
        const item = pool[ix];
        if (item && (!Array.isArray(item.steps) || !item.steps.length) && item.rawText) {
            TopicPoolConfig.updateItemFromRawText(this.storyData, item, item.rawText);
        }
        return { module, item };
    },

    _getTopicPoolLeadNarrationFromRawText(item) {
        const rawText = String((item && item.rawText) || '').replace(/\r\n/g, '\n');
        const firstLine = rawText.split('\n').map(line => line.trim()).find(Boolean) || '';
        const m = firstLine.match(/^(.+?)[：:]\s*(.*)$/);
        if (!m) return '';
        const head = String(m[1] || '').trim().replace(/[（）()]/g, '');
        if (head !== '话题' && head !== '主题') return '';
        return String(m[2] || '').trim();
    },

    _topicPoolBuildPlayableSteps(module, item) {
        const rawSteps = item && Array.isArray(item.steps) ? item.steps : [];
        let steps = rawSteps.filter(st => st && (st.type === 'narration' || st.type === 'dialogue'));
        const leadNarration = this._getTopicPoolLeadNarrationFromRawText(item);
        if (leadNarration) {
            while (
                steps.length &&
                steps[0].type === 'narration' &&
                (steps[0].isTopicTitle || String(steps[0].text || '').trim() === String((item && item.title) || '').trim())
            ) {
                steps.shift();
            }
            if (
                !steps.length ||
                steps[0].type !== 'narration' ||
                String(steps[0].text || '').trim() !== leadNarration
            ) {
                steps = [{ type: 'narration', text: leadNarration, isTopicTitle: true }, ...steps];
            }
        }
        return steps.filter(st => {
            if (!st || (st.type !== 'narration' && st.type !== 'dialogue')) return false;
            if (st.type !== 'dialogue') return true;
            if (st.missingSpeaker && module && module.skipMissingSpeaker !== false) return false;
            return true;
        });
    },

    _startTopicPoolStep(scene, step) {
        const picked = this._pickTopicPoolItem(step);
        const module = picked && picked.module;
        const item = picked && picked.item;
        const overlayCg = this.getActiveCgOverlayStep();
        if (picked && picked.skippedSeen) {
            const overlayCgSkip = this.getActiveCgOverlayStep();
            if (typeof UIManager !== 'undefined' && UIManager.showTextStep) {
                UIManager.showTextStep(
                    scene,
                    {
                        ...step,
                        type: 'narration',
                        text: '该话题条目已展示过。请开新游戏，或将本步改为「可以重复展示」。'
                    },
                    overlayCgSkip
                );
            }
            this._topicPoolSession = { step, exhausted: true };
            this.uiMode = { mode: 'topic_pool_end', stepId: step.id };
            return;
        }
        if (!module) {
            if (typeof UIManager !== 'undefined' && UIManager.showTextStep) {
                UIManager.showTextStep(scene, { ...step, type: 'narration', text: '话题模块不存在，请检查 topicPoolModuleId。' }, overlayCg);
            }
            this._topicPoolSession = { step, exhausted: true };
            this.uiMode = { mode: 'topic_pool_end', stepId: step.id };
            return;
        }
        if (!item) {
            const msg =
                module.exhaustedMessage ||
                (step.topicPoolPickMode === 'randomAll'
                    ? '本话题模块没有还可展示的条目了。'
                    : '本话题模块里的话题都已展示过。请开新游戏，或将本步改为「可以重复展示」。');
            if (typeof UIManager !== 'undefined' && UIManager.showTextStep) {
                UIManager.showTextStep(scene, { ...step, type: 'narration', text: msg }, overlayCg);
            }
            this._topicPoolSession = { step, module, exhausted: true };
            this.uiMode = { mode: 'topic_pool_end', stepId: step.id };
            return;
        }
        if (item && item.rawText && typeof TopicPoolConfig !== 'undefined') {
            TopicPoolConfig.updateItemFromRawText(this.storyData, item, item.rawText);
        }
        let steps = this._topicPoolBuildPlayableSteps(module, item);
        if (!steps.length) {
            const overlayCg2 = this.getActiveCgOverlayStep();
            const badMsg =
                '本话题条目没有可播放的对话或旁白（请检查人物名、立绘与「存在」属性，或在编辑器重新保存该条目）。';
            if (typeof UIManager !== 'undefined' && UIManager.showTextStep) {
                UIManager.showTextStep(scene, { ...step, type: 'narration', text: badMsg }, overlayCg2);
            }
            this._topicPoolSession = { step, module, item, exhausted: true };
            this.uiMode = { mode: 'topic_pool_end', stepId: step.id };
            return;
        }
        if (typeof TopicPoolConfig !== 'undefined') TopicPoolConfig.markItemSeen(module, item);
        this._topicPoolSession = { step, module, item, steps, index: 0 };
        this.uiMode = { mode: 'topic_pool', stepId: step.id };
        this._showTopicPoolSessionStep(scene);
    },

    _showTopicPoolSessionStep(scene) {
        const sess = this._topicPoolSession;
        if (!sess || !Array.isArray(sess.steps)) {
            this.uiMode = { mode: 'none' };
            this.advanceStep();
            return;
        }
        const st = sess.steps[sess.index];
        if (!st) {
            this._topicPoolSession = null;
            this.uiMode = { mode: 'none' };
            this.advanceStep();
            return;
        }
        const host = sess.step || {};
        const displayStep =
            st.type === 'dialogue'
                ? {
                      ...host,
                      id: `${host.id || 'topic'}_tp_${sess.index}`,
                      type: 'dialogue',
                      speakerRef: st.speakerRef || st.speakerName || '',
                      expression: st.expression || '',
                      text: st.text || ''
                  }
                : {
                      ...host,
                      id: `${host.id || 'topic'}_tp_${sess.index}`,
                      type: 'narration',
                      text: st.text || ''
                  };
        const overlayCg = this.getActiveCgOverlayStep();
        if (typeof UIManager !== 'undefined' && UIManager.showTextStep) {
            UIManager.showTextStep(scene, displayStep, overlayCg);
        }
        this._scheduleCharacterRedraw(scene, displayStep, !!(overlayCg && overlayCg.hideCharacter !== false));
    },

    _advanceTopicPoolSession() {
        const sess = this._topicPoolSession;
        if (!sess || sess.exhausted) {
            this._topicPoolSession = null;
            this.uiMode = { mode: 'none' };
            this.advanceStep();
            return;
        }
        sess.index = Number(sess.index || 0) + 1;
        const scene = this.getScene(this.currentSceneId);
        if (!scene || !sess.steps || sess.index >= sess.steps.length) {
            this._topicPoolSession = null;
            this.uiMode = { mode: 'none' };
            this.advanceStep();
            return;
        }
        this._showTopicPoolSessionStep(scene);
    },

    _enterStoryModuleNextInline(next) {
        const smid = String(next.storyModuleId || '').trim();
        const list = Array.isArray(this.storyData && this.storyData.storyModules) ? this.storyData.storyModules : [];
        const mod = smid && list.find(m => m && m.id === smid);
        const target = mod && String(mod.targetSceneId || '').trim();
        if (!mod || !target) {
            this.deferAdvanceStep();
            return;
        }
        if (typeof GameState !== 'undefined' && GameState.set) {
            GameState.set(this.storyModuleSeenVarKey(smid), 1);
        }
        const mode = ['scene', 'step', 'fragment'].includes(mod.targetMode) ? mod.targetMode : '';
        if (mode === 'step') {
            const callerScene = this.getScene(this.currentSceneId);
            const ok = this.enterSingleStepReturnInPlace(target, String(mod.targetStepId || '').trim(), null, {
                inheritedBackground: this._cloneSceneBackgroundForModule(callerScene)
            });
            if (!ok) this.deferAdvanceStep();
            return;
        }
        if (mode === 'fragment') {
            const callerScene = this.getScene(this.currentSceneId);
            this._pushReturnFrame(null);
            const ok = this.enterFragment(String(mod.targetFragmentId || '').trim(), target, '', {
                forceReturnInPlace: true,
                renderScene: true,
                inheritedBackground: this._cloneSceneBackgroundForModule(callerScene)
            });
            if (!ok) {
                if (this._returnStack && this._returnStack.length) this._returnStack.pop();
                this.deferAdvanceStep();
            }
            return;
        }
        const lab = mode === 'scene' ? '' : mod.entryLabelSuffix != null ? String(mod.entryLabelSuffix).trim() : '';
        if (!this._storyModuleStack) this._storyModuleStack = [];
        const callerScene = this.getScene(this.currentSceneId);
        this._storyModuleStack.push({
            callerSceneId: this.currentSceneId,
            callerStepIndex: this.currentStepIndex + 1,
            callerOriginalStepIndex: this.currentStepIndex,
            moduleSceneId: target,
            moduleKind: 'storyModule',
            inheritedBackground: this._cloneSceneBackgroundForModule(callerScene),
            reuseResumeSceneId: target
        });
        this._syncReuseResumeSceneGameState();
        this.jumpToScene(target, lab);
    },

    _randomDisplayRunFlowFromStart(scene, rdStep, module, item, overlayCg) {
        if (
            item.rdFxEntry &&
            item.rdFxEntry.effect &&
            typeof StoryEffects !== 'undefined' &&
            StoryEffects.applyStepFx
        ) {
            StoryEffects.applyStepFx({ id: `${rdStep.id}_rd_ent`, stepFx: item.rdFxEntry });
        } else if (item.fxEntrance && typeof StoryEffects !== 'undefined' && StoryEffects.applyRandomDisplayRomanticFx) {
            const entryMs = Math.max(200, Math.min(12000, Number(item.fxEntranceMs) || 2000));
            StoryEffects.applyRandomDisplayRomanticFx({ entry: item.fxEntrance, entryMs });
        }
        const hasCg = !!(item.cgAlias && String(item.cgAlias).trim());
        if (hasCg) {
            const synth = {
                id: rdStep.id,
                type: 'cg',
                cg: { url: String(item.cgAlias).trim() },
                cgMusicAlias: String(item.cgMusicAlias || '').trim(),
                cgMusicLoop: true,
                cgLoop: !(item && item.cgLoop === false),
                cgFadeInMs: 0,
                cgFadeOutMs: 0,
                hideDialogue: true,
                hideCharacter: true
            };
            if (this._randomDisplaySession) this._randomDisplaySession.synthCgStep = synth;
            this.enterCgStepSession(scene, synth);
            if (typeof UIManager !== 'undefined' && UIManager.showCgStep) UIManager.showCgStep(synth);
            this.uiMode = { mode: 'cg', stepId: rdStep.id };
            this._scheduleCharacterRedraw(scene, rdStep, true);
            return;
        }
        this._randomDisplayAfterCg(scene, rdStep, module, item, overlayCg);
    },

    _randomDisplayGuessDelta(effects) {
        if (!Array.isArray(effects)) return 0;
        return effects.reduce((sum, e) => {
            if (!e || typeof e !== 'object') return sum;
            if (e.kind === 'unified' && e.op === 'add') return sum + (Number(e.val) || 0);
            if (e.kind === 'relation') return sum + (Number(e.delta) || 0);
            return sum;
        }, 0);
    },

    _randomDisplayGuessDeltaText(delta) {
        const n = Number(delta) || 0;
        if (n > 0) return `加${Math.abs(n)}分`;
        if (n < 0) return `扣${Math.abs(n)}分`;
        return '分数不变';
    },

    _formatRandomDisplayGuessFeedback(cfg, ctx) {
        const isCorrect = !!(ctx && ctx.isCorrect);
        const correct = String((ctx && ctx.correct) || '').trim();
        const selected = String((ctx && ctx.selected) || '').trim();
        const title = String((ctx && ctx.title) || '').trim();
        const delta = Number((ctx && ctx.delta) || 0);
        const main = String(
            isCorrect
                ? (cfg && cfg.correctFeedback) || '你选对了，{加减}。'
                : (cfg && cfg.wrongFeedback) || '你选错了，{加减}。'
        );
        const answer = !isCorrect ? String((cfg && cfg.answerFeedback) || '正确答案是：{正确答案}。') : '';
        const raw = [main, answer].map(s => String(s || '').trim()).filter(Boolean).join('\n\n');
        const deltaText = this._randomDisplayGuessDeltaText(delta);
        return raw
            .replace(/\{选项\}/g, selected)
            .replace(/\{正确答案\}/g, correct)
            .replace(/\{类型名\}/g, correct)
            .replace(/\{加减\}/g, deltaText)
            .replace(/\{分数变化\}/g, String(delta))
            .replace(/\{分数绝对值\}/g, String(Math.abs(delta)))
            .replace(/\{本次标题\}/g, title);
    },

    _showRandomDisplayGuess(scene, rdStep, module, item, overlayCg) {
        const cfg = rdStep.rdGuess || {};
        const correct = String(item && item.typeName ? item.typeName : '').trim();
        const typePool = Array.isArray(module && module.typeNames) ? module.typeNames.map(x => String(x || '').trim()).filter(Boolean) : [];
        const wanted = Math.max(2, Math.floor(Number(cfg.optionCount || 3)));
        const wrongPool = typePool.filter(t => t && t !== correct);
        const shuffle = arr => {
            const out = arr.slice();
            for (let i = out.length - 1; i > 0; i--) {
                const r = typeof GameState !== 'undefined' && GameState.random ? GameState.random() : Math.random();
                const j = Math.floor(r * (i + 1));
                const tmp = out[i];
                out[i] = out[j];
                out[j] = tmp;
            }
            return out;
        };
        const opts = [];
        if (correct) opts.push({ text: correct, effects: cfg.correctEffects || [], isCorrect: true });
        shuffle(wrongPool)
            .slice(0, Math.max(0, wanted - opts.length))
            .forEach(t => opts.push({ text: t, effects: cfg.wrongEffects || [], isCorrect: false }));
        (Array.isArray(cfg.manualOptions) ? cfg.manualOptions : []).forEach(m => {
            if (!m || !String(m.text || '').trim()) return;
            const text = String(m.text).trim();
            opts.push({ text, effects: Array.isArray(m.effects) ? m.effects : [], isCorrect: correct && text === correct });
        });
        if (!opts.length) {
            if (typeof RandomDisplayConfig !== 'undefined') RandomDisplayConfig.markItemSeen(module, item);
            if (this._randomDisplaySession) this._randomDisplaySession.pendingGuess = false;
            this._randomDisplayRunFlowFromStart(scene, rdStep, module, item, overlayCg);
            return;
        }
        const rows = shuffle(opts).map(opt => ({
            text: opt.text,
            onChoose: () => {
                if (typeof UIManager !== 'undefined' && UIManager.hideOptions) UIManager.hideOptions();
                if (Array.isArray(opt.effects) && typeof GameState !== 'undefined' && GameState.applyEffects) {
                    GameState.applyEffects(opt.effects);
                }
                if (this.maybeTriggerAutoJump('random-display-guess-effects')) return;
                if (typeof RandomDisplayConfig !== 'undefined') RandomDisplayConfig.markItemSeen(module, item);
                if (this._randomDisplaySession) this._randomDisplaySession.pendingGuess = false;
                const delta = this._randomDisplayGuessDelta(opt.effects);
                const feedback = this._formatRandomDisplayGuessFeedback(cfg, {
                    isCorrect: !!opt.isCorrect,
                    selected: opt.text,
                    correct,
                    title: item && item.title,
                    delta
                });
                if (feedback && feedback.trim() && typeof UIManager !== 'undefined' && UIManager.showTextStep) {
                    UIManager.showTextStep(scene, { ...rdStep, type: 'narration', text: feedback }, overlayCg);
                    this.uiMode = { mode: 'random_display_guess_feedback', stepId: rdStep.id };
                    return;
                }
                this._randomDisplayRunFlowFromStart(scene, rdStep, module, item, overlayCg);
            }
        }));
        const prompt = String(cfg.prompt || '').trim() || '你觉得这次会看到什么类型？';
        if (typeof UIManager !== 'undefined' && UIManager.showTextStep) {
            UIManager.showTextStep(scene, { ...rdStep, type: 'narration', text: prompt }, overlayCg);
        }
        this.uiMode = { mode: 'choice', stepId: rdStep.id };
        UIManager.showOptions(rows, null);
    },

    _randomDisplayAfterCg(scene, rdStep, module, item, overlayCg) {
        const synth = this._randomDisplaySession && this._randomDisplaySession.synthCgStep;
        const keepRandomDisplayCg = !!synth;
        if (!keepRandomDisplayCg && typeof UIManager !== 'undefined' && UIManager.closeCgStep) {
            UIManager.closeCgStep();
        }
        const keepRdCgMusic = !!(
            synth &&
            this._cgSession &&
            this._cgSession.sourceStep &&
            String(this._cgSession.sourceStep.id) === String(synth.id) &&
            this._cgSession.musicActive
        );
        if (this._cgSession && !keepRandomDisplayCg) {
            this._cgSession = null;
        }
        // 随机展示：仅当本条刚结束的 CG 与配乐本会话一致时，保留 CG 配乐直到整段随机展示结束
        if (!keepRdCgMusic) {
            if (typeof StoryEffects !== 'undefined' && StoryEffects.stopCgMusicResumeBgm) {
                StoryEffects.stopCgMusicResumeBgm(scene, 0);
            } else if (typeof StoryEffects !== 'undefined' && StoryEffects.stopCgMusicOnly) {
                StoryEffects.stopCgMusicOnly();
                if (StoryEffects.playMusicForScene) StoryEffects.playMusicForScene(scene);
            }
        }
        if (item.rdFxAmbient && item.rdFxAmbient.effect && typeof StoryEffects !== 'undefined' && StoryEffects.applyStepFx) {
            StoryEffects.applyStepFx({ id: `${rdStep.id}_rd_amb`, stepFx: item.rdFxAmbient });
        } else if (item.fxAmbience && typeof StoryEffects !== 'undefined' && StoryEffects.applyRandomDisplayRomanticFx) {
            StoryEffects.applyRandomDisplayRomanticFx({ ambient: item.fxAmbience });
        }
        const hl = String(item.highlight || '');
        if (hl.trim()) {
            const narr = {
                ...rdStep,
                type: 'narration',
                text: hl,
                typewriterMsPerChar:
                    module.narrationTypewriterMsPerChar != null ? module.narrationTypewriterMsPerChar : undefined,
                _rdUseModuleTypewriter: true,
                _rdLinesPerPage: module.narrationLinesPerPage,
                _rdNarrationFontPx: module.narrationFontPx,
                _rdNarrationColor: module.narrationColor
            };
            const persistentCg = keepRandomDisplayCg ? synth : overlayCg;
            if (typeof UIManager !== 'undefined' && UIManager.showTextStep) UIManager.showTextStep(scene, narr, persistentCg);
            this.uiMode = { mode: 'random_display', stepId: rdStep.id };
            if (this._randomDisplaySession && typeof performance !== 'undefined') {
                this._randomDisplaySession.narrationShownAt = performance.now();
            }
            return;
        }
        this._randomDisplayEnterCopyOrFinish(scene, rdStep, module, item, overlayCg);
    },

    _randomDisplayEnterCopyOrFinish(scene, rdStep, module, item, overlayCg) {
        const bodyRaw =
            item && item.copyBody != null
                ? String(item.copyBody).replace(/\r\n/g, '\n')
                : Array.isArray(item && item.pages)
                  ? (item.pages || []).map(p => String(p != null ? p : '')).join('\n\n')
                  : '';
        const body = String(bodyRaw || '').trim();
        const pages =
            body && typeof UIManager !== 'undefined' && UIManager.buildRandomDisplayCopyPages
                ? UIManager.buildRandomDisplayCopyPages(body, module)
                : body
                  ? [body]
                  : [];
        if (pages.length && typeof UIManager !== 'undefined' && UIManager.startRandomDisplayCopy) {
            this.uiMode = { mode: 'random_display_copy', stepId: rdStep.id };
            UIManager.startRandomDisplayCopy(module, pages, () => {
                this._randomDisplayFinalize(scene, rdStep, module, item);
            });
            return;
        }
        this._randomDisplayFinalize(scene, rdStep, module, item);
    },

    _randomDisplayFinalize(scene, rdStep, module, item) {
        const exitStepFx =
            item.rdFxExit && item.rdFxExit.effect
                ? item.rdFxExit
                : item.fxExit && String(item.fxExit).trim() && typeof StoryFxCatalog !== 'undefined'
                  ? { v: 2, family: 'rom_exit', target: StoryFxCatalog.T.ALL, effect: String(item.fxExit).trim() }
                  : null;
        const done = () => {
            if (typeof StoryEffects !== 'undefined' && StoryEffects.stopCgMusicResumeBgm) {
                StoryEffects.stopCgMusicResumeBgm(scene, 0);
            } else if (typeof StoryEffects !== 'undefined' && StoryEffects.stopCgMusicOnly) {
                StoryEffects.stopCgMusicOnly();
                if (StoryEffects.playMusicForScene) StoryEffects.playMusicForScene(scene);
            }
            if (typeof UIManager !== 'undefined' && UIManager.endRandomDisplayCopy) {
                UIManager.endRandomDisplayCopy({ keepDialogueHidden: true });
            }
            if (this._randomDisplaySession && this._randomDisplaySession.galleryPreview) {
                this._randomDisplaySession.finished = true;
                this.uiMode = { mode: 'gallery_rd_preview_done', stepId: rdStep.id };
                return;
            }
            if (typeof UIManager !== 'undefined' && UIManager.closeCgStep) {
                UIManager.closeCgStep({ keepDialogueHidden: true });
            }
            this._randomDisplaySession = null;
            this._cgSession = null;
            this.uiMode = { mode: 'none' };
            if (typeof StoryEffects !== 'undefined' && StoryEffects.stopLoopingStepSound) {
                StoryEffects.stopLoopingStepSound();
            }
            this.advanceStep();
        };
        if (exitStepFx && typeof StoryFxEngine !== 'undefined' && StoryFxEngine.playLeavingExit) {
            StoryFxEngine.playLeavingExit({ id: `${rdStep.id}_rd_exit`, stepFx: exitStepFx }, done);
            return;
        }
        done();
    },

    startGalleryRandomDisplayPreview(module, item) {
        const scene = this.getScene(this.currentSceneId);
        if (!scene || !module || !item) return false;
        const galleryLayer = document.getElementById('layer-owned-gallery');
        if (galleryLayer) {
            galleryLayer.dataset.galleryPreviewActive = '1';
            galleryLayer.style.visibility = 'hidden';
        }
        const rdStep = { id: `gallery_rd_${String(module.id || 'mod')}`, type: 'randomDisplay' };
        this._randomDisplaySession = {
            rdStep,
            module,
            item,
            synthCgStep: null,
            galleryPreview: true,
            finished: false
        };
        this.uiMode = { mode: 'gallery_rd_preview', stepId: rdStep.id };
        const overlayCg = this.getActiveCgOverlayStep();
        this._randomDisplayRunFlowFromStart(scene, rdStep, module, item, overlayCg);
        return true;
    },

    _endGalleryRandomDisplayPreview() {
        const sess = this._randomDisplaySession;
        const galleryLayer = document.getElementById('layer-owned-gallery');
        if (galleryLayer) {
            delete galleryLayer.dataset.galleryPreviewActive;
            galleryLayer.style.visibility = '';
        }
        this.uiMode = { mode: 'gallery' };
        if (typeof UIManager !== 'undefined' && UIManager._renderGalleryModule) {
            UIManager._renderGalleryModule();
        }
        if (sess && typeof sess.onReturnToGrid === 'function') sess.onReturnToGrid();
        const scene = this.getScene(this.currentSceneId);
        if (typeof StoryEffects !== 'undefined' && StoryEffects.stopCgMusicResumeBgm) {
            StoryEffects.stopCgMusicResumeBgm(scene, 0);
        } else if (typeof StoryEffects !== 'undefined' && StoryEffects.stopCgMusicOnly) {
            StoryEffects.stopCgMusicOnly();
            if (scene && StoryEffects.playMusicForScene) StoryEffects.playMusicForScene(scene);
        }
        if (typeof UIManager !== 'undefined' && UIManager.endRandomDisplayCopy) {
            UIManager.endRandomDisplayCopy({ keepDialogueHidden: true });
        }
        if (typeof UIManager !== 'undefined' && UIManager.closeCgStep) {
            UIManager.closeCgStep({ keepDialogueHidden: true });
        }
        if (typeof StoryEffects !== 'undefined' && StoryEffects.stopLoopingStepSound) {
            StoryEffects.stopLoopingStepSound();
        }
        this._randomDisplaySession = null;
        this._cgSession = null;
    }
};
