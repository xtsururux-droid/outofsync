/**
 * effects.js - 场景特效（入场 / 环境叠加 / 浪漫组合 / 剧情冲击）
 * 约定：粒子素材别名 樱花、黄叶、红叶 需在资源库「粒子特效」注册（支持繁体/常见英文名别名，视频不可用）；
 * 剧情冲击类特效默认播放同名音效（资源库「音效文件」别名与特效名一致）。
 */
const StoryEffectsRegistry = {
    /** 内置环境层（不需要粒子图文件） */
    BUILTIN_OVERLAY_IDS: new Set([
        'starryNight',
        'goldenBokeh',
        'softGlow',
        'heartBubbles',
        'rainFine',
        'coldBlue'
    ]),

    ENTRANCE: [{ id: '', label: '（无）' }],
    OVERLAY_BUILTIN: [],
    PARTICLE_PRESETS: [
        { id: '樱花', label: '樱花（粒子图）' },
        { id: '黄叶', label: '黄叶（粒子图）' },
        { id: '红叶', label: '红叶（粒子图）' }
    ],
    COMBO: [{ id: '', label: '（无）' }],
    DRAMATIC: [
        { id: '', label: '（无）' },
        { id: '漂浮', label: '漂浮' },
        { id: '打击', label: '打击' },
        { id: '愤怒', label: '愤怒' },
        { id: '闪电', label: '闪电' },
        { id: '绝望', label: '绝望' },
        { id: '混乱', label: '混乱' },
        { id: '冰点', label: '冰点' },
        { id: '崩塌', label: '崩塌' }
    ],

    comboAssets() {
        return { particles: new Set(), sounds: new Set() };
    },

    /** 资源导出：叠加层里非内置 id 的视为粒子别名（如 樱花 / 黄叶 / 红叶） */
    collectParticleAliasesFromSceneEffects(effects) {
        const ef = effects || {};
        const out = new Set();
        (ef.overlays || []).forEach(id => {
            if (id && !this.BUILTIN_OVERLAY_IDS.has(id)) out.add(id);
        });
        const ca = this.comboAssets(ef.combo || '');
        ca.particles.forEach(p => out.add(p));
        return out;
    },

    expandCombo() {
        return { entrance: '', overlays: [], kenBurns: false };
    },

    normalizeEffects(raw) {
        const e = raw && typeof raw === 'object' ? raw : {};
        let overlays = Array.isArray(e.overlays) ? e.overlays.slice() : [];
        overlays = overlays.filter(Boolean);
        return {
            cgEntrance: e.cgEntrance != null ? String(e.cgEntrance) : '',
            overlays,
            combo: e.combo != null ? String(e.combo) : '',
            dramatic: e.dramatic != null ? String(e.dramatic) : ''
        };
    }
};

