/**
 * play-save.js — 游玩自动存档（单档位，配置写在 project.playSave）
 */
const PlaySave = {
    FORMAT_VERSION: 1,
    STORAGE_PREFIX: 'gaa_play_save_v1_',

    normalizeSettings(project) {
        if (!project || typeof project !== 'object') return;
        const ps = project.playSave && typeof project.playSave === 'object' ? project.playSave : {};
        project.playSave = {
            enabled: ps.enabled === true,
            autoSaveSceneId: typeof ps.autoSaveSceneId === 'string' ? ps.autoSaveSceneId.trim() : '',
            autoSaveLabelSuffix: typeof ps.autoSaveLabelSuffix === 'string' ? ps.autoSaveLabelSuffix.trim() : '',
            projectKey:
                typeof ps.projectKey === 'string' && ps.projectKey.trim()
                    ? ps.projectKey.trim().replace(/[^\w\u4e00-\u9fff-]/g, '_').slice(0, 80)
                    : this.deriveProjectKey(project)
        };
    },

    deriveProjectKey(project) {
        const name = String((project && project.projectName) || 'episode')
            .trim()
            .replace(/[^\w\u4e00-\u9fff-]/g, '_')
            .slice(0, 48);
        const sid = project && project.scenes && project.scenes[0] && project.scenes[0].id;
        const tail = sid ? String(sid).slice(-12) : 'default';
        return `${name || 'episode'}_${tail}`;
    },

    storageKey(project) {
        this.normalizeSettings(project);
        const key = (project.playSave && project.playSave.projectKey) || this.deriveProjectKey(project);
        return `${this.STORAGE_PREFIX}${key}`;
    },

    getSettings(project) {
        this.normalizeSettings(project);
        return project.playSave;
    },

    isAutoSaveEnabled(project) {
        const ps = this.getSettings(project);
        return !!(ps && ps.enabled && ps.autoSaveSceneId);
    },

    matchesCheckpoint(scene, step, project) {
        const ps = this.getSettings(project);
        if (!ps || !ps.enabled || !ps.autoSaveSceneId || !scene || !step) return false;
        if (String(scene.id || '').trim() !== ps.autoSaveSceneId) return false;
        const lab = step.labelSuffix != null ? String(step.labelSuffix).trim() : '';
        const want = ps.autoSaveLabelSuffix != null ? String(ps.autoSaveLabelSuffix).trim() : '';
        return lab === want;
    },

    captureSnapshot(project) {
        const sm = typeof SceneManager !== 'undefined' ? SceneManager : null;
        const gs = typeof GameState !== 'undefined' ? GameState : null;
        if (!sm || !gs || !project) return null;
        const scene = sm.getScene(sm.currentSceneId);
        const step = sm.getCurrentStep();
        const ps = this.getSettings(project);
        const snapshot = {
            formatVersion: this.FORMAT_VERSION,
            savedAt: Date.now(),
            projectKey: ps.projectKey,
            checkpointSceneId: ps.autoSaveSceneId,
            checkpointLabelSuffix: ps.autoSaveLabelSuffix,
            sceneId: sm.currentSceneId || '',
            sceneName: scene && scene.name ? String(scene.name) : '',
            labelSuffix: step && step.labelSuffix != null ? String(step.labelSuffix).trim() : '',
            stepIndex: Number.isFinite(sm.currentStepIndex) ? sm.currentStepIndex : 0,
            gameState: {
                variables: JSON.parse(JSON.stringify(gs.variables || {})),
                characters: JSON.parse(JSON.stringify(gs.characters || {})),
                sceneAppearances: JSON.parse(JSON.stringify(gs.sceneAppearances || {})),
                stepAppearances: JSON.parse(JSON.stringify(gs.stepAppearances || {})),
                fragmentAppearances: JSON.parse(JSON.stringify(gs.fragmentAppearances || {})),
                randomWeightDeltas: JSON.parse(JSON.stringify(gs.randomWeightDeltas || {})),
                loveGroups: JSON.parse(JSON.stringify(gs.loveGroups || {})),
                loveGroupMembership: JSON.parse(JSON.stringify(gs.loveGroupMembership || {}))
            },
            sceneManager: {
                returnStack: JSON.parse(JSON.stringify(sm._returnStack || [])),
                storyModuleStack: JSON.parse(JSON.stringify(sm._storyModuleStack || [])),
                reuseEntryOutcomeByStepId: JSON.parse(JSON.stringify(sm._reuseEntryOutcomeByStepId || {})),
                autoAnnouncedScenes: JSON.parse(JSON.stringify(sm._autoAnnouncedScenes || {})),
                autoJumpedRules: JSON.parse(JSON.stringify(sm._autoJumpedRules || {})),
                deferredReturnPushFrame: sm._deferredReturnPushFrame
                    ? JSON.parse(JSON.stringify(sm._deferredReturnPushFrame))
                    : null
            },
            jumpSlots: JSON.parse(JSON.stringify(project.jumpSlots || []))
        };
        return snapshot;
    },

    writeSnapshot(project, snapshot) {
        if (!snapshot || !project) return false;
        try {
            localStorage.setItem(this.storageKey(project), JSON.stringify(snapshot));
            return true;
        } catch (e) {
            if (typeof console !== 'undefined' && console.warn) console.warn('[PlaySave] 写入失败', e);
            return false;
        }
    },

    _parseSnapshotRaw(raw) {
        if (!raw) return null;
        try {
            const snap = JSON.parse(raw);
            if (!snap || snap.formatVersion !== this.FORMAT_VERSION || !snap.sceneId) return null;
            return snap;
        } catch (e) {
            return null;
        }
    },

    _snapshotMatchesProject(snap, project) {
        if (!snap || !project) return false;
        const ps = this.getSettings(project);
        if (snap.projectKey && ps.projectKey && snap.projectKey === ps.projectKey) return true;
        const ck = String(snap.checkpointSceneId || snap.sceneId || '').trim();
        const want = String(ps.autoSaveSceneId || '').trim();
        if (want && ck === want) return true;
        return false;
    },

    readSnapshot(project) {
        if (!project) return null;
        try {
            const direct = this._parseSnapshotRaw(localStorage.getItem(this.storageKey(project)));
            if (direct && this._snapshotMatchesProject(direct, project)) return direct;
            if (typeof localStorage === 'undefined') return null;
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (!k || !k.startsWith(this.STORAGE_PREFIX)) continue;
                const snap = this._parseSnapshotRaw(localStorage.getItem(k));
                if (snap && this._snapshotMatchesProject(snap, project)) return snap;
            }
            return null;
        } catch (e) {
            return null;
        }
    },

    hasReadableSave(project) {
        return !!this.readSnapshot(project);
    },

    getSaveSummary(project) {
        const snap = this.readSnapshot(project);
        if (!snap) return null;
        const d = snap.savedAt ? new Date(snap.savedAt) : null;
        const timeStr = d && !isNaN(d.getTime()) ? d.toLocaleString() : '';
        const place =
            (snap.sceneName && String(snap.sceneName).trim()) ||
            (snap.sceneId && String(snap.sceneId).trim()) ||
            '未知场景';
        const lab = snap.labelSuffix ? ` · ${snap.labelSuffix}` : '';
        return { timeStr, place: `${place}${lab}`, snapshot: snap };
    },

    tryAutoSaveAfterEnterStep(scene, step, project) {
        if (typeof window !== 'undefined') {
            const sp = new URLSearchParams(window.location.search);
            if (sp.get('gaaFragmentPreview') === '1' || sp.get('gaaProjectPreview') === '1') return;
        }
        const data = project || (typeof SceneManager !== 'undefined' ? SceneManager.storyData : null);
        if (!data || !this.matchesCheckpoint(scene, step, data)) return;
        const snap = this.captureSnapshot(data);
        if (!snap) return;
        this.writeSnapshot(data, snap);
        if (typeof console !== 'undefined' && console.log) {
            console.log('[PlaySave] 自动存档', snap.sceneName || snap.sceneId, snap.labelSuffix);
        }
    },

    applyGameStateSnapshot(gsSnap, project) {
        const gs = typeof GameState !== 'undefined' ? GameState : null;
        if (!gs || !gsSnap) return;
        gs.variables = JSON.parse(JSON.stringify(gsSnap.variables || {}));
        gs.characters = JSON.parse(JSON.stringify(gsSnap.characters || {}));
        gs.sceneAppearances = JSON.parse(JSON.stringify(gsSnap.sceneAppearances || {}));
        gs.stepAppearances = JSON.parse(JSON.stringify(gsSnap.stepAppearances || {}));
        gs.fragmentAppearances = JSON.parse(JSON.stringify(gsSnap.fragmentAppearances || {}));
        gs.randomWeightDeltas = JSON.parse(JSON.stringify(gsSnap.randomWeightDeltas || {}));
        gs.loveGroups = JSON.parse(JSON.stringify(gsSnap.loveGroups || {}));
        gs.loveGroupMembership = JSON.parse(JSON.stringify(gsSnap.loveGroupMembership || {}));
        if (typeof LoveGroupManager !== 'undefined' && LoveGroupManager.rebuildMembership) {
            LoveGroupManager.rebuildMembership(gs);
        }
        gs._projectData = project || gs._projectData || null;
        this._syncAppearedFlagsToStoryData(project, gs);
    },

    _syncAppearedFlagsToStoryData(project, gs) {
        if (!project || !Array.isArray(project.scenes)) return;
        (project.scenes || []).forEach(scene => {
            if (!scene || !scene.id) return;
            const sv = gs.sceneAppearances && gs.sceneAppearances[scene.id] ? 1 : 0;
            scene.appearedValue = sv;
            (scene.steps || []).forEach(step => {
                if (!step || !step.id) return;
                const tv = gs.stepAppearances && gs.stepAppearances[step.id] ? 1 : 0;
                step.appearedValue = tv;
            });
        });
    },

    applySceneManagerSnapshot(smSnap) {
        const sm = typeof SceneManager !== 'undefined' ? SceneManager : null;
        if (!sm || !smSnap) return;
        sm._returnStack = JSON.parse(JSON.stringify(smSnap.returnStack || []));
        sm._storyModuleStack = JSON.parse(JSON.stringify(smSnap.storyModuleStack || []));
        sm._reuseEntryOutcomeByStepId = JSON.parse(JSON.stringify(smSnap.reuseEntryOutcomeByStepId || {}));
        sm._autoAnnouncedScenes = JSON.parse(JSON.stringify(smSnap.autoAnnouncedScenes || {}));
        sm._autoJumpedRules = JSON.parse(JSON.stringify(smSnap.autoJumpedRules || {}));
        sm._deferredReturnPushFrame = smSnap.deferredReturnPushFrame
            ? JSON.parse(JSON.stringify(smSnap.deferredReturnPushFrame))
            : null;
        sm._cgSession = null;
        sm._fragmentSession = null;
        sm._quizSession = null;
        sm._randomDisplaySession = null;
        sm._topicPoolSession = null;
        sm.uiMode = { mode: 'none' };
        sm._cgFadeBusy = false;
        sm._cgExitInProgress = false;
        sm._cgFadeInBlockUntilMs = 0;
        sm._afterCgInputBlockUntilMs = 0;
        sm._deferredCrossSceneJumpActive = false;
        sm._autoAnnounceBusy = false;
        sm._autoJumpBusy = false;
    },

    restoreAndEnter(project, snapshot) {
        const sm = typeof SceneManager !== 'undefined' ? SceneManager : null;
        if (!sm || !snapshot || !project) return false;
        if (Array.isArray(snapshot.jumpSlots)) {
            project.jumpSlots = JSON.parse(JSON.stringify(snapshot.jumpSlots));
        }
        if (snapshot.gameState) this.applyGameStateSnapshot(snapshot.gameState, project);
        if (snapshot.sceneManager) this.applySceneManagerSnapshot(snapshot.sceneManager);
        const sid = String(snapshot.sceneId || '').trim();
        const lab = snapshot.labelSuffix != null ? String(snapshot.labelSuffix).trim() : '';
        if (!sid) return false;
        sm.jumpToScene(sid, lab);
        return true;
    }
};
