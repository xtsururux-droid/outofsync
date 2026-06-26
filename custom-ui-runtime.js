/**
 * custom-ui-runtime.js — 运行端应用自定义 UI（仅在有设定时生效）
 */
const CustomUiRuntime = {
    _applied: false,
    _styleEl: null,

    reset() {
        this._applied = false;
        const canvas = document.getElementById('game-canvas');
        if (canvas) canvas.classList.remove('game-custom-ui');
        const db = document.getElementById('dialogue-box');
        if (db) {
            db.classList.remove('custom-ui-dialogue');
            db.style.cssText = '';
        }
        const col = document.getElementById('dialogue-column');
        if (col) col.style.width = '';
        const ta = document.getElementById('text-area');
        if (ta) {
            ta.classList.remove('custom-ui-text-area');
            ta.style.cssText = '';
        }
        const tc = document.getElementById('text-content');
        if (tc) tc.style.cssText = '';
        const pi = document.getElementById('page-indicator');
        if (pi) pi.style.cssText = '';
        const lo = document.getElementById('layer-options');
        if (lo) lo.style.background = '';
        const free = document.getElementById('layer-free-ui');
        if (free) {
            free.innerHTML = '';
            free.style.display = '';
        }
        const vp = document.getElementById('game-viewport');
        if (vp) {
            vp.style.cursor = '';
            vp.onmousedown = null;
            vp.onmouseup = null;
        }
        if (this._styleEl && this._styleEl.parentNode) {
            this._styleEl.parentNode.removeChild(this._styleEl);
        }
        this._styleEl = null;
    },

    _resolveUrl(alias) {
        if (!alias) return '';
        if (typeof AssetManager !== 'undefined' && AssetManager.resolveMediaUrl) {
            return AssetManager.resolveMediaUrl('storyGraphics', alias) || '';
        }
        return '';
    },

    _cssUrl(url) {
        if (!url) return '';
        const s = String(url).replace(/\\/g, '/');
        if (/^(data:|blob:|https?:)/i.test(s)) return s;
        return encodeURI(s).replace(/'/g, '%27');
    },

    apply(project) {
        this.reset();
        if (!project || typeof CustomUiConfig === 'undefined') return;
        CustomUiConfig.normalizeProject(project);
        if (!CustomUiConfig.hasAnyActive(project)) return;

        const cu = project.customUi;
        const canvas = document.getElementById('game-canvas');
        if (canvas) canvas.classList.add('game-custom-ui');
        this._applied = true;

        const rules = [];

        if (CustomUiConfig.hasDialogueSkin(project)) {
            const d = cu.dialogue;
            const url = this._cssUrl(this._resolveUrl(d.imageAlias));
            if (url) {
                const db = document.getElementById('dialogue-box');
                const col = document.getElementById('dialogue-column');
                const ta = document.getElementById('text-area');
                if (col && d.columnWidth) {
                    col.style.width = `${d.columnWidth}px`;
                    col.style.maxWidth = 'calc(100% - 48px)';
                }
                if (db) {
                    db.classList.add('custom-ui-dialogue');
                    const t = d.sliceTop;
                    const r = d.sliceRight;
                    const b = d.sliceBottom;
                    const l = d.sliceLeft;
                    rules.push(
                        `#dialogue-box.custom-ui-dialogue{background:transparent;border-radius:0;border-style:solid;border-color:transparent;border-width:${t}px ${r}px ${b}px ${l}px;border-image-source:url('${url}');border-image-slice:${t} ${r} ${b} ${l} fill;border-image-width:${t}px ${r}px ${b}px ${l}px;border-image-repeat:stretch;padding:0;box-sizing:border-box;}`,
                        `#dialogue-box.custom-ui-dialogue.dialogue-dim{filter:brightness(0.92);opacity:1;background:transparent;}`
                    );
                }
                if (ta && d.textW && d.textH) {
                    ta.classList.add('custom-ui-text-area');
                    rules.push(
                        `#text-area.custom-ui-text-area{position:absolute;left:${d.textX}px;top:${d.textY}px;width:${d.textW}px;height:${d.textH}px;min-height:0;box-sizing:border-box;overflow:hidden;}`
                    );
                    if (db) {
                        rules.push(`#dialogue-box.custom-ui-dialogue{position:relative;min-height:${d.textY + d.textH + d.sliceBottom}px;}`);
                    }
                }
            }
        }

        if (cu.text) {
            const tc = document.getElementById('text-content');
            if (tc) {
                if (cu.text.fontSize != null) tc.style.fontSize = `${cu.text.fontSize}px`;
                if (cu.text.lineHeight != null) tc.style.lineHeight = String(cu.text.lineHeight);
                if (cu.text.color) tc.style.color = cu.text.color;
            }
        }

        if (cu.pageIndicator) {
            const pi = document.getElementById('page-indicator');
            if (pi) {
                if (cu.pageIndicator.fontSize != null) pi.style.fontSize = `${cu.pageIndicator.fontSize}px`;
                if (cu.pageIndicator.color) pi.style.color = cu.pageIndicator.color;
            }
        }

        if (cu.options && cu.options.overlayOpacity != null) {
            const lo = document.getElementById('layer-options');
            if (lo) lo.style.background = `rgba(0,0,0,${cu.options.overlayOpacity})`;
        }

        if (CustomUiConfig.hasCursorSkin(project)) {
            const c = cu.cursor;
            const url = this._cssUrl(this._resolveUrl(c.imageAlias));
            const vp = document.getElementById('game-viewport');
            if (url && vp) {
                const hx = c.hotspotX || 0;
                const hy = c.hotspotY || 0;
                const normal = `url('${url}') ${hx} ${hy}, auto`;
                vp.style.cursor = normal;
                const clickAlias = String(c.clickImageAlias || '').trim();
                if (clickAlias) {
                    const clickUrl = this._cssUrl(this._resolveUrl(clickAlias));
                    if (clickUrl) {
                        const pressed = `url('${clickUrl}') ${hx} ${hy}, auto`;
                        vp.onmousedown = () => {
                            vp.style.cursor = pressed;
                        };
                        vp.onmouseup = () => {
                            vp.style.cursor = normal;
                        };
                    }
                }
            }
        }

        this._renderFreeButtons(project);

        if (rules.length) {
            const el = document.createElement('style');
            el.id = 'custom-ui-runtime-styles';
            el.textContent = rules.join('\n');
            document.head.appendChild(el);
            this._styleEl = el;
        }
    },

    _renderFreeButtons(project) {
        const layer = document.getElementById('layer-free-ui');
        const cu = project && project.customUi;
        const list = cu && Array.isArray(cu.freeButtons) ? cu.freeButtons : [];
        if (!layer) return;
        layer.innerHTML = '';
        list.filter(btn => btn && btn.enabled !== false && btn.scope !== 'boot').forEach(btn => {
            const el = document.createElement('button');
            el.type = 'button';
            el.className = 'free-ui-button';
            el.textContent = btn.text || btn.name || '按钮';
            el.style.left = `${btn.xPct || 0}%`;
            el.style.top = `${btn.yPct || 0}%`;
            el.style.width = `${btn.wPct || 10}%`;
            el.style.height = `${btn.hPct || 6}%`;
            el.style.fontSize = `${btn.fontSize || 20}px`;
            el.style.fontFamily = btn.fontFamily ? btn.fontFamily : '';
            el.style.color = btn.color || '#fff';
            el.style.background = btn.background || '#333';
            el.style.borderColor = btn.borderColor || '#fff';
            el.style.opacity = String(btn.opacity != null ? btn.opacity : 0.9);
            el.onclick = ev => {
                ev.preventDefault();
                ev.stopPropagation();
                this._runFreeButtonAction(btn, project);
            };
            layer.appendChild(el);
        });
    },

    _runFreeButtonAction(btn, project) {
        const action = btn && btn.action && typeof btn.action === 'object' ? btn.action : {};
        const type = String(action.type || 'none');
        if (type === 'save') {
            if (typeof PlaySave !== 'undefined' && PlaySave.captureSnapshot && PlaySave.writeSnapshot) {
                const snap = PlaySave.captureSnapshot(project);
                if (snap) PlaySave.writeSnapshot(project, snap);
            }
            return;
        }
        if (type === 'load') {
            if (typeof SceneManager !== 'undefined' && SceneManager.applyNext) {
                SceneManager.applyNext({ type: 'loadSave' });
            }
            return;
        }
        if (type === 'jump') {
            if (typeof SceneManager !== 'undefined' && SceneManager.jumpToScene) {
                SceneManager.jumpToScene(action.sceneId || 'start', action.labelSuffix || '');
            }
            return;
        }
        if (type === 'close') {
            const layer = document.getElementById('layer-free-ui');
            if (layer) layer.style.display = 'none';
        }
    },

    getLinesPerPageForDialogue(project) {
        const cu = project && project.customUi;
        const d = cu && cu.dialogue;
        if (!d || !d.textH) return 3;
        const fontSize =
            cu.text && cu.text.fontSize != null ? cu.text.fontSize : 22;
        const lineHeight =
            cu.text && cu.text.lineHeight != null ? cu.text.lineHeight : 1.6;
        const linePx = fontSize * lineHeight;
        return Math.max(1, Math.floor(d.textH / linePx));
    }
};

if (typeof window !== 'undefined') window.CustomUiRuntime = CustomUiRuntime;