const StoryEffects = {
    _cleanups: [],
    _bgmAudio: null,
    _cgMusicAudio: null,
    _cgMusicFadeTimer: null,
    _loopingStepAudio: null,
    /** CG 开始前正在播的场景 BGM（别名+循环）；链式 CG 时仅首次有 BGM 时写入，不在后续无 BGM 时覆盖 */
    _bgmBeforeCg: null,
    /** 新标签页等环境下 Audio.play() 常被拦截，首次点击/按键后再尝试 */
    _audioAutoplayUnlockScheduled: false,

    _scheduleAudioAutoplayUnlockOnGesture() {
        if (this._audioAutoplayUnlockScheduled) return;
        this._audioAutoplayUnlockScheduled = true;
        const resume = () => {
            this._audioAutoplayUnlockScheduled = false;
            try {
                if (this._cgMusicAudio && this._cgMusicAudio.paused) this._cgMusicAudio.play().catch(() => {});
            } catch {}
            try {
                if (this._bgmAudio && this._bgmAudio.paused) this._bgmAudio.play().catch(() => {});
            } catch {}
        };
        document.body.addEventListener('click', resume, { capture: true, once: true });
        document.body.addEventListener('keydown', resume, { capture: true, once: true });
    },

    _addCleanup(fn) {
        if (typeof fn === 'function') this._cleanups.push(fn);
    },

    /** 供 StoryFxEngine 等调用内置叠层（雨、内置光效等） */
    startOverlay(id) {
        this._startOverlay(id);
    },

    clear() {
        this.stopCgMusicOnly();
        this._cleanups.forEach(fn => {
            try {
                fn();
            } catch (err) {
                console.warn('effect cleanup', err);
            }
        });
        this._cleanups = [];

        const fx = document.getElementById('layer-fx');
        if (fx) fx.innerHTML = '';
        const sfx = document.getElementById('layer-screen-fx');
        if (sfx) sfx.innerHTML = '';

        const canvas = document.getElementById('game-canvas');
        if (canvas) {
            canvas.style.animation = '';
            canvas.style.transform = '';
            canvas.style.filter = '';
            canvas.classList.remove(
                'fx-shake',
                'fx-red-tint',
                'fx-grayscale',
                'fx-ice-blue',
                'fx-high-contrast'
            );
        }
    },

    /**
     * 步骤切换时清理「上一步」留下的入场/叠加/冲击视觉（不停止场景 BGM、不停止 CG 音乐）
     */
    cleanupStepVisualFx() {
        this._cleanups.forEach(fn => {
            try {
                fn();
            } catch (err) {
                console.warn('effect cleanup', err);
            }
        });
        this._cleanups = [];

        const fx = document.getElementById('layer-fx');
        if (fx) fx.innerHTML = '';
        const sfx = document.getElementById('layer-screen-fx');
        if (sfx) sfx.innerHTML = '';

        if (typeof StoryFxEngine !== 'undefined' && StoryFxEngine.clearV2Dom) {
            StoryFxEngine.clearV2Dom();
        }

        const gv = document.getElementById('game-viewport');
        if (gv) {
            try {
                gv.querySelectorAll('.fx-romantic-exit-persist').forEach(n => n.remove());
            } catch {}
        }

        const canvas = document.getElementById('game-canvas');
        if (canvas) {
            canvas.style.animation = '';
            canvas.style.transform = '';
            canvas.style.filter = '';
            canvas.classList.remove(
                'fx-shake',
                'fx-red-tint',
                'fx-grayscale',
                'fx-ice-blue',
                'fx-high-contrast'
            );
        }
    },

    _resolveFxTargetMedia() {
        const storyLayer = document.getElementById('layer-story');
        const storyVisible = storyLayer && storyLayer.style.display !== 'none';
        if (storyVisible) {
            const img = storyLayer.querySelector('img');
            const vid = storyLayer.querySelector('video');
            const media = img || vid;
            if (media) {
                const wrap = media.parentElement && media.parentElement !== document.body ? media.parentElement : storyLayer;
                return { media, wrap };
            }
        }
        const bgLayer = document.getElementById('layer-bg');
        const bgImg = bgLayer && bgLayer.querySelector('img');
        if (bgImg) return { media: bgImg, wrap: bgLayer };
        return { media: null, wrap: null };
    },

    /**
     * 运行「步骤 · 特效音效」：v2 由 StoryFxEngine 处理；冲击类（stepFx v2）在此触发 _runDramatic，与步骤「冲击」一致
     */
    applyStepFx(step) {
        if (!step || typeof step !== 'object') return;
        const cgSession = typeof SceneManager !== 'undefined' ? SceneManager._cgSession : null;
        if (typeof StoryFxEngine !== 'undefined' && StoryFxEngine.parseFx && StoryFxEngine.onStepEnter) {
            const spec = StoryFxEngine.parseFx(step);
            if (spec && spec.family === 'shock') {
                const lab = String(spec.effect || '').trim();
                if (lab && typeof this._runDramatic === 'function') {
                    this._runDramatic(lab, { muteSound: !!step.soundAlias });
                }
                StoryFxEngine.onStepEnter(step, { cgSession });
                return;
            }
            StoryFxEngine.onStepEnter(step, { cgSession });
        }
    },

    /**
     * 离开步骤时：浪漫出场（含「淡出」全屏渐变），时长取 step.stepFx.romantic.exitMs（默认 2000）
     */
    applyRomanticExitFromStep(step) {
        const rom = step && step.stepFx && step.stepFx.romantic && typeof step.stepFx.romantic === 'object' ? step.stepFx.romantic : null;
        if (!rom) return;
        const lab = (rom.exit && String(rom.exit).trim()) || '';
        if (!lab) return;
        const ms = Math.max(200, Math.min(12000, Number(rom.exitMs) || 2000));
        this.applyRomanticExitLabel(lab, ms);
    },

    /** 旧版 romantic.exit 离场等待（毫秒） */
    getLegacyRomanticExitDelayMs(step) {
        const rom = step && step.stepFx && step.stepFx.romantic && typeof step.stepFx.romantic === 'object' ? step.stepFx.romantic : null;
        if (!rom) return 0;
        const lab = (rom.exit && String(rom.exit).trim()) || '';
        if (!lab) return 0;
        return Math.max(200, Math.min(12000, Number(rom.exitMs) || 2000));
    },

    /** 换步前需等待的出场时长：v2 组合/出场 或 旧版 romantic.exit */
    getRomanticExitDelayMs(step) {
        if (typeof StoryFxEngine !== 'undefined' && StoryFxEngine.getLeavingExitDelayMs) {
            const d = StoryFxEngine.getLeavingExitDelayMs(step);
            if (d >= 0) return d;
        }
        return this.getLegacyRomanticExitDelayMs(step);
    },

    /**
     * 随机展示条目：与步骤「特效音效」里浪漫入场/氛围一致（仅应用传入的非空项）
     */
    applyRandomDisplayRomanticFx(part) {
        const p = part && typeof part === 'object' ? part : {};
        const entry = String(p.entry || '').trim();
        if (entry) {
            this.applyStepFx({
                stepFx: { v: 2, family: 'rom_entry', target: StoryFxCatalog.T.ALL, effect: entry }
            });
        }
        const amb = String(p.ambient || '').trim();
        if (amb) {
            this.applyStepFx({
                stepFx: { v: 2, family: 'rom_ambient', target: StoryFxCatalog.T.ALL, effect: amb }
            });
        }
    },

    /**
     * 浪漫出场（步骤 / 随机展示等）。淡出：全屏渐隐；其它：短时风格化遮罩。ms 控制主过渡时长（默认 2000）。
     */
    applyRomanticExitLabel(label, ms = 2000) {
        const v = String(label || '').trim();
        if (!v) return;
        const dur = Math.max(200, Math.min(12000, Number(ms) || 2000));
        const sec = (dur / 1000).toFixed(2);
        const gv = document.getElementById('game-viewport');
        const screen = this._screenLayer();
        const parent = gv || screen;
        if (!parent) return;

        if (v === '淡出') {
            const d = document.createElement('div');
            d.className = 'fx-romantic-exit-persist';
            d.style.cssText = `position:absolute;inset:0;pointer-events:none;z-index:24;background:rgba(0,0,0,0.62);opacity:0;transition:opacity ${sec}s ease-in-out;`;
            parent.appendChild(d);
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    try {
                        d.style.opacity = '1';
                    } catch {}
                });
            });
            return;
        }

        const host = screen || parent;
        const d = document.createElement('div');
        const inSec = Math.min(0.95, Math.max(0.28, dur / 1000 * 0.22)).toFixed(2);
        d.className = 'fx-romantic-exit-persist';
        d.style.cssText = `position:absolute;inset:0;pointer-events:none;z-index:3;transition:opacity ${inSec}s ease,box-shadow ${inSec}s ease;`;
        if (v === 'Slow Black' || v === 'Color Fade') {
            d.style.background = v === 'Slow Black' ? 'rgba(0,0,0,0.92)' : 'rgba(20,18,16,0.78)';
        } else if (v === 'Iris Out') {
            d.style.boxShadow = 'inset 0 0 140px rgba(0,0,0,0.95)';
        } else if (v === 'Bokeh Blur' || v === 'Light Dissolve') {
            d.style.background = 'rgba(255,255,255,0.38)';
        } else {
            d.style.background = 'rgba(0,0,0,0.55)';
        }
        d.style.opacity = '0';
        host.appendChild(d);
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                try {
                    d.style.opacity = '1';
                } catch {}
            });
        });
    },

    playSound(alias, opts = {}) {
        if (!alias || typeof AssetManager === 'undefined' || !AssetManager.getPath) return;
        const path = AssetManager.resolveMediaUrl ? AssetManager.resolveMediaUrl('sounds', alias) : AssetManager.getPath('sounds', alias);
        if (!path) return;
        const playPath = finalPath => { try {
            if (opts && opts.loop) {
                this.stopLoopingStepSound();
            }
            const a = new Audio(finalPath);
            if (opts && opts.loop) {
                a.loop = true;
                this._loopingStepAudio = a;
            }
            a.play().catch(() => this._scheduleAudioAutoplayUnlockOnGesture());
        } catch (err) {
            console.warn('playSound', alias, err);
        } };
        playPath(path);
    },

    stopLoopingStepSound() {
        if (!this._loopingStepAudio) return;
        try {
            this._loopingStepAudio.pause();
            this._loopingStepAudio.currentTime = 0;
        } catch {}
        this._loopingStepAudio = null;
    },

    /**
     * 按音乐库别名播放场景 BGM（与场景 JSON 无关）。
     * 用于 CG 结束后恢复进入 CG 前正在播的曲，或与 playMusicForScene 共用逻辑。
     */
    playBgmByAlias(alias, loop = true) {
        const a0 = alias != null ? String(alias).trim() : '';
        if (!a0 || typeof AssetManager === 'undefined' || !AssetManager.getPath) return;
        const path = AssetManager.resolveMediaUrl ? AssetManager.resolveMediaUrl('music', a0) : AssetManager.getPath('music', a0);
        if (!path) return;
        const lp = !!loop;
        if (this._bgmAudio && this._bgmAudio.dataset && this._bgmAudio.dataset.srcAlias === a0 && !!this._bgmAudio.loop === lp) {
            return;
        }
        const playPath = finalPath => { this.stopMusic(); try {
            const a = new Audio(finalPath);
            a.loop = lp;
            a.dataset.srcAlias = a0;
            a.volume = 0.9;
            a.play().catch(() => this._scheduleAudioAutoplayUnlockOnGesture());
            this._bgmAudio = a;
        } catch (err) {
            console.warn('playBgmByAlias', a0, err);
        } };
        if (AssetManager.resolveProjectAssetUrl) {
            AssetManager.resolveProjectAssetUrl('music', a0).then(url => playPath(url || path));
        } else playPath(path);
    },

    /**
     * 按场景配置播放 BGM。若当前场景未配置 BGM（或别名无效），不停止已在播的 BGM，以便从上一场景顺延。
     */
    playMusicForScene(scene) {
        const alias = scene && scene.music && scene.music.url ? String(scene.music.url).trim() : '';
        const loop = !(scene && scene.music && scene.music.loop === false);
        if (!alias || typeof AssetManager === 'undefined' || !AssetManager.getPath) {
            return;
        }
        const path = AssetManager.resolveMediaUrl ? AssetManager.resolveMediaUrl('music', alias) : AssetManager.getPath('music', alias);
        if (!path) {
            return;
        }
        this.playBgmByAlias(alias, loop);
    },

    /** 跨场景跳转、重新 init 等：丢弃未消费的「CG 前 BGM」快照，避免误恢复旧档音乐 */
    discardPendingCgBgmResume() {
        this._bgmBeforeCg = null;
    },

    _snapshotBgmForCgResumeIfPlaying() {
        if (this._bgmAudio && this._bgmAudio.dataset && this._bgmAudio.dataset.srcAlias) {
            this._bgmBeforeCg = {
                alias: String(this._bgmAudio.dataset.srcAlias),
                loop: !!this._bgmAudio.loop
            };
        }
    },

    /** CG 音乐结束或未起播 CG 轨时：优先恢复进入 CG 前的 BGM，否则按当前场景顺延规则播放 */
    _resumeBgmAfterCg(scene) {
        const snap = this._bgmBeforeCg;
        this._bgmBeforeCg = null;
        if (snap && snap.alias) {
            this.playBgmByAlias(snap.alias, snap.loop !== false);
        } else if (typeof this.playMusicForScene === 'function') {
            this.playMusicForScene(scene);
        }
    },

    stopMusic() {
        if (!this._bgmAudio) return;
        try {
            this._bgmAudio.pause();
            this._bgmAudio.currentTime = 0;
        } catch {}
        this._bgmAudio = null;
    },

    _cancelCgMusicFade() {
        if (this._cgMusicFadeTimer) {
            clearInterval(this._cgMusicFadeTimer);
            this._cgMusicFadeTimer = null;
        }
    },

    /** 仅停止 CG 专属音乐（不恢复场景 BGM） */
    stopCgMusicOnly() {
        this._cancelCgMusicFade();
        if (!this._cgMusicAudio) return;
        try {
            this._cgMusicAudio.pause();
            this._cgMusicAudio.currentTime = 0;
        } catch {}
        this._cgMusicAudio = null;
    },

    /**
     * 供协助方在「导入脚本 → 写入 episode」或编辑器内显式操作时调用：从音乐库中别名含连续四字「默认CG」且可解析到文件的条目中随机选一（与《剧情脚本立绘等导入约定手册》§2.1 一致）。无命中时返回 ''（不得从整库随机）。运行时进入 CG 步不再自动调用本函数。
     */
    pickDefaultCgRandomMusicAlias() {
        if (typeof AssetManager === 'undefined' || !AssetManager.getMergedAssetRows) return '';
        const rows = AssetManager.getMergedAssetRows('music') || [];
        const hits = rows.filter(r => {
            if (!r || !r.name) return false;
            const n = String(r.name);
            if (!n.includes('默认CG')) return false;
            const path = AssetManager.resolveMediaUrl ? AssetManager.resolveMediaUrl('music', n) : AssetManager.getPath('music', n);
            return !!String(path || '').trim();
        });
        if (hits.length) {
            const pick = hits[Math.floor(Math.random() * hits.length)];
            return pick && pick.name ? String(pick.name).trim() : '';
        }
        return '';
    },

    /**
     * CG 步骤配乐（别名与场景 BGM 同属资源库 `music` 类型）；播放时会停掉场景 BGM
     */
    playCgMusic(alias, loop = true) {
        if (!alias || typeof AssetManager === 'undefined' || !AssetManager.getPath) return;
        const path = AssetManager.resolveMediaUrl ? AssetManager.resolveMediaUrl('music', alias) : AssetManager.getPath('music', alias);
        if (!path) return;
        const playPath = finalPath => { this._snapshotBgmForCgResumeIfPlaying(); this.stopCgMusicOnly(); this.stopMusic(); try {
            const a = new Audio(finalPath);
            a.loop = !!loop;
            a.volume = 0.95;
            a.play().catch(() => this._scheduleAudioAutoplayUnlockOnGesture());
            this._cgMusicAudio = a;
        } catch (err) {
            console.warn('playCgMusic', alias, err);
        } };
        if (AssetManager.resolveProjectAssetUrl) {
            AssetManager.resolveProjectAssetUrl('music', alias).then(url => playPath(url || path));
        } else playPath(path);
    },

    /**
     * 停止 CG 音乐并恢复场景 BGM（进入「停止音乐」步时调用）
     * @param {object} scene
     * @param {number} fadeMs 淡出毫秒数，默认约 0.65s
     */
    stopCgMusicResumeBgm(scene, fadeMs = 650) {
        this._cancelCgMusicFade();
        const a = this._cgMusicAudio;
        if (!a) {
            this._resumeBgmAfterCg(scene);
            return;
        }
        if (!fadeMs || fadeMs <= 0) {
            try {
                a.pause();
                a.currentTime = 0;
            } catch {}
            this._cgMusicAudio = null;
            this._resumeBgmAfterCg(scene);
            return;
        }
        const startVol = typeof a.volume === 'number' ? a.volume : 0.95;
        const ticks = Math.max(8, Math.ceil(fadeMs / 55));
        const dt = Math.max(35, Math.floor(fadeMs / ticks));
        let n = 0;
        this._cgMusicFadeTimer = setInterval(() => {
            n++;
            try {
                a.volume = Math.max(0, startVol * (1 - n / ticks));
            } catch {}
            if (n >= ticks) {
                this._cancelCgMusicFade();
                try {
                    a.pause();
                    a.currentTime = 0;
                } catch {}
                this._cgMusicAudio = null;
                this._resumeBgmAfterCg(scene);
            }
        }, dt);
    },

    /**
     * @param {object} scene
     * @param {{ storyImg?: HTMLImageElement|null, storyWrap?: HTMLElement|null }} ctx
     */
    runForScene(scene) {
        this.clear();
        const ef = StoryEffectsRegistry.normalizeEffects(scene && scene.effects);
        if (ef.dramatic) {
            this._runDramatic(ef.dramatic);
        }
    },

    _applyEntrance(id, img, wrap, expanded) {
        const w = wrap;
        const el = img;
        const entryMs = expanded && Number(expanded.entryDurationMs) > 0 ? Number(expanded.entryDurationMs) : 2000;
        const opSec = (Math.min(12000, Math.max(200, entryMs)) / 1000).toFixed(2);
        const filtSec = (Math.min(1.6, Number(opSec) + 0.08)).toFixed(2);
        if (id === 'simpleFadeIn') {
            el.style.opacity = '0';
            el.style.filter = 'none';
            el.style.transition = `opacity ${opSec}s ease-out`;
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    el.style.opacity = '1';
                });
            });
            this._addCleanup(() => {
                el.style.transition = '';
                el.style.filter = '';
                el.style.opacity = '';
            });
            return;
        }
        if (id === 'dreamyFade') {
            el.style.opacity = '0';
            el.style.filter = 'blur(14px)';
            el.style.transition = `opacity ${opSec}s ease-out, filter ${filtSec}s ease-out`;
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    el.style.opacity = '1';
                    el.style.filter = 'blur(0)';
                });
            });
            this._addCleanup(() => {
                el.style.transition = '';
                el.style.filter = '';
                el.style.opacity = '';
            });
            return;
        }
        if (id === 'glowExpand') {
            el.style.opacity = '0';
            el.style.transform = 'scale(0.35)';
            el.style.filter = 'brightness(2.8)';
            el.style.transition = 'opacity 0.95s ease-out, transform 1s cubic-bezier(0.2, 0.9, 0.2, 1), filter 1s ease-out';
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    el.style.opacity = '1';
                    el.style.transform = 'scale(1)';
                    el.style.filter = 'brightness(1)';
                });
            });
            const pulse = document.createElement('div');
            pulse.className = 'fx-glow-pulse';
            w.appendChild(pulse);
            const t = window.setTimeout(() => pulse.remove(), 1100);
            this._addCleanup(() => {
                window.clearTimeout(t);
                pulse.remove();
                el.style.transition = '';
                el.style.transform = '';
                el.style.filter = '';
                el.style.opacity = '';
            });
            return;
        }
        if (id === 'mistRevealLR' || id === 'mistRevealTB') {
            const vertical = id === 'mistRevealTB';
            w.style.overflow = 'hidden';
            el.style.clipPath = vertical ? 'inset(100% 0 0 0)' : 'inset(0 100% 0 0)';
            el.style.transition = 'clip-path 1.15s cubic-bezier(0.4, 0, 0.2, 1)';
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    el.style.clipPath = 'inset(0 0 0 0)';
                });
            });
            this._addCleanup(() => {
                el.style.transition = '';
                el.style.clipPath = '';
                w.style.overflow = '';
            });
            return;
        }
        if (id === 'heartbeat') {
            el.style.animation = 'fx-heartbeat 0.85s ease-out 1';
            this._addCleanup(() => {
                el.style.animation = '';
            });
            return;
        }
    },

    _applyKenBurns(el, expanded) {
        const slow = expanded && expanded.kenBurnsSlow;
        const dur = slow ? 38 : 22;
        el.style.transformOrigin = '50% 50%';
        el.style.transition = `transform ${dur}s linear`;
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                el.style.transform = 'scale(1.09)';
            });
        });
        this._addCleanup(() => {
            el.style.transition = '';
            el.style.transform = '';
            el.style.transformOrigin = '';
        });
    },

    _startOverlay(id) {
        const builtin = {
            starryNight: () => this._overlayStarryNight(),
            goldenBokeh: () => this._overlayGoldenBokeh(),
            softGlow: () => this._overlaySoftGlow(),
            heartBubbles: () => this._overlayHeartBubbles(),
            rainFine: () => this._overlayRainFine(),
            coldBlue: () => this._overlayColdBlue()
        };
        if (builtin[id]) {
            builtin[id]();
            return;
        }
        this._overlayParticleAlias(id);
    },

    _ensureFxLayer() {
        return document.getElementById('layer-fx');
    },

    _overlayStarryNight() {
        const layer = this._ensureFxLayer();
        if (!layer) return;
        const holder = document.createElement('div');
        holder.className = 'fx-overlay fx-starry-night';
        for (let i = 0; i < 48; i++) {
            const s = document.createElement('span');
            s.className = 'fx-star';
            s.style.left = `${Math.random() * 100}%`;
            s.style.top = `${Math.random() * 100}%`;
            s.style.animationDelay = `${Math.random() * 4}s`;
            holder.appendChild(s);
        }
        layer.appendChild(holder);
    },

    _overlayGoldenBokeh() {
        const layer = this._ensureFxLayer();
        if (!layer) return;
        const holder = document.createElement('div');
        holder.className = 'fx-overlay fx-bokeh';
        const positions = [
            { l: '2%', t: '20%', w: 120, h: 120 },
            { l: '78%', t: '10%', w: 160, h: 160 },
            { l: '85%', t: '55%', w: 100, h: 100 },
            { l: '5%', t: '65%', w: 140, h: 140 },
            { l: '45%', t: '3%', w: 90, h: 90 }
        ];
        positions.forEach(p => {
            const d = document.createElement('div');
            d.className = 'fx-bokeh-dot';
            d.style.left = p.l;
            d.style.top = p.t;
            d.style.width = `${p.w}px`;
            d.style.height = `${p.h}px`;
            d.style.animationDelay = `${Math.random() * 3}s`;
            holder.appendChild(d);
        });
        layer.appendChild(holder);
    },

    _overlaySoftGlow() {
        const layer = this._ensureFxLayer();
        if (!layer) return;
        const g = document.createElement('div');
        g.className = 'fx-overlay fx-soft-glow';
        layer.appendChild(g);
    },

    _overlayHeartBubbles() {
        const layer = this._ensureFxLayer();
        if (!layer) return;
        const holder = document.createElement('div');
        holder.className = 'fx-overlay fx-heart-bubbles';
        for (let i = 0; i < 7; i++) {
            const h = document.createElement('div');
            h.className = 'fx-heart';
            h.style.left = `${10 + i * 12 + Math.random() * 8}%`;
            h.style.animationDelay = `${i * 0.6 + Math.random()}s`;
            h.style.fontSize = `${14 + Math.random() * 10}px`;
            holder.appendChild(h);
        }
        layer.appendChild(holder);
    },

    _overlayRainFine() {
        const layer = this._ensureFxLayer();
        if (!layer) return;
        const c = document.createElement('canvas');
        c.className = 'fx-overlay fx-rain-canvas';
        c.width = 1280;
        c.height = 720;
        layer.appendChild(c);
        const ctx = c.getContext('2d');
        const drops = [];
        for (let i = 0; i < 140; i++) {
            drops.push({
                x: Math.random() * c.width,
                y: Math.random() * c.height,
                len: 10 + Math.random() * 18,
                speed: 1.2 + Math.random() * 2.4,
                drift: -0.4 + Math.random() * 0.8
            });
        }
        let raf = 0;
        const tick = () => {
            if (!c.isConnected) return;
            ctx.clearRect(0, 0, c.width, c.height);
            ctx.strokeStyle = 'rgba(200, 220, 255, 0.35)';
            ctx.lineWidth = 1;
            drops.forEach(d => {
                ctx.beginPath();
                ctx.moveTo(d.x, d.y);
                ctx.lineTo(d.x + d.drift * 6, d.y + d.len);
                ctx.stroke();
                d.y += d.speed;
                d.x += d.drift;
                if (d.y > c.height) {
                    d.y = -10;
                    d.x = Math.random() * c.width;
                }
            });
            raf = requestAnimationFrame(tick);
        };
        tick();
        this._addCleanup(() => cancelAnimationFrame(raf));
    },

    _overlayColdBlue() {
        const layer = this._ensureFxLayer();
        if (!layer) return;
        const d = document.createElement('div');
        d.className = 'fx-overlay fx-cold-blue';
        layer.appendChild(d);
    },

    _overlayParticleAlias(alias) {
        const layer = this._ensureFxLayer();
        if (!layer) return;
        let path =
            typeof AssetManager !== 'undefined' && AssetManager.resolveParticleImageUrl
                ? AssetManager.resolveParticleImageUrl(alias)
                : typeof AssetManager !== 'undefined' && AssetManager.resolveMediaUrl
                  ? AssetManager.resolveMediaUrl('particles', alias)
                  : typeof AssetManager !== 'undefined' && AssetManager.getPath
                    ? AssetManager.getPath('particles', alias)
                    : null;
        if (
            path &&
            typeof AssetManager !== 'undefined' &&
            AssetManager.isVideoLikeMediaUrl &&
            AssetManager.isVideoLikeMediaUrl(path)
        ) {
            path = null;
        }
        if (!path) {
            console.warn('粒子特效未注册或仅为视频（需 PNG/WebP 等图片）:', alias);
            return;
        }
        const holder = document.createElement('div');
        holder.className = 'fx-overlay fx-particle-fall';
        const pieces = 26;
        let raf = 0;
        const items = [];
        for (let i = 0; i < pieces; i++) {
            const img = document.createElement('img');
            img.src = path;
            img.className = 'fx-particle-img';
            img.draggable = false;
            const scale = 0.35 + Math.random() * 0.55;
            const item = {
                el: img,
                x: Math.random() * 1280,
                y: -40 - Math.random() * 720,
                vx: -0.8 + Math.random() * 1.6,
                vy: 0.8 + Math.random() * 1.8,
                rot: Math.random() * Math.PI * 2,
                vr: (-0.02 + Math.random() * 0.04) * scale,
                sc: scale
            };
            img.style.width = `${42 * scale}px`;
            holder.appendChild(img);
            items.push(item);
        }
        layer.appendChild(holder);
        const tick = () => {
            if (!holder.isConnected) return;
            items.forEach(it => {
                it.x += it.vx + Math.sin(it.y * 0.01) * 0.35;
                it.y += it.vy;
                it.rot += it.vr;
                if (it.y > 760) {
                    it.y = -30 - Math.random() * 100;
                    it.x = Math.random() * 1280;
                }
                if (it.x < -60) it.x = 1280;
                if (it.x > 1340) it.x = -40;
                it.el.style.transform = `translate(${it.x}px, ${it.y}px) rotate(${it.rot}rad)`;
                it.el.style.opacity = String(0.55 + Math.sin(it.y * 0.05) * 0.15);
            });
            raf = requestAnimationFrame(tick);
        };
        tick();
        this._addCleanup(() => cancelAnimationFrame(raf));
    },

    _screenLayer() {
        return document.getElementById('layer-screen-fx');
    },

    _runDramatic(name, opts = {}) {
        const previewHost = opts && opts.previewHost;
        const isPreview = !!(previewHost && previewHost.nodeType === 1);
        const previewCleanups = [];
        const addC = fn => {
            if (isPreview) previewCleanups.push(fn);
            else this._addCleanup(fn);
        };
        if (!opts || !opts.muteSound) {
            if (!isPreview) this.playSound(name);
        }
        let canvas;
        let screen;
        if (isPreview) {
            previewHost.style.position = previewHost.style.position || 'relative';
            previewHost.innerHTML = '';
            canvas = document.createElement('div');
            canvas.style.cssText =
                'position:absolute;inset:0;border-radius:inherit;background:linear-gradient(145deg,#1c2228,#0d1014);transform-origin:center center;';
            previewHost.appendChild(canvas);
            screen = document.createElement('div');
            screen.style.cssText =
                'position:absolute;inset:0;pointer-events:none;z-index:5;overflow:hidden;border-radius:inherit;';
            previewHost.appendChild(screen);
        } else {
            canvas = document.getElementById('game-canvas');
            screen = this._screenLayer();
            if (!canvas) return;
        }

        const shake = (durMs, intensity = 6) => {
            const start = performance.now();
            let raf = 0;
            const step = now => {
                const t = now - start;
                if (t > durMs) {
                    canvas.style.transform = '';
                    return;
                }
                const decay = 1 - t / durMs;
                const x = (Math.random() - 0.5) * 2 * intensity * decay;
                const y = (Math.random() - 0.5) * 2 * intensity * decay;
                canvas.style.transform = `translate(${x}px, ${y}px)`;
                raf = requestAnimationFrame(step);
            };
            raf = requestAnimationFrame(step);
            addC(() => {
                cancelAnimationFrame(raf);
                canvas.style.transform = '';
            });
        };

        const spriteFloat = () => {
            const target = isPreview ? canvas : document.getElementById('layer-char');
            if (!target) return;
            const oldTransition = target.style.transition;
            const oldTransform = target.style.transform;
            target.style.transition = '';
            target.style.transform = oldTransform || '';
            let raf = 0;
            const start = performance.now();
            const step = now => {
                const t = (now - start) / 1000;
                const y = Math.sin(t * Math.PI * 2 / 2.8) * 10 - 4;
                const scale = 1 + Math.sin(t * Math.PI * 2 / 5.6) * 0.006;
                const base = isPreview ? '' : (oldTransform || 'translateX(-50%)');
                target.style.transform = `${base} translateY(${y.toFixed(2)}px) scale(${scale.toFixed(4)})`;
                raf = requestAnimationFrame(step);
            };
            raf = requestAnimationFrame(step);
            if (screen) {
                const glow = document.createElement('div');
                glow.style.cssText =
                    'position:absolute;inset:0;pointer-events:none;opacity:.28;background:radial-gradient(circle at 50% 46%, rgba(190,220,255,.35), rgba(255,255,255,0) 46%);mix-blend-mode:screen;';
                screen.appendChild(glow);
                addC(() => glow.remove());
            }
            addC(() => {
                cancelAnimationFrame(raf);
                target.style.transition = oldTransition;
                target.style.transform = oldTransform;
            });
        };

        try {
            if (name === '漂浮') {
                spriteFloat();
                return;
            }

            if (name === '打击') {
                const flash = document.createElement('div');
                flash.className = 'fx-flash-white';
                screen.appendChild(flash);
                window.setTimeout(() => flash.remove(), 220);
                canvas.style.transition = 'transform 0.12s ease-out';
                canvas.style.transform = 'scale(0.94)';
                window.setTimeout(() => {
                    canvas.style.transform = 'scale(1)';
                    shake(420, 10);
                }, 90);
                addC(() => {
                    canvas.style.transition = '';
                    flash.remove();
                });
                return;
            }

            if (name === '愤怒') {
                canvas.classList.add('fx-red-tint');
                shake(900, 3.5);
                const vig = document.createElement('div');
                vig.className = 'fx-vignette-red';
                screen.appendChild(vig);
                addC(() => {
                    canvas.classList.remove('fx-red-tint');
                    vig.remove();
                });
                return;
            }

            if (name === '闪电') {
                let flashes = 0;
                const iv = window.setInterval(() => {
                    flashes++;
                    const flash = document.createElement('div');
                    flash.className = flashes % 2 === 0 ? 'fx-flash-white' : 'fx-flash-dark';
                    flash.style.opacity = flashes % 2 === 0 ? '0.92' : '0.55';
                    screen.appendChild(flash);
                    window.setTimeout(() => flash.remove(), 45);
                    canvas.classList.toggle('fx-high-contrast', flashes % 2 === 1);
                    if (flashes >= 6) {
                        window.clearInterval(iv);
                        canvas.classList.remove('fx-high-contrast');
                    }
                }, 55);
                addC(() => {
                    window.clearInterval(iv);
                    canvas.classList.remove('fx-high-contrast');
                });
                return;
            }

            if (name === '绝望') {
                canvas.classList.add('fx-grayscale');
                canvas.style.transition = 'transform 2.8s ease-in, filter 2.8s ease-in';
                canvas.style.transform = 'scale(0.88)';
                const fog = document.createElement('div');
                fog.className = 'fx-edge-fog';
                screen.appendChild(fog);
                addC(() => {
                    canvas.classList.remove('fx-grayscale');
                    canvas.style.transition = '';
                    canvas.style.transform = '';
                    fog.remove();
                });
                return;
            }

            if (name === '混乱') {
                let t0 = performance.now();
                let raf = 0;
                const loop = now => {
                    const t = now - t0;
                    if (t > 2200) {
                        canvas.style.filter = '';
                        canvas.style.transform = '';
                        return;
                    }
                    const phase = Math.floor(t / 90) % 2;
                    canvas.style.filter = phase ? 'invert(1) contrast(1.15)' : 'contrast(1.25)';
                    canvas.style.transform = `translate(${(Math.random() - 0.5) * 14}px, ${(Math.random() - 0.5) * 12}px)`;
                    raf = requestAnimationFrame(loop);
                };
                raf = requestAnimationFrame(loop);
                addC(() => {
                    cancelAnimationFrame(raf);
                    canvas.style.filter = '';
                    canvas.style.transform = '';
                });
                return;
            }

            if (name === '冰点') {
                canvas.classList.add('fx-ice-blue');
                const frost = document.createElement('div');
                frost.className = 'fx-frost-frame';
                screen.appendChild(frost);
                window.setTimeout(() => frost.classList.add('fx-frost-out'), 380);
                window.setTimeout(() => {
                    frost.remove();
                    canvas.classList.remove('fx-ice-blue');
                }, 1400);
                addC(() => {
                    frost.remove();
                    canvas.classList.remove('fx-ice-blue');
                });
                return;
            }

            if (name === '崩塌') {
                shake(700, 12);
                const crack = document.createElement('div');
                crack.className = 'fx-shatter';
                screen.appendChild(crack);
                window.setTimeout(() => crack.remove(), 900);
                addC(() => crack.remove());
            }
        } finally {
            if (isPreview) {
                window.setTimeout(() => {
                    previewCleanups.forEach(fn => {
                        try {
                            fn();
                        } catch (e) {}
                    });
                    try {
                        previewHost.innerHTML = '';
                    } catch (e) {}
                }, 2800);
            }
        }
    }
};
