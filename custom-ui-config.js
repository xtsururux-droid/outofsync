/**
 * custom-ui-config.js — 自定义 UI 数据结构（主本，位于 editor）
 * 修改后须同步到 games/主游戏/、games/BU/ 同名文件。
 */
const CustomUiConfig = {
    defaultDialogue() {
        return {
            imageAlias: '',
            sliceTop: 0,
            sliceRight: 0,
            sliceBottom: 0,
            sliceLeft: 0,
            textX: 0,
            textY: 0,
            textW: 0,
            textH: 0,
            columnWidth: 1100,
            dimBackgroundAlpha: 0.65
        };
    },

    defaultCursor() {
        return {
            imageAlias: '',
            hotspotX: 0,
            hotspotY: 0,
            clickImageAlias: ''
        };
    },

    defaultOptions() {
        return {
            overlayOpacity: null
        };
    },

    defaultText() {
        return {
            fontSize: null,
            lineHeight: null,
            color: null
        };
    },

    defaultPageIndicator() {
        return {
            fontSize: null,
            color: null
        };
    },

    defaultFreeButton() {
        return {
            id: `free_btn_${Date.now().toString(36)}`,
            name: '按钮',
            enabled: true,
            text: '按钮',
            scope: 'game',
            xPct: 84,
            yPct: 6,
            wPct: 10,
            hPct: 6,
            fontSize: 20,
            fontFamily: '',
            color: '#ffffff',
            background: '#333333',
            borderColor: '#ffffff',
            opacity: 0.9,
            action: { type: 'none', sceneId: '', labelSuffix: '' }
        };
    },

    _num(v, fallback) {
        const n = Number(v);
        return Number.isFinite(n) ? n : fallback;
    },

    _clampInt(v, min, max, fallback) {
        const n = Math.round(this._num(v, fallback));
        return Math.max(min, Math.min(max, n));
    },

    sanitizeDialogue(d) {
        if (!d || typeof d !== 'object') return null;
        const alias = String(d.imageAlias || '').trim();
        if (!alias) return null;
        const out = {
            imageAlias: alias,
            sliceTop: this._clampInt(d.sliceTop, 0, 2000, 24),
            sliceRight: this._clampInt(d.sliceRight, 0, 2000, 24),
            sliceBottom: this._clampInt(d.sliceBottom, 0, 2000, 24),
            sliceLeft: this._clampInt(d.sliceLeft, 0, 2000, 24),
            textX: this._clampInt(d.textX, 0, 10000, 0),
            textY: this._clampInt(d.textY, 0, 10000, 0),
            textW: this._clampInt(d.textW, 1, 10000, 100),
            textH: this._clampInt(d.textH, 1, 10000, 80),
            columnWidth: this._clampInt(d.columnWidth, 200, 1280, 1100),
            dimBackgroundAlpha: Math.max(0.1, Math.min(1, this._num(d.dimBackgroundAlpha, 0.65)))
        };
        return out;
    },

    sanitizeCursor(c) {
        if (!c || typeof c !== 'object') return null;
        const alias = String(c.imageAlias || '').trim();
        if (!alias) return null;
        return {
            imageAlias: alias,
            hotspotX: this._clampInt(c.hotspotX, 0, 512, 0),
            hotspotY: this._clampInt(c.hotspotY, 0, 512, 0),
            clickImageAlias: String(c.clickImageAlias || '').trim()
        };
    },

    sanitizeOptions(o) {
        if (!o || typeof o !== 'object') return null;
        if (o.overlayOpacity == null || o.overlayOpacity === '') return null;
        const op = this._num(o.overlayOpacity, NaN);
        if (!Number.isFinite(op)) return null;
        return { overlayOpacity: Math.max(0, Math.min(1, op)) };
    },

    sanitizeText(t) {
        if (!t || typeof t !== 'object') return null;
        const out = {};
        if (t.fontSize != null && t.fontSize !== '') {
            out.fontSize = this._clampInt(t.fontSize, 8, 64, 22);
        }
        if (t.lineHeight != null && t.lineHeight !== '') {
            out.lineHeight = Math.max(1, Math.min(3, this._num(t.lineHeight, 1.6)));
        }
        if (t.color != null && String(t.color).trim()) {
            out.color = String(t.color).trim();
        }
        return Object.keys(out).length ? out : null;
    },

    sanitizePageIndicator(p) {
        if (!p || typeof p !== 'object') return null;
        const out = {};
        if (p.fontSize != null && p.fontSize !== '') {
            out.fontSize = this._clampInt(p.fontSize, 8, 32, 14);
        }
        if (p.color != null && String(p.color).trim()) {
            out.color = String(p.color).trim();
        }
        return Object.keys(out).length ? out : null;
    },

    sanitizeFreeButton(btn) {
        if (!btn || typeof btn !== 'object') return null;
        const id = String(btn.id || '').trim() || `free_btn_${Math.random().toString(36).slice(2, 8)}`;
        const action = btn.action && typeof btn.action === 'object' ? btn.action : {};
        const actionType = ['none', 'save', 'load', 'jump', 'close'].includes(String(action.type || ''))
            ? String(action.type || '')
            : 'none';
        return {
            id,
            name: String(btn.name || '按钮').trim() || '按钮',
            enabled: btn.enabled !== false,
            text: String(btn.text || btn.name || '按钮'),
            scope: ['game', 'boot'].includes(String(btn.scope || 'game')) ? String(btn.scope || 'game') : 'game',
            xPct: Math.max(0, Math.min(100, this._num(btn.xPct, 84))),
            yPct: Math.max(0, Math.min(100, this._num(btn.yPct, 6))),
            wPct: Math.max(2, Math.min(100, this._num(btn.wPct, 10))),
            hPct: Math.max(2, Math.min(100, this._num(btn.hPct, 6))),
            fontSize: this._clampInt(btn.fontSize, 8, 64, 20),
            fontFamily: String(btn.fontFamily || '').trim(),
            color: String(btn.color || '#ffffff').trim() || '#ffffff',
            background: String(btn.background || '#333333').trim() || '#333333',
            borderColor: String(btn.borderColor || '#ffffff').trim() || '#ffffff',
            opacity: Math.max(0, Math.min(1, this._num(btn.opacity, 0.9))),
            action: {
                type: actionType,
                sceneId: String(action.sceneId || '').trim(),
                labelSuffix: String(action.labelSuffix || '').trim()
            }
        };
    },

    sanitizeFreeButtons(list) {
        if (!Array.isArray(list)) return null;
        const out = list.map(btn => this.sanitizeFreeButton(btn)).filter(Boolean);
        return out.length ? out : null;
    },

    sanitizeCustomUi(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const out = {};
        const dialogue = this.sanitizeDialogue(raw.dialogue);
        if (dialogue) out.dialogue = dialogue;
        const cursor = this.sanitizeCursor(raw.cursor);
        if (cursor) out.cursor = cursor;
        const options = this.sanitizeOptions(raw.options);
        if (options) out.options = options;
        const text = this.sanitizeText(raw.text);
        if (text) out.text = text;
        const pageIndicator = this.sanitizePageIndicator(raw.pageIndicator);
        if (pageIndicator) out.pageIndicator = pageIndicator;
        const freeButtons = this.sanitizeFreeButtons(raw.freeButtons);
        if (freeButtons) out.freeButtons = freeButtons;
        return Object.keys(out).length ? out : null;
    },

    normalizeProject(project) {
        if (!project || typeof project !== 'object') return;
        if (project.customUi == null) return;
        const cleaned = this.sanitizeCustomUi(project.customUi);
        if (cleaned) project.customUi = cleaned;
        else delete project.customUi;
    },

    hasDialogueSkin(project) {
        const d = project && project.customUi && project.customUi.dialogue;
        return !!(d && String(d.imageAlias || '').trim());
    },

    hasCursorSkin(project) {
        const c = project && project.customUi && project.customUi.cursor;
        return !!(c && String(c.imageAlias || '').trim());
    },

    hasAnyActive(project) {
        const cu = project && project.customUi;
        if (!cu || typeof cu !== 'object') return false;
        return !!(
            this.hasDialogueSkin(project) ||
            this.hasCursorSkin(project) ||
            (cu.options && cu.options.overlayOpacity != null) ||
            (cu.text && (cu.text.fontSize != null || cu.text.lineHeight != null || cu.text.color)) ||
            (cu.pageIndicator && (cu.pageIndicator.fontSize != null || cu.pageIndicator.color)) ||
            (Array.isArray(cu.freeButtons) && cu.freeButtons.some(btn => btn && btn.enabled !== false))
        );
    },

    ensureWorkingCopy(project) {
        if (!project.customUi || typeof project.customUi !== 'object') {
            project.customUi = {};
        }
        if (!project.customUi.dialogue) project.customUi.dialogue = this.defaultDialogue();
        if (!project.customUi.cursor) project.customUi.cursor = this.defaultCursor();
        if (!project.customUi.options) project.customUi.options = this.defaultOptions();
        if (!project.customUi.text) project.customUi.text = this.defaultText();
        if (!project.customUi.pageIndicator) project.customUi.pageIndicator = this.defaultPageIndicator();
        if (!Array.isArray(project.customUi.freeButtons)) project.customUi.freeButtons = [];
        return project.customUi;
    },

    collectStoryGraphicAliases(project) {
        const names = [];
        const cu = project && project.customUi;
        if (!cu) return names;
        if (cu.dialogue && cu.dialogue.imageAlias) names.push(String(cu.dialogue.imageAlias).trim());
        if (cu.cursor && cu.cursor.imageAlias) names.push(String(cu.cursor.imageAlias).trim());
        if (cu.cursor && cu.cursor.clickImageAlias) names.push(String(cu.cursor.clickImageAlias).trim());
        return names.filter(Boolean);
    },

    applySliceDefaultsForImage(dialogue, imgW, imgH) {
        if (!dialogue || !imgW || !imgH) return dialogue;
        const padX = Math.max(8, Math.round(imgW * 0.08));
        const padY = Math.max(8, Math.round(imgH * 0.12));
        if (!dialogue.sliceTop && !dialogue.sliceRight && !dialogue.sliceBottom && !dialogue.sliceLeft) {
            dialogue.sliceTop = padY;
            dialogue.sliceRight = padX;
            dialogue.sliceBottom = padY;
            dialogue.sliceLeft = padX;
        }
        if (!dialogue.textW || !dialogue.textH) {
            dialogue.textX = dialogue.sliceLeft + Math.round(padX * 0.5);
            dialogue.textY = dialogue.sliceTop + Math.round(padY * 0.4);
            dialogue.textW = Math.max(40, imgW - dialogue.sliceLeft - dialogue.sliceRight - padX);
            dialogue.textH = Math.max(24, imgH - dialogue.sliceTop - dialogue.sliceBottom - padY);
        }
        return dialogue;
    }
};

if (typeof window !== 'undefined') window.CustomUiConfig = CustomUiConfig;
