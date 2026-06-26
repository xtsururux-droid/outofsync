/**
 * ui-manager.js - 界面显示管理器
 */
const UIManager = {
    currentPage: 0,
    pages: [],
    _stepId: '',
    /** 逐字显示：定时器与当前页状态 */
    _typewriterTimerId: null,
    _typewriterGraphemes: [],
    _typewriterVisible: 0,
    _typewriterPageDone: true,
    _typewriterStepRef: null,

    _measureCtx() {
        const c = UIManager._measureCanvas || (UIManager._measureCanvas = document.createElement('canvas'));
        const ctx = c.getContext('2d');
        const el = document.getElementById('text-content');
        const style = el ? window.getComputedStyle(el) : null;
        const font = style ? `${style.fontWeight} ${style.fontSize} ${style.fontFamily}` : '22px sans-serif';
        ctx.font = font;
        return ctx;
    },

    _wrapToVisualLines(text, maxWidthPx) {
        const ctx = this._measureCtx();
        const raw = String(text || '').replace(/\r\n/g, '\n');
        const logicalLines = raw.split('\n');
        const out = [];

        const pushWrapped = (line) => {
            const s = String(line || '');
            if (!s) {
                out.push('');
                return;
            }
            let cur = '';
            for (let i = 0; i < s.length; i++) {
                const ch = s[i];
                const next = cur + ch;
                if (ctx.measureText(next).width > maxWidthPx && cur) {
                    out.push(cur);
                    cur = ch;
                } else {
                    cur = next;
                }
            }
            if (cur) out.push(cur);
        };

        logicalLines.forEach(l => pushWrapped(l));
        return out;
    },

    _applyNarrationParagraphIndent(text, step) {
        if (!step || step.type !== 'narration') return String(text || '');
        return String(text || '')
            .replace(/\r\n/g, '\n')
            .split('\n')
            .map(line => {
                if (!String(line || '').trim()) return line;
                return `　　${String(line || '').replace(/^[\s　]+/, '')}`;
            })
            .join('\n');
    },

    splitTextIntoPagesBy3Lines(text) {
        // 按“作者输入的逻辑换行”分页，不在一句话中间自动折断
        const raw = String(text || '').replace(/\r\n/g, '\n');
        const lines = raw.split('\n');
        // 防止尾部不可见空行被分页成“下一页空白框”
        while (lines.length > 1 && String(lines[lines.length - 1] || '').trim() === '') {
            lines.pop();
        }
        const pages = [];
        for (let i = 0; i < lines.length; i += 3) {
            pages.push(lines.slice(i, i + 3).join('\n'));
        }
        return pages.length ? pages : [''];
    },

    /**
     * 随机展示屏幕文案：按「与游戏中一致的宽度 + 文案字号 + 视口高度」折成视觉行，再整行分页（不裁半行）。
     * 正文写在条目的 copyBody；旧项目仅有 pages[] 时由 SceneManager 先拼成 body 再传入。
     */
    buildRandomDisplayCopyPages(fullText, module) {
        const raw = String(fullText || '').replace(/\r\n/g, '\n');
        if (!raw.trim()) return [];
        const vp = document.getElementById('game-viewport');
        const vpW = vp && vp.clientWidth ? vp.clientWidth : 1280;
        const vpH = vp && vp.clientHeight ? vp.clientHeight : 720;
        const region = module && String(module.copyRegion || 'full').toLowerCase() === 'right' ? 'right' : module && String(module.copyRegion || '').toLowerCase() === 'left' ? 'left' : 'full';
        const maxWidthPx =
            region === 'full'
                ? Math.max(200, Math.min(Math.round(vpW * 0.92), 960))
                : Math.max(200, Math.min(Math.round(vpW * 0.42), 520));
        const fontPx = Math.max(8, Math.min(64, Number(module && module.copyFontPx) || 22));
        const lineHeightRatio = 1.55;
        const lineH = fontPx * lineHeightRatio;
        const topReserve = Math.round(vpH * 0.04) + fontPx;
        const bottomReserve = Math.round(vpH * 0.06);
        const usableH = Math.max(lineH, vpH - topReserve - bottomReserve);
        const linesPerPage = Math.max(1, Math.floor(usableH / lineH));

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return raw.trim() ? [raw] : [];
        ctx.font = `${fontPx}px "Microsoft YaHei","SimSun",sans-serif`;

        const wrapOneSegment = seg => {
            const out = [];
            let rem = seg;
            while (rem.length) {
                if (ctx.measureText(rem).width <= maxWidthPx) {
                    out.push(rem);
                    break;
                }
                let lo = 1;
                let hi = rem.length;
                let fit = 1;
                while (lo <= hi) {
                    const mid = (lo + hi) >> 1;
                    if (ctx.measureText(rem.slice(0, mid)).width <= maxWidthPx) {
                        fit = mid;
                        lo = mid + 1;
                    } else hi = mid - 1;
                }
                let cut = fit;
                if (fit < rem.length) {
                    const slice = rem.slice(0, fit);
                    const sp = Math.max(slice.lastIndexOf(' '), slice.lastIndexOf('\t'), slice.lastIndexOf('　'));
                    if (sp > Math.floor(fit * 0.35)) cut = sp + 1;
                }
                out.push(rem.slice(0, cut));
                rem = rem.slice(cut);
            }
            return out;
        };

        const visualLines = [];
        const blocks = raw.split('\n');
        for (let bi = 0; bi < blocks.length; bi++) {
            const seg = blocks[bi];
            if (seg === '') {
                visualLines.push('');
                continue;
            }
            wrapOneSegment(seg).forEach(line => visualLines.push(line));
        }

        const pages = [];
        for (let i = 0; i < visualLines.length; i += linesPerPage) {
            pages.push(visualLines.slice(i, i + linesPerPage).join('\n'));
        }
        return pages.length ? pages : [raw.trim()];
    },

    /**
     * 随机展示旁白：按对话框可用宽度折成「视觉行」，再按每页行数切块。
     * 避免「最后一行很长、在框里折成多行」时翻页把折行后半段跳过。
     */
    buildRdNarrationPagesByVisualLines(fullText, step) {
        const raw = String(fullText || '').replace(/\r\n/g, '\n');
        if (!raw.trim()) return [''];
        const lp = Math.max(1, Math.min(80, Math.floor(Number(step && step._rdLinesPerPage)) || 6));
        const fontPx = Math.max(8, Math.min(48, Math.floor(Number(step && step._rdNarrationFontPx)) || 16));
        const vp = document.getElementById('game-viewport');
        const vw = vp && vp.clientWidth ? vp.clientWidth : typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 1280;
        const colInner = Math.min(1100, Math.max(200, vw - 48));
        let maxWidthPx = Math.max(200, colInner - 36);
        const ta0 = document.getElementById('text-area');
        const db0 = document.getElementById('dialogue-box');
        if (ta0 && ta0.clientWidth > 80) maxWidthPx = ta0.clientWidth;
        else if (db0 && db0.clientWidth > 80) maxWidthPx = Math.max(200, db0.clientWidth - 36);

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return this.splitTextIntoPagesByMaxLines(raw, lp);
        ctx.font = `${fontPx}px "Microsoft YaHei","SimSun",sans-serif`;

        const wrapOneSegment = seg => {
            const out = [];
            let rem = seg;
            while (rem.length) {
                if (ctx.measureText(rem).width <= maxWidthPx) {
                    out.push(rem);
                    break;
                }
                let lo = 1;
                let hi = rem.length;
                let fit = 1;
                while (lo <= hi) {
                    const mid = (lo + hi) >> 1;
                    if (ctx.measureText(rem.slice(0, mid)).width <= maxWidthPx) {
                        fit = mid;
                        lo = mid + 1;
                    } else hi = mid - 1;
                }
                let cut = fit;
                if (fit < rem.length) {
                    const slice = rem.slice(0, fit);
                    const sp = Math.max(slice.lastIndexOf(' '), slice.lastIndexOf('\t'), slice.lastIndexOf('　'));
                    if (sp > Math.floor(fit * 0.35)) cut = sp + 1;
                }
                out.push(rem.slice(0, cut));
                rem = rem.slice(cut);
            }
            return out;
        };

        const visualLines = [];
        const blocks = raw.split('\n');
        for (let bi = 0; bi < blocks.length; bi++) {
            const seg = blocks[bi];
            if (seg === '') {
                visualLines.push('');
                continue;
            }
            wrapOneSegment(seg).forEach(line => visualLines.push(line));
        }

        const pages = [];
        for (let i = 0; i < visualLines.length; i += lp) {
            pages.push(visualLines.slice(i, i + lp).join('\n'));
        }
        return pages.length ? pages : [raw.trim()];
    },

    /** 随机展示旁白（兜底）：仅按换行分段后的「稿纸行」切块，不处理单行折行 */
    splitTextIntoPagesByMaxLines(text, maxLines) {
        const n = Math.max(1, Math.min(80, Math.floor(Number(maxLines)) || 6));
        const raw = String(text || '').replace(/\r\n/g, '\n');
        const lines = raw.split('\n');
        while (lines.length > 1 && String(lines[lines.length - 1] || '').trim() === '') {
            lines.pop();
        }
        const pages = [];
        for (let i = 0; i < lines.length; i += n) {
            pages.push(lines.slice(i, i + n).join('\n'));
        }
        return pages.length ? pages : [''];
    },

    cancelTypewriter() {
        if (this._typewriterTimerId != null) {
            clearTimeout(this._typewriterTimerId);
            this._typewriterTimerId = null;
        }
    },

    /**
     * 对白/旁白：仅使用项目级 typewriterMsPerChar（编辑器左侧「打字 ms/字」），不按步骤覆盖。
     * 其它步骤类型仍可读步骤上的 typewriterMsPerChar（如随机展示模块合成的旁白）。
     */
    _resolveTypewriterMsPerChar(step) {
        const story =
            typeof SceneManager !== 'undefined' && SceneManager.storyData ? SceneManager.storyData : null;
        let def = story && story.typewriterMsPerChar != null ? Number(story.typewriterMsPerChar) : 0;
        if (!Number.isFinite(def) || def < 0) def = 0;
        if (!step) return def;
        const t = step.type || '';
        if (step._rdUseModuleTypewriter) {
            const v = step.typewriterMsPerChar;
            if (v === null || v === undefined || v === '') return def;
            const n = Number(v);
            return Number.isFinite(n) && n >= 0 ? n : def;
        }
        if (t === 'dialogue' || t === 'narration') return def;
        const v = step.typewriterMsPerChar;
        if (v === null || v === undefined || v === '') return def;
        const n = Number(v);
        return Number.isFinite(n) && n >= 0 ? n : def;
    },

    /** 当前页尚未逐字播完时，第一次点击只瞬间铺满本页（不翻页、不进下一步） */
    consumeTypewriterSkipIfBusy() {
        if (this._typewriterPageDone) return false;
        this.finishTypewriterInstant();
        return true;
    },

    /** 立刻显示当前页全部文字并结束本页打字机动画 */
    finishTypewriterInstant() {
        this.cancelTypewriter();
        this._typewriterVisible = this._typewriterGraphemes.length;
        const textEl = document.getElementById('text-content');
        if (textEl) textEl.textContent = this._typewriterGraphemes.join('');
        this._typewriterPageDone = true;
    },

    _paintTypewriterSlice() {
        const textEl = document.getElementById('text-content');
        if (!textEl) return;
        const g = this._typewriterGraphemes;
        const n = Math.min(this._typewriterVisible, g.length);
        textEl.textContent = g.slice(0, n).join('');
    },

    _updatePageIndicator() {
        const pageEl = document.getElementById('page-indicator');
        if (!pageEl) return;
        if (this.pages.length > 1) {
            pageEl.removeAttribute('hidden');
            pageEl.textContent = `${this.currentPage + 1}/${this.pages.length}`;
        } else {
            pageEl.setAttribute('hidden', '');
            pageEl.textContent = '';
        }
    },

    _beginTypewriterForCurrentPage() {
        this.cancelTypewriter();
        const full = this.pages[this.currentPage] || '';
        this._typewriterGraphemes = Array.from(full);
        this._updatePageIndicator();
        const ms = this._resolveTypewriterMsPerChar(this._typewriterStepRef);
        if (ms <= 0 || !this._typewriterGraphemes.length) {
            this._typewriterVisible = this._typewriterGraphemes.length;
            this._paintTypewriterSlice();
            this._typewriterPageDone = true;
            return;
        }
        this._typewriterPageDone = false;
        this._typewriterVisible = 0;
        this._paintTypewriterSlice();
        const tick = () => {
            if (this._typewriterVisible >= this._typewriterGraphemes.length) {
                this._typewriterTimerId = null;
                this._typewriterPageDone = true;
                return;
            }
            this._typewriterVisible += 1;
            this._paintTypewriterSlice();
            this._typewriterTimerId = window.setTimeout(tick, ms);
        };
        this._typewriterTimerId = window.setTimeout(tick, ms);
    },

    showTextStep(scene, step, persistentCgStep = null) {
        this.cancelTypewriter();
        this._stepId = step && step.id ? step.id : '';
        this._typewriterStepRef = step || null;
        const nameEl = document.getElementById('char-name');
        const speakerName = this._resolveSpeakerName(scene, step);
        nameEl.textContent = speakerName || '';
        nameEl.style.display = speakerName ? 'block' : 'none';
        nameEl.style.fontWeight = step && step.type === 'narration' ? '700' : '';
        const story = typeof SceneManager !== 'undefined' ? SceneManager.storyData : null;
        const col =
            typeof normalizeSpeakerNameColor === 'function'
                ? normalizeSpeakerNameColor(story && story.speakerNameColor)
                : '#ffd700';
        nameEl.style.color = col;
        const projectData = story;
        const rawSp = (step && step.speakerRef) || (scene && scene.characterRef) || '';
        const speakerIdForCtx =
            typeof CharacterBinding !== 'undefined' && CharacterBinding.resolveSpeakerRefToCharacterId && projectData
                ? CharacterBinding.resolveSpeakerRefToCharacterId(rawSp, projectData)
                : rawSp;
        let finalText = GameState.parseText(step && step.text ? step.text : '', {
            speakerId: speakerIdForCtx || ''
        });
        finalText = this._applyNarrationParagraphIndent(finalText, step);
        const textEl = document.getElementById('text-content');
        const cuText = story && story.customUi && story.customUi.text;
        if (textEl) {
            if (step && step._rdNarrationFontPx != null) {
                const px = Math.max(8, Math.min(48, Math.floor(Number(step._rdNarrationFontPx)) || 16));
                textEl.style.fontSize = `${px}px`;
            } else if (cuText && cuText.fontSize != null) {
                textEl.style.fontSize = `${cuText.fontSize}px`;
            } else {
                textEl.style.fontSize = '';
            }
            if (step && step._rdNarrationColor) {
                textEl.style.color = String(step._rdNarrationColor);
            } else if (cuText && cuText.color) {
                textEl.style.color = cuText.color;
            } else {
                textEl.style.color = '';
            }
            if (cuText && cuText.lineHeight != null && !(step && step._rdNarrationFontPx != null)) {
                textEl.style.lineHeight = String(cuText.lineHeight);
            } else {
                textEl.style.lineHeight = '';
            }
        }
        const textArea = document.getElementById('text-area');
        if (textArea) {
            if (step && step._rdLinesPerPage != null) {
                const lp = Math.max(1, Math.min(80, Math.floor(Number(step._rdLinesPerPage)) || 6));
                const px = Math.max(8, Math.min(48, Math.floor(Number(step._rdNarrationFontPx)) || 16));
                const lineH = px * 1.6;
                textArea.style.height = `${Math.ceil(lineH * lp)}px`;
            } else if (
                typeof CustomUiConfig === 'undefined' ||
                !story ||
                !CustomUiConfig.hasDialogueSkin(story)
            ) {
                textArea.style.height = '';
            }
        }
        if (step && step._rdLinesPerPage != null) {
            this.pages = this.buildRdNarrationPagesByVisualLines(finalText, step);
        } else if (
            typeof CustomUiRuntime !== 'undefined' &&
            typeof CustomUiConfig !== 'undefined' &&
            story &&
            CustomUiConfig.hasDialogueSkin(story)
        ) {
            const lp = CustomUiRuntime.getLinesPerPageForDialogue(story);
            this.pages = this.splitTextIntoPagesByMaxLines(finalText, lp);
        } else {
            this.pages = this.splitTextIntoPagesBy3Lines(finalText);
        }
        this.currentPage = 0;
        this._beginTypewriterForCurrentPage();
        this._showDialogue(true);
        this._setDialogueDim(false);
        if (persistentCgStep && persistentCgStep.cg) {
            this._showCg(true, persistentCgStep, { reuseIfSameStep: true, skipFadeIn: true });
        } else {
            this._showCg(false);
        }
        const hideUnderCg =
            persistentCgStep && persistentCgStep.hideCharacter !== false;
        this._showCharacter(!hideUnderCg);
        this.syncCgCharacterOverStackClass();
    },

    showCgStep(step) {
        // CG：显示 story 图层，并按开关隐藏对话框/立绘
        this.cancelTypewriter();
        this._stepId = step && step.id ? step.id : '';
        this._typewriterStepRef = step || null;
        const nameEl = document.getElementById('char-name');
        if (nameEl) {
            nameEl.textContent = '';
            nameEl.style.display = 'none';
            nameEl.style.fontWeight = '';
        }
        const pageEl = document.getElementById('page-indicator');
        if (pageEl) {
            pageEl.setAttribute('hidden', '');
            pageEl.textContent = '';
        }
        const textEl = document.getElementById('text-content');
        if (textEl) {
            textEl.style.fontSize = '';
            textEl.style.color = '';
            textEl.textContent = '';
        }
        const textArea = document.getElementById('text-area');
        if (textArea) textArea.style.height = '';
        this._showCg(true, step);
        const finalText =
            typeof GameState !== 'undefined' && GameState.parseText
                ? GameState.parseText(step && step.text ? step.text : '', { speakerId: '' })
                : String((step && step.text) || '');
        const hasText = String(finalText || '').trim().length > 0;
        const mode = step && ['hidden', 'shown'].includes(step.cgDialogueMode) ? step.cgDialogueMode : 'auto';
        const showDlg = mode === 'shown' || (mode === 'auto' && hasText);
        if (showDlg) {
            this.pages = this.splitTextIntoPagesBy3Lines(finalText);
            this.currentPage = 0;
            this._beginTypewriterForCurrentPage();
        } else {
            this.pages = [''];
            this.currentPage = 0;
            this._typewriterGraphemes = [];
            this._typewriterVisible = 0;
            this._typewriterPageDone = true;
        }
        this._showDialogue(showDlg);
        this._setDialogueDim(showDlg);
        this._showCharacter(!(step && step.hideCharacter));
        this.syncCgCharacterOverStackClass();
    },

    _hasManualCgEntryFx(step) {
        const fx = step && step.stepFx;
        if (!step || step.type !== 'cg' || !fx || typeof fx !== 'object' || Number(fx.v) !== 2) return false;
        const family = String(fx.family || '').trim();
        const effect = String(fx.effect || '').trim();
        const entry = String(fx.romEntryEffect || '').trim();
        if (family === 'shock') return false;
        if (entry) return true;
        if (family === 'rom_entry' && (effect || entry)) return true;
        return false;
    },

    _getManualCgEntryMs(step) {
        const fx = step && step.stepFx;
        if (!fx || typeof fx !== 'object') return 1500;
        const sec = Number(fx.entrySec);
        if (Number.isFinite(sec) && sec >= 1 && sec <= 10) return Math.round(sec * 1000);
        return 1500;
    },

    _applyCgInitialVisibility(el, step) {
        if (!el) return;
        const waitForEntryFx = this._hasManualCgEntryFx(step);
        el.dataset.waitingManualEntryFx = waitForEntryFx ? '1' : '';
        if (waitForEntryFx) {
            el.style.opacity = '0';
            el.style.transition = '';
            window.setTimeout(() => {
                if (!el.isConnected || el.dataset.waitingManualEntryFx !== '1') return;
                const op = window.getComputedStyle ? window.getComputedStyle(el).opacity : el.style.opacity;
                if (String(op) === '0') {
                    el.style.opacity = '1';
                    el.style.transition = '';
                }
                el.dataset.waitingManualEntryFx = '';
            }, 180);
        } else {
            el.style.opacity = '1';
            el.style.transition = '';
        }
    },

    closeCgStep(opts = {}) {
        const ta = document.getElementById('text-area');
        const story = typeof SceneManager !== 'undefined' ? SceneManager.storyData : null;
        if (
            ta &&
            (typeof CustomUiConfig === 'undefined' || !story || !CustomUiConfig.hasDialogueSkin(story))
        ) {
            ta.style.height = '';
        }
        this._showCg(false);
        if (opts && opts.keepDialogueHidden) {
            this._showDialogue(false);
            this._setDialogueDim(false);
        } else {
            this._showDialogue(true);
            this._setDialogueDim(false);
        }
        if (!(opts && opts.keepCharacterHidden)) this._showCharacter(true);
        this.syncCgCharacterOverStackClass();
    },

    /** CG 退出：暂停 layer-story 上的视频（循环/中途退出时一点即停画） */
    pauseLayerStoryMediaForCgExit() {
        const storyLayer = document.getElementById('layer-story');
        if (!storyLayer) return;
        const v = storyLayer.querySelector('video');
        if (v) {
            try {
                v.pause();
            } catch {}
        }
    },

    showChoiceStep(step) {
        this.cancelTypewriter();
        this._stepId = step && step.id ? step.id : '';
        this._typewriterStepRef = null;
        const pageEl = document.getElementById('page-indicator');
        if (pageEl) {
            pageEl.setAttribute('hidden', '');
            pageEl.textContent = '';
        }
        const nameEl = document.getElementById('char-name');
        if (nameEl) {
            nameEl.textContent = '';
            nameEl.style.display = 'none';
        }
        const textEl = document.getElementById('text-content');
        if (textEl) {
            textEl.textContent = '';
            textEl.style.fontSize = '';
            textEl.style.color = '';
        }
        const textArea = document.getElementById('text-area');
        if (textArea) textArea.style.height = '';
        this.pages = [''];
        this.currentPage = 0;
        this._typewriterGraphemes = [];
        this._typewriterVisible = 0;
        this._typewriterPageDone = true;
        this._showDialogue(false);
        this._setDialogueDim(false);
        this.syncPersistentCgOverlayFromSession();
        const activeCg = typeof SceneManager !== 'undefined' && SceneManager.getActiveCgOverlayStep
            ? SceneManager.getActiveCgOverlayStep()
            : null;
        if (
            !(
                typeof SceneManager !== 'undefined' &&
                activeCg &&
                activeCg.cg
            )
        ) {
            this._showCg(false);
        }
        const hideCharUnderCg =
            activeCg && activeCg.hideCharacter !== false;
        this._showCharacter(!hideCharUnderCg);
        this.syncCgCharacterOverStackClass();
        this.showOptions((step && step.options) || [], step);
    },

    _resolveSpeakerName(scene, step) {
        if (step && step.type === 'narration') return '';
        const raw = (step && step.speakerRef) || (scene && scene.characterRef) || '';
        if (!raw) return (scene && scene.characterName) || '';
        const roster = SceneManager && SceneManager.storyData ? SceneManager.storyData.characterRoster || [] : [];
        const projectData = SceneManager && SceneManager.storyData ? SceneManager.storyData : null;
        const ref =
            typeof CharacterBinding !== 'undefined' && CharacterBinding.resolveSpeakerRefToCharacterId && projectData
                ? CharacterBinding.resolveSpeakerRefToCharacterId(raw, projectData)
                : raw;
        const c = roster.find(x => x.id === ref);
        return c && c.name ? c.name : '';
    },

    _showDialogue(show) {
        const layer = document.getElementById('layer-dialogue');
        if (layer) layer.style.display = show ? 'flex' : 'none';
    },

    _setDialogueDim(dim) {
        const box = document.getElementById('dialogue-box');
        if (!box) return;
        box.classList.toggle('dialogue-dim', !!dim);
    },

    _showCharacter(show) {
        const layer = document.getElementById('layer-char');
        if (layer) layer.style.display = show ? 'flex' : 'none';
    },

    /**
     * CG 会话仍有效、且源步为「显示时保留立绘」、且 layer-story 上仍有 CG 媒体时：
     * 为 #game-canvas 加上类，使立绘 z-index 高于 CG（默认 #layer-story 在 #layer-char 之上会挡住立绘）。
     */
    syncCgCharacterOverStackClass() {
        const root = document.getElementById('game-canvas');
        if (!root) return;
        const sm = typeof SceneManager !== 'undefined' ? SceneManager : null;
        const sess = sm && sm._cgSession;
        const storyEl = document.getElementById('layer-story');
        const storyShown =
            !!(storyEl && storyEl.style.display !== 'none' && storyEl.querySelector('img,video'));
        const retainChar =
            !!(sess && sess.visualActive && !sess.visualClosing && sess.sourceStep && sess.sourceStep.hideCharacter === false);
        root.classList.toggle('game-canvas--cg-char-over', !!(storyShown && retainChar));
    },

    _showCg(show, step = null, opts = {}) {
        const storyLayer = document.getElementById('layer-story');
        if (!storyLayer) return;
        if (!show) {
            const v = storyLayer.querySelector('video');
            if (v) {
                try { v.pause(); } catch {}
            }
            storyLayer.removeAttribute('data-cg-step-id');
            storyLayer.classList.remove('cg-crossfade-active');
            storyLayer.querySelectorAll('[data-cg-crossfade-old="1"]').forEach(n => n.remove());
            storyLayer.style.display = 'none';
            return;
        }
        storyLayer.style.display = 'flex';
        const reuse =
            opts.reuseIfSameStep &&
            step &&
            step.id &&
            storyLayer.dataset.cgStepId === step.id &&
            storyLayer.querySelector('img, video');
        if (reuse) {
            const el = storyLayer.querySelector('img,video');
            if (el) {
                try {
                    el.dataset.waitingManualEntryFx = '';
                    el.style.opacity = '1';
                    el.style.transition = '';
                } catch {}
                if (el.tagName === 'VIDEO') {
                    try {
                        el.play();
                    } catch {}
                }
            }
            storyLayer.style.display = 'flex';
            return;
        }
        // renderer.js 会渲染 scene.storyGraphic；这里补一个 step.cg 的显示入口（后续会统一走 Renderer）
        if (step && step.cg) {
            const oldMedia = storyLayer.style.display !== 'none'
                ? storyLayer.querySelector('img,video')
                : null;
            const keepOldBehindNew =
                !!(
                    oldMedia &&
                    step &&
                    step.type === 'cg' &&
                    this._hasManualCgEntryFx(step) &&
                    storyLayer.dataset.cgStepId &&
                    storyLayer.dataset.cgStepId !== step.id
                );
            if (keepOldBehindNew) {
                Array.from(storyLayer.children).forEach(child => {
                    if (child !== oldMedia) child.remove();
                });
                oldMedia.dataset.cgCrossfadeOld = '1';
                oldMedia.classList.add('cg-crossfade-old');
                oldMedia.classList.remove('cg-crossfade-new');
                storyLayer.classList.add('cg-crossfade-active');
            } else {
                storyLayer.classList.remove('cg-crossfade-active');
                storyLayer.innerHTML = '';
            }
            const sg = step.cg || {};
            let src = sg.embeddedDataUrl || null;
            if (!src && sg.url) {
                src =
                    typeof AssetManager !== 'undefined' && AssetManager.resolveMediaUrl
                        ? AssetManager.resolveMediaUrl('storyGraphics', sg.url)
                        : typeof AssetManager !== 'undefined' && AssetManager.getPath
                          ? AssetManager.getPath('storyGraphics', sg.url) || sg.url
                          : sg.url;
            }
            if (!src) {
                storyLayer.style.display = 'none';
                return;
            }
            const applyProjectSrc = el => {
                if (sg.url && typeof AssetManager !== 'undefined' && AssetManager.resolveProjectAssetUrl) {
                    AssetManager.resolveProjectAssetUrl('storyGraphics', sg.url).then(url => {
                        if (url && el && el.parentNode) el.src = url;
                    });
                }
            };
            const srcStr = String(src);
            const byExt = /\.(mp4|webm|ogg)(\?|#|$)/i.test(srcStr);
            const mediaType =
                sg.mediaType || (srcStr.startsWith('data:video') || byExt ? 'video' : 'image');
            if (mediaType === 'video') {
                const v = document.createElement('video');
                v.src = src;
                applyProjectSrc(v);
                v.autoplay = true;
                v.muted = true;
                v.playsInline = true;
                v.loop = !!(step && step.cgLoop);
                v.controls = false;
                if (!(step && step.cgLoop)) {
                    v.addEventListener('ended', () => {
                        try {
                            if (v.duration && !Number.isNaN(v.duration)) {
                                v.pause();
                                v.currentTime = Math.max(0, v.duration - 0.05);
                            }
                        } catch {}
                    });
                }
                if (keepOldBehindNew) {
                    v.classList.add('cg-crossfade-new');
                    storyLayer.insertBefore(v, oldMedia);
                } else {
                    storyLayer.appendChild(v);
                }
            } else {
                const img = new Image();
                img.src = src;
                applyProjectSrc(img);
                if (keepOldBehindNew) {
                    img.classList.add('cg-crossfade-new');
                    storyLayer.insertBefore(img, oldMedia);
                } else {
                    storyLayer.appendChild(img);
                }
            }
            if (step && step.id) storyLayer.dataset.cgStepId = step.id;
            const mediaEl = storyLayer.querySelector('img,video');
            if (mediaEl && (opts.skipFadeIn || step.type !== 'cg')) {
                try {
                    mediaEl.style.opacity = '1';
                    mediaEl.style.transition = '';
                } catch {}
            }
            if (step && step.type === 'cg') {
                const el = storyLayer.querySelector('img,video');
                if (el) {
                    this._applyCgInitialVisibility(el, step);
                }
            }
            if (keepOldBehindNew && oldMedia) {
                const cleanupDelay = this._getManualCgEntryMs(step) + 350;
                window.setTimeout(() => {
                    if (!oldMedia.isConnected || oldMedia.dataset.cgCrossfadeOld !== '1') return;
                    oldMedia.remove();
                    if (!storyLayer.querySelector('[data-cg-crossfade-old="1"]')) {
                        storyLayer.classList.remove('cg-crossfade-active');
                    }
                }, cleanupDelay);
            }
        }
    },

    showGraphicReadingImage(alias, transition = 'fade', durationMs = 1000) {
        const storyLayer = document.getElementById('layer-story');
        if (!storyLayer) return;
        const src =
            typeof AssetManager !== 'undefined' && AssetManager.resolveMediaUrl
                ? AssetManager.resolveMediaUrl('storyGraphics', alias) || alias
                : typeof AssetManager !== 'undefined' && AssetManager.getPath
                  ? AssetManager.getPath('storyGraphics', alias) || alias
                  : alias;
        if (!src) return;
        storyLayer.style.display = 'flex';
        storyLayer.classList.add('graphic-reading-story-layer');
        const oldEls = Array.from(storyLayer.querySelectorAll('.graphic-reading-slide'));
        if (!oldEls.length) storyLayer.innerHTML = '';
        const img = new Image();
        img.className = `graphic-reading-slide graphic-reading-slide--${transition || 'fade'}`;
        img.src = src;
        if (typeof AssetManager !== 'undefined' && AssetManager.resolveProjectAssetUrl) {
            AssetManager.resolveProjectAssetUrl('storyGraphics', alias).then(url => {
                if (url && img.parentNode) img.src = url;
            });
        }
        img.style.setProperty('--gr-dur', `${Math.max(100, Number(durationMs) || 1000)}ms`);
        storyLayer.appendChild(img);
        requestAnimationFrame(() => img.classList.add('graphic-reading-slide--active'));
        window.setTimeout(() => {
            oldEls.forEach(el => {
                try { el.remove(); } catch {}
            });
        }, Math.max(150, Number(durationMs) || 1000) + 80);
    },

    closeGraphicReading() {
        const storyLayer = document.getElementById('layer-story');
        if (storyLayer) {
            storyLayer.classList.remove('graphic-reading-story-layer');
            storyLayer.querySelectorAll('.graphic-reading-slide').forEach(el => el.remove());
            storyLayer.style.display = 'none';
        }
        const ta = document.getElementById('text-area');
        if (ta) ta.style.height = '';
        this._showDialogue(false);
        this._setDialogueDim(false);
        this._showCharacter(true);
        this.syncCgCharacterOverStackClass();
    },

    /**
     * 若 SceneManager 仍持有「跨步 CG 会话」且画面应延续，则强制同步 layer-story（含淡出后 opacity 复位、DOM 被清后重建）。
     * 供问答/选项等弹出层使用，避免无场景底图时只剩黑幕。
     */
    syncPersistentCgOverlayFromSession() {
        const sm = typeof SceneManager !== 'undefined' ? SceneManager : null;
        const sess = sm && sm._cgSession;
        if (!sess || !sess.visualActive || sess.visualClosing || !sess.sourceStep || !sess.sourceStep.cg) return;
        this._showCg(true, sess.sourceStep, { reuseIfSameStep: true, skipFadeIn: true });
        this.syncCgCharacterOverStackClass();
    },

    /**
     * CG 步点击结束：若有淡出时长则先播完再回调，返回 true 表示已接管；否则返回 false 由调用方立即推进。
     * @param {object} step
     * @param {() => void} onDone
     */
    beginCgStepExit(step, onDone) {
        const storyLayer = document.getElementById('layer-story');
        if (!storyLayer || storyLayer.style.display === 'none' || typeof onDone !== 'function') return false;
        const el = storyLayer.querySelector('img,video');
        if (el) {
            try {
                el.style.opacity = '1';
                el.style.transition = '';
            } catch {}
        }
        return false;
    },

    /** 取消动画并整页显示（内部用） */
    refreshText() {
        this.cancelTypewriter();
        const full = this.pages[this.currentPage] || '';
        this._typewriterGraphemes = Array.from(full);
        this._typewriterVisible = this._typewriterGraphemes.length;
        this._typewriterPageDone = true;
        const textEl = document.getElementById('text-content');
        if (textEl) textEl.textContent = full;
        this._updatePageIndicator();
    },

    isAtEndOfStep() {
        return this.currentPage >= this.pages.length - 1 && this._typewriterPageDone;
    },

    jumpToEndOfStep() {
        this.cancelTypewriter();
        this.currentPage = Math.max(0, this.pages.length - 1);
        const full = this.pages[this.currentPage] || '';
        this._typewriterGraphemes = Array.from(full);
        this._typewriterVisible = this._typewriterGraphemes.length;
        this._typewriterPageDone = true;
        const textEl = document.getElementById('text-content');
        if (textEl) textEl.textContent = full;
        this._updatePageIndicator();
    },

    nextPage() {
        if (this.currentPage < this.pages.length - 1) {
            this.cancelTypewriter();
            this.currentPage++;
            this._beginTypewriterForCurrentPage();
        }
    },

    prevPage() {
        if (this.currentPage > 0) {
            this.cancelTypewriter();
            this.currentPage--;
            this._beginTypewriterForCurrentPage();
        }
    },

    // 显示选项（choice step）
    showOptions(options, step = null) {
        this.finishTypewriterInstant();
        const layer = document.getElementById('layer-options');
        const container = document.getElementById('options-container');
        container.innerHTML = '';

        const list = Array.isArray(options) ? options : [];
        const showQuestionForFailedCondition = !!(step && step.showQuestionForFailedCondition);
        list.forEach((opt, oi) => {
            let conditionFailed = false;
            if (opt && typeof SceneManager !== 'undefined' && SceneManager.evalCondition) {
                const cond = opt.condition;
                const hasSavedCondition =
                    cond &&
                    typeof cond === 'object' &&
                    ((Array.isArray(cond.and) && cond.and.filter(Boolean).length > 0) ||
                        !!cond.type ||
                        (Array.isArray(cond.or) && cond.or.filter(Boolean).length > 0));
                if (hasSavedCondition && !SceneManager.evalCondition(cond)) {
                    conditionFailed = true;
                    if (!showQuestionForFailedCondition) return;
                }
            }
            if (
                step &&
                step.hideIfJumpTargetSeen &&
                typeof SceneManager !== 'undefined' &&
                SceneManager.isJumpTargetAlreadyAppeared &&
                SceneManager.isJumpTargetAlreadyAppeared(opt && opt.next)
            ) {
                return;
            }
            if (
                step &&
                step.filterBySpeakerExist &&
                typeof SceneManager !== 'undefined' &&
                SceneManager.choiceOptionPassesSpeakerExist &&
                !SceneManager.choiceOptionPassesSpeakerExist(opt)
            ) {
                return;
            }
            if (
                typeof SceneManager !== 'undefined' &&
                SceneManager.choiceOrRandomNextIsAvailable &&
                !SceneManager.choiceOrRandomNextIsAvailable(opt && opt.next, step)
            ) {
                return;
            }
            const btn = document.createElement('button');
            btn.className = 'option-btn';
            if (conditionFailed && showQuestionForFailedCondition) {
                btn.classList.add('is-locked-question');
                btn.textContent = '？';
                btn.disabled = true;
                btn.setAttribute('aria-disabled', 'true');
                container.appendChild(btn);
                return;
            }
            btn.innerText =
                typeof GameState !== 'undefined' && GameState.parseText
                    ? GameState.parseText(opt.text || '', { speakerId: '' })
                    : opt.text;
            btn.onclick = () => {
                if (typeof SceneManager !== 'undefined' && step && SceneManager.recordReuseEntryOutcome) {
                    const rk = SceneManager.resolveChoiceOptionReuseEntryKey(opt, oi, step);
                    SceneManager.recordReuseEntryOutcome(step.id, rk);
                }
                if (opt && typeof opt.onChoose === 'function') {
                    opt.onChoose(opt);
                    return;
                }
                this.hideOptions();
                if (typeof StoryEffects !== 'undefined' && StoryEffects.stopLoopingStepSound) {
                    StoryEffects.stopLoopingStepSound();
                }
                if (
                    SceneManager &&
                    SceneManager.applyReuseExitOnChoice &&
                    step &&
                    SceneManager.currentSceneId != null
                ) {
                    SceneManager.applyReuseExitOnChoice(SceneManager.currentSceneId, step, oi, opt);
                }
                if (SceneManager && SceneManager.writeJumpSlotFromSceneNext && step) {
                    const slotId =
                        typeof SceneManager.getEffectiveJumpSlotIdForStep === 'function'
                            ? SceneManager.getEffectiveJumpSlotIdForStep(
                                  SceneManager.storyData,
                                  SceneManager.currentSceneId,
                                  step
                              )
                            : step.choiceJumpSlotId && String(step.choiceJumpSlotId).trim();
                    const slotNext =
                        typeof SceneManager.getJumpSlotNextForChoiceOption === 'function'
                            ? SceneManager.getJumpSlotNextForChoiceOption(opt, step)
                            : null;
                    if (slotId && slotNext) {
                        SceneManager.writeJumpSlotFromSceneNext(
                            SceneManager.storyData,
                            String(slotId).trim(),
                            slotNext
                        );
                    }
                }
                if (SceneManager && typeof SceneManager.writeChoicePickNamedVars === 'function') {
                    SceneManager.writeChoicePickNamedVars(step, opt);
                }
                if (opt && Array.isArray(opt.weightAdjustments) && typeof GameState !== 'undefined' && GameState.applyWeightAdjustments) {
                    GameState.applyWeightAdjustments(opt.weightAdjustments);
                }
                if (opt && Array.isArray(opt.effects) && typeof GameState !== 'undefined' && GameState.applyEffects) {
                    GameState.applyEffects(opt.effects);
                }
                if (
                    SceneManager &&
                    typeof SceneManager.maybeTriggerAutoJump === 'function' &&
                    SceneManager.maybeTriggerAutoJump('choice-option-effects')
                ) {
                    return;
                }
                if (SceneManager && SceneManager.applyNext) {
                    SceneManager.applyNext(opt.next);
                }
            };
            container.appendChild(btn);
        });
        if (!container.childElementCount) {
            const btn = document.createElement('button');
            btn.className = 'option-btn';
            btn.textContent = '（无可用选项：条件 / 出现 / 存在 筛除，点此跳过本步）';
            btn.onclick = () => {
                this.hideOptions();
                if (typeof StoryEffects !== 'undefined' && StoryEffects.stopLoopingStepSound) {
                    StoryEffects.stopLoopingStepSound();
                }
                if (typeof SceneManager !== 'undefined' && SceneManager.advanceStep) {
                    SceneManager.advanceStep();
                }
            };
            container.appendChild(btn);
        }
        layer.style.display = 'flex';
        this.syncPersistentCgOverlayFromSession();
    },

    hideOptions() {
        document.getElementById('layer-options').style.display = 'none';
    },

    /** 随机展示 · 屏幕文案层（非对话框） */
    _galleryState: null,

    _galleryText(key) {
        const dict = {
            gallery: '\u957f\u5eca',
            back: '\u8fd4\u56de',
            close: '\u5173\u95ed',
            empty: '\u8fd8\u6ca1\u6709\u53ef\u663e\u793a\u7684\u5185\u5bb9\u3002',
            locked: '???',
            previous: '\u4e0a\u4e00\u9875',
            next: '\u4e0b\u4e00\u9875',
            count: '\u5171 {n} \u4e2a'
        };
        return dict[key] || key;
    },

    showGalleryModule(moduleId, opts = {}) {
        const layer = document.getElementById('layer-owned-gallery');
        const project = typeof SceneManager !== 'undefined' && SceneManager.storyData ? SceneManager.storyData : null;
        const onReturn = opts && typeof opts.onReturn === 'function' ? opts.onReturn : null;
        const galleryApi =
            typeof GalleryConfig !== 'undefined'
                ? GalleryConfig
                : typeof window !== 'undefined' && window.GalleryConfig
                  ? window.GalleryConfig
                  : null;
        if (!layer || !project || !galleryApi) {
            this._showGalleryFallback(layer, onReturn, '长廊暂时没有加载成功，请返回后重试。');
            return false;
        }
        const module = galleryApi.findModule(project, moduleId);
        if (!module) {
            this._showGalleryFallback(layer, onReturn, '没有找到这个长廊。');
            return false;
        }
        let items = [];
        try {
            items = galleryApi.listItems(project, module);
        } catch (err) {
            if (typeof console !== 'undefined' && console.warn) console.warn('[Gallery] 长廊内容生成失败', err);
            this._showGalleryFallback(layer, onReturn, '长廊内容生成失败，请返回后重试。');
            return false;
        }
        if (module.kind === 'endingCg' && module.endingCg && module.endingCg.showUnknown === false) {
            items = items.filter(item => item && !item.locked);
        }
        this._galleryState = {
            module,
            items,
            pageIndex: 0,
            onReturn
        };
        layer.style.display = 'block';
        layer.setAttribute('aria-hidden', 'false');
        this._renderGalleryModule();
        return true;
    },

    _showGalleryFallback(layer, onReturn, text) {
        if (!layer) {
            if (typeof onReturn === 'function') onReturn();
            return;
        }
        this._galleryState = {
            module: { name: this._galleryText('gallery'), kind: 'character', pageSize: 1 },
            items: [],
            pageIndex: 0,
            onReturn: typeof onReturn === 'function' ? onReturn : null
        };
        layer.innerHTML = '';
        layer.style.display = 'block';
        layer.setAttribute('aria-hidden', 'false');
        const panel = document.createElement('div');
        panel.className = 'owned-gallery-panel';
        const head = document.createElement('div');
        head.className = 'owned-gallery-head';
        const titleBox = document.createElement('div');
        const h = document.createElement('div');
        h.className = 'owned-gallery-title';
        h.textContent = this._galleryText('gallery');
        titleBox.appendChild(h);
        const backBtn = document.createElement('button');
        backBtn.type = 'button';
        backBtn.className = 'owned-gallery-return';
        backBtn.textContent = this._galleryText('back');
        backBtn.onclick = () => this.closeGalleryModule(true);
        head.appendChild(titleBox);
        head.appendChild(backBtn);
        const empty = document.createElement('div');
        empty.className = 'owned-gallery-empty';
        empty.textContent = text || this._galleryText('empty');
        panel.appendChild(head);
        panel.appendChild(empty);
        layer.appendChild(panel);
    },

    _renderGalleryModule() {
        const layer = document.getElementById('layer-owned-gallery');
        const state = this._galleryState;
        if (!layer || !state || !state.module) return;
        const module = state.module;
        const pageSize = module.kind === 'character' ? 10 : 6;
        const totalPages = Math.max(1, Math.ceil(state.items.length / pageSize));
        state.pageIndex = Math.min(Math.max(0, state.pageIndex || 0), totalPages - 1);
        const pageItems = state.items.slice(state.pageIndex * pageSize, state.pageIndex * pageSize + pageSize);
        layer.innerHTML = '';

        const panel = document.createElement('div');
        panel.className = 'owned-gallery-panel';
        panel.dataset.kind = module.kind;
        const head = document.createElement('div');
        head.className = 'owned-gallery-head';
        const titleBox = document.createElement('div');
        const h = document.createElement('div');
        h.className = 'owned-gallery-title';
        h.textContent = module.name || this._galleryText('gallery');
        const count = document.createElement('div');
        count.className = 'owned-gallery-count';
        count.textContent = this._galleryText('count').replace('{n}', String(state.items.length));
        titleBox.appendChild(h);
        titleBox.appendChild(count);
        const backBtn = document.createElement('button');
        backBtn.type = 'button';
        backBtn.className = 'owned-gallery-return';
        backBtn.textContent = this._galleryText('back');
        backBtn.onclick = () => this.closeGalleryModule(true);
        head.appendChild(titleBox);
        head.appendChild(backBtn);
        panel.appendChild(head);

        const grid = document.createElement('div');
        grid.className = `owned-gallery-grid owned-gallery-grid--${module.kind === 'endingCg' ? 'cg' : 'character'}`;
        if (!state.items.length) {
            const empty = document.createElement('div');
            empty.className = 'owned-gallery-empty';
            empty.textContent = this._galleryText('empty');
            grid.appendChild(empty);
        } else {
            pageItems.forEach(item => grid.appendChild(this._makeGalleryCard(item, module)));
        }
        panel.appendChild(grid);

        const foot = document.createElement('div');
        foot.className = 'owned-gallery-footer';
        const prev = document.createElement('button');
        prev.type = 'button';
        prev.className = 'owned-gallery-page-btn';
        prev.textContent = this._galleryText('previous');
        prev.disabled = state.pageIndex <= 0;
        prev.onclick = () => {
            state.pageIndex -= 1;
            this._renderGalleryModule();
        };
        const page = document.createElement('div');
        page.className = 'owned-gallery-page';
        page.textContent = `${state.pageIndex + 1} / ${totalPages}`;
        const next = document.createElement('button');
        next.type = 'button';
        next.className = 'owned-gallery-page-btn';
        next.textContent = this._galleryText('next');
        next.disabled = state.pageIndex >= totalPages - 1;
        next.onclick = () => {
            state.pageIndex += 1;
            this._renderGalleryModule();
        };
        foot.appendChild(prev);
        foot.appendChild(page);
        foot.appendChild(next);
        panel.appendChild(foot);
        layer.appendChild(panel);
    },

    _makeGalleryCard(item, module) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'owned-gallery-card';
        const portrait = document.createElement('div');
        portrait.className = 'owned-gallery-portrait';
        const name = document.createElement('div');
        name.className = 'owned-gallery-name';
        if (!item || item.locked) {
            card.classList.add('owned-gallery-card--locked');
            card.disabled = true;
            const ph = document.createElement('div');
            ph.className = 'owned-gallery-placeholder';
            ph.textContent = this._galleryText('locked');
            portrait.appendChild(ph);
            name.textContent = this._galleryText('locked');
        } else {
            this._appendGalleryMedia(portrait, item, false);
            name.textContent = item.title || '';
            card.onclick = () => this._openGalleryPreview(item, module);
        }
        card.appendChild(portrait);
        card.appendChild(name);
        return card;
    },

    _appendGalleryMedia(parent, item, controls) {
        const src = item && item.src ? String(item.src) : '';
        if (!src) {
            const ph = document.createElement('div');
            ph.className = 'owned-gallery-placeholder';
            ph.textContent = '?';
            parent.appendChild(ph);
            return;
        }
        const isVideo =
            item.mediaType === 'video' ||
            (typeof AssetManager !== 'undefined' && AssetManager.isVideoLikeMediaUrl && AssetManager.isVideoLikeMediaUrl(src)) ||
            /\.(mp4|webm|ogg)(\?|#|$)/i.test(src);
        if (isVideo) {
            const video = document.createElement('video');
            video.src = src;
            video.muted = true;
            video.loop = true;
            video.playsInline = true;
            video.controls = !!controls;
            video.autoplay = !controls;
            parent.appendChild(video);
            if (!controls) {
                try { video.play(); } catch {}
            }
            return;
        }
        const img = document.createElement('img');
        img.alt = item.title || '';
        img.src = src;
        parent.appendChild(img);
    },

    _openGalleryPreview(item, module) {
        const layer = document.getElementById('layer-owned-gallery');
        if (!layer || !item || item.locked) return;
        if (
            item.playbackKind === 'randomDisplay' &&
            item.rdItem &&
            item.rdModule &&
            typeof SceneManager !== 'undefined' &&
            SceneManager.startGalleryRandomDisplayPreview
        ) {
            if (SceneManager.startGalleryRandomDisplayPreview(item.rdModule, item.rdItem)) {
                if (SceneManager._randomDisplaySession) {
                    SceneManager._randomDisplaySession.onReturnToGrid = () => this._renderGalleryModule();
                }
                return;
            }
        }
        layer.innerHTML = '';
        const panel = document.createElement('div');
        panel.className = 'owned-gallery-preview';
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'owned-gallery-preview-close';
        close.textContent = this._galleryText('close');
        close.onclick = () => this._renderGalleryModule();
        const media = document.createElement('div');
        media.className = `owned-gallery-preview-media owned-gallery-preview-media--${module.kind === 'endingCg' ? 'cg' : 'character'}`;
        this._appendGalleryMedia(media, item, true);
        const title = document.createElement('div');
        title.className = 'owned-gallery-preview-title';
        title.textContent = item.title || '';
        panel.appendChild(close);
        panel.appendChild(media);
        panel.appendChild(title);
        layer.appendChild(panel);
    },

    closeGalleryModule(callReturn = true) {
        const layer = document.getElementById('layer-owned-gallery');
        const cb = this._galleryState && this._galleryState.onReturn;
        this._galleryState = null;
        if (layer) {
            layer.innerHTML = '';
            layer.style.display = 'none';
            layer.setAttribute('aria-hidden', 'true');
        }
        if (callReturn && typeof cb === 'function') cb();
    },

    _ownedGalleryOnClose: null,

    _ownedGalleryAttributeKeys(step = null) {
        const raw = step && (step.ownedGalleryAttributeKey || step.ownedAttributeKey || step.galleryAttributeKey);
        const configured = String(raw || '').trim();
        if (configured) return [configured];
        return ['玩家拥有', '拥有', '已拥有', '解锁', '已解锁'];
    },

    _isOwnedGalleryTruthy(value) {
        if (value === true) return true;
        if (typeof value === 'number') return value === 1;
        const s = String(value == null ? '' : value).trim().toLowerCase();
        return ['1', 'true', 'yes', 'y', 'on', '是', '有', '拥有', '已拥有', '解锁', '已解锁'].includes(s);
    },

    _characterGallerySpriteUrl(ch) {
        if (!ch || !ch.expressions) return '';
        const keys = Object.keys(ch.expressions).filter(k => !String(k).startsWith('__pending_'));
        const key =
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

    _listOwnedGalleryCharacters(step = null) {
        const project = typeof SceneManager !== 'undefined' && SceneManager.storyData ? SceneManager.storyData : null;
        const roster = project && Array.isArray(project.characterRoster) ? project.characterRoster : [];
        const keys = this._ownedGalleryAttributeKeys(step);
        return roster.filter(ch => {
            if (!ch || !ch.id) return false;
            const state = typeof GameState !== 'undefined' && GameState.characters ? GameState.characters[ch.id] : null;
            const unified = state && state.unified ? state.unified : {};
            return keys.some(key => this._isOwnedGalleryTruthy(unified[key]));
        });
    },

    showOwnedGallery(step = null, onClose = null) {
        const layer = document.getElementById('layer-owned-gallery');
        if (!layer) return;
        this._ownedGalleryOnClose = typeof onClose === 'function' ? onClose : null;
        const title = String((step && step.ownedGalleryTitle) || (step && step.galleryTitle) || '角色长廊');
        const emptyText = String(
            (step && step.ownedGalleryEmptyText) ||
                '还没有已拥有的人物。\n等剧情把人物的“玩家拥有”属性设为“是”后，这里就会亮起来。'
        );
        const chars = this._listOwnedGalleryCharacters(step);
        layer.innerHTML = '';

        const panel = document.createElement('div');
        panel.className = 'owned-gallery-panel';
        const head = document.createElement('div');
        head.className = 'owned-gallery-head';
        const titleBox = document.createElement('div');
        const h = document.createElement('div');
        h.className = 'owned-gallery-title';
        h.textContent = title;
        const count = document.createElement('div');
        count.className = 'owned-gallery-count';
        count.textContent = `已拥有 ${chars.length} 人`;
        titleBox.appendChild(h);
        titleBox.appendChild(count);
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'owned-gallery-close';
        closeBtn.setAttribute('aria-label', '关闭角色长廊');
        closeBtn.textContent = '×';
        closeBtn.onclick = () => this.closeOwnedGallery();
        head.appendChild(titleBox);
        head.appendChild(closeBtn);
        panel.appendChild(head);

        if (!chars.length) {
            const empty = document.createElement('div');
            empty.className = 'owned-gallery-empty';
            empty.textContent = emptyText;
            panel.appendChild(empty);
        } else {
            const grid = document.createElement('div');
            grid.className = 'owned-gallery-grid';
            chars.forEach(ch => {
                const card = document.createElement('div');
                card.className = 'owned-gallery-card';
                const portrait = document.createElement('div');
                portrait.className = 'owned-gallery-portrait';
                const src = this._characterGallerySpriteUrl(ch);
                if (src && !(typeof AssetManager !== 'undefined' && AssetManager.isVideoLikeMediaUrl && AssetManager.isVideoLikeMediaUrl(src))) {
                    const img = document.createElement('img');
                    img.alt = ch.name || ch.id;
                    img.src = src;
                    portrait.appendChild(img);
                } else {
                    const ph = document.createElement('div');
                    ph.className = 'owned-gallery-placeholder';
                    ph.textContent = (String(ch.name || ch.id || '?').trim()[0] || '?').toUpperCase();
                    portrait.appendChild(ph);
                }
                const name = document.createElement('div');
                name.className = 'owned-gallery-name';
                name.textContent = ch.name || ch.id;
                card.appendChild(portrait);
                card.appendChild(name);
                grid.appendChild(card);
            });
            panel.appendChild(grid);
        }

        layer.appendChild(panel);
        layer.style.display = 'block';
        layer.setAttribute('aria-hidden', 'false');
    },

    closeOwnedGallery() {
        const layer = document.getElementById('layer-owned-gallery');
        if (layer) {
            layer.style.display = 'none';
            layer.setAttribute('aria-hidden', 'true');
        }
        const cb = this._ownedGalleryOnClose;
        this._ownedGalleryOnClose = null;
        if (typeof cb === 'function') cb();
    },

    _rdCopy: null,

    endRandomDisplayCopy(opts = {}) {
        if (this._rdCopy && this._rdCopy.timer) {
            clearTimeout(this._rdCopy.timer);
        }
        this._rdCopy = null;
        if (!(opts && opts.keepDialogueHidden) && typeof this._showDialogue === 'function') this._showDialogue(true);
        const layer = document.getElementById('layer-rd-copy');
        if (layer) {
            layer.style.display = 'none';
            const inner = layer.querySelector('#rd-copy-text');
            if (inner) inner.textContent = '';
        }
    },

    startRandomDisplayCopy(module, pages, onDone) {
        this.endRandomDisplayCopy({ keepDialogueHidden: true });
        const layer = document.getElementById('layer-rd-copy');
        if (!layer || !pages || !pages.length) {
            if (typeof onDone === 'function') onDone();
            return;
        }
        let inner = layer.querySelector('#rd-copy-text');
        if (!inner) {
            inner = document.createElement('div');
            inner.id = 'rd-copy-text';
            layer.innerHTML = '';
            layer.appendChild(inner);
        }
        if (typeof this._showDialogue === 'function') this._showDialogue(false);
        layer.style.display = 'flex';
        layer.style.pointerEvents = 'auto';
        layer.style.alignItems = 'flex-start';
        layer.style.justifyContent =
            module.copyRegion === 'left' ? 'flex-start' : module.copyRegion === 'right' ? 'flex-end' : 'center';
        inner.style.maxWidth = module.copyRegion === 'full' ? 'min(92vw,960px)' : 'min(42vw,520px)';
        inner.style.width = module.copyRegion === 'full' ? '100%' : 'auto';
        inner.style.whiteSpace = 'pre-wrap';
        inner.style.wordBreak = 'break-word';
        inner.style.fontSize = `${Math.max(8, Math.min(64, Number(module.copyFontPx) || 22))}px`;
        inner.style.color = String(module.copyColor || '#e8e6e3');
        inner.style.lineHeight = '1.55';
        inner.style.marginTop = '4vh';
        inner.textContent = '';
        this._rdCopy = {
            module,
            pages,
            pageIndex: 0,
            onDone,
            graphemes: [],
            visible: 0,
            timer: null,
            pageDone: false
        };
        this._rdCopyStartPage();
    },

    _rdCopyStartPage() {
        const st = this._rdCopy;
        if (!st) return;
        const full = st.pages[st.pageIndex] || '';
        st.graphemes = Array.from(full);
        st.visible = 0;
        st.pageDone = false;
        const inner = document.querySelector('#layer-rd-copy #rd-copy-text');
        const rawMs = st.module && st.module.copyMsPerChar;
        const parsedMs = rawMs === null || rawMs === undefined || rawMs === '' ? 35 : Number(rawMs);
        const ms = Math.max(0, Math.min(500, Number.isFinite(parsedMs) ? parsedMs : 35));
        if (!inner) {
            st.pageDone = true;
            return;
        }
        inner.textContent = '';
        if (ms <= 0 || !st.graphemes.length) {
            inner.textContent = full;
            st.visible = st.graphemes.length;
            st.pageDone = true;
            return;
        }
        const tick = () => {
            if (!this._rdCopy || this._rdCopy !== st) return;
            if (st.visible >= st.graphemes.length) {
                st.timer = null;
                st.pageDone = true;
                return;
            }
            st.visible += 1;
            inner.textContent = st.graphemes.slice(0, st.visible).join('');
            st.timer = setTimeout(tick, ms);
        };
        st.timer = setTimeout(tick, ms);
    },

    /** @returns {boolean} true 表示已消费本次点击 */
    onRandomDisplayCopyAdvance() {
        const st = this._rdCopy;
        if (!st) return false;
        if (!st.pageDone) {
            st.visible = st.graphemes.length;
            const inner = document.querySelector('#layer-rd-copy #rd-copy-text');
            if (inner) inner.textContent = st.graphemes.join('');
            if (st.timer) clearTimeout(st.timer);
            st.timer = null;
            st.pageDone = true;
            return true;
        }
        if (st.pageIndex < st.pages.length - 1) {
            st.pageIndex += 1;
            this._rdCopyStartPage();
            return true;
        }
        const done = st.onDone;
        this.endRandomDisplayCopy({ keepDialogueHidden: true });
        if (typeof done === 'function') done();
        return true;
    },

    /** 全屏提示（随机无选项 / 片段预览结束等）；无样式依赖，仅调试用 */
    showGameOver(message) {
        const text = String(message || '').replace(/\r\n/g, '\n');
        let layer = document.getElementById('layer-game-over');
        if (!layer) {
            layer = document.createElement('div');
            layer.id = 'layer-game-over';
            layer.style.cssText =
                'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;' +
                'background:rgba(0,0,0,.72);color:#fff;font:16px/1.6 system-ui,Segoe UI,Microsoft YaHei,sans-serif;padding:24px;box-sizing:border-box;cursor:pointer;';
            layer.onclick = () => {
                layer.style.display = 'none';
            };
            const box = document.createElement('div');
            box.style.cssText =
                'max-width:520px;background:#222;border:1px solid rgba(255,255,255,.2);border-radius:12px;padding:20px 22px;white-space:pre-wrap;';
            box.id = 'layer-game-over-box';
            layer.appendChild(box);
            document.body.appendChild(layer);
        }
        const box = document.getElementById('layer-game-over-box');
        if (box) box.textContent = text;
        layer.style.display = 'flex';
    },

    /** 顶部临时系统提示（不切场景、不打断当前流程） */
    showSystemAnnouncement(message, ms = 2600) {
        const text = String(message || '').trim();
        if (!text) return;
        let box = document.getElementById('layer-system-announce');
        if (!box) {
            box = document.createElement('div');
            box.id = 'layer-system-announce';
            box.style.cssText =
                'position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:100001;' +
                'max-width:min(92vw,920px);padding:10px 14px;border-radius:12px;' +
                'background:rgba(16,16,16,.9);border:1px solid rgba(255,255,255,.22);' +
                'color:#fff;font:15px/1.5 system-ui,Segoe UI,Microsoft YaHei,sans-serif;' +
                'white-space:pre-wrap;box-shadow:0 8px 30px rgba(0,0,0,.35);display:none;';
            document.body.appendChild(box);
        }
        box.textContent = text;
        box.style.display = 'block';
        if (this._sysAnnounceTimer) clearTimeout(this._sysAnnounceTimer);
        this._sysAnnounceTimer = setTimeout(() => {
            if (box) box.style.display = 'none';
            this._sysAnnounceTimer = null;
        }, Math.max(600, Number(ms) || 2600));
    }
};
