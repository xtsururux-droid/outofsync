/**
 * hidden-map-runtime.js - 游戏运行时寻物地图
 */
const HiddenMapRuntime = {
    active: null,

    start({ project, scene, step, map, characterId, onFinish }) {
        this.close();
        if (!map) {
            if (typeof onFinish === 'function') onFinish();
            return false;
        }
        const canvas = document.getElementById('game-canvas');
        if (!canvas) return false;
        const layerDialogue = document.getElementById('layer-dialogue');
        const layerOptions = document.getElementById('layer-options');
        if (layerDialogue) layerDialogue.style.display = 'none';
        if (layerOptions) layerOptions.style.display = 'none';

        const root = document.createElement('div');
        root.className = 'hidden-map-runtime';
        const imageUrl = typeof HiddenMapConfig !== 'undefined' ? HiddenMapConfig.getImageUrl(map) : map.imageAlias;
        const spots = (Array.isArray(map.spots) ? map.spots : []).map(s => ({ ...s, found: false }));
        root.innerHTML = `
            <div class="hidden-map-stage">
                <div class="hidden-map-frame">
                    <img class="hidden-map-image fullscreen-image-main" alt="">
                    <img class="hidden-map-image-fill fullscreen-image-fill" alt="" aria-hidden="true">
                    <div class="hidden-map-spots"></div>
                </div>
                <div class="hidden-map-hud">
                    <span class="hidden-map-title"></span>
                    <span class="hidden-map-count"></span>
                    <button type="button" class="hidden-map-finish-btn" hidden>结束寻找</button>
                </div>
            </div>
        `;
        const img = root.querySelector('.hidden-map-image');
        const fillImg = root.querySelector('.hidden-map-image-fill');
        const spotLayer = root.querySelector('.hidden-map-spots');
        const countEl = root.querySelector('.hidden-map-count');
        const titleEl = root.querySelector('.hidden-map-title');
        const finishBtn = root.querySelector('.hidden-map-finish-btn');
        img.src = imageUrl || '';
        if (fillImg) fillImg.src = imageUrl || '';
        titleEl.textContent = map.name || '寻物地图';
        canvas.appendChild(root);

        const session = {
            project,
            scene,
            step,
            map,
            root,
            img,
            spotLayer,
            spots,
            foundCount: 0,
            allowedFindCount: Math.max(0, Number(map.allowedFindCount) || spots.length),
            characterId: String(characterId || step.receiverCharacterId || 'player').trim() || 'player',
            onFinish
        };
        this.active = session;
        finishBtn.hidden = map.finishMode !== 'manual';
        finishBtn.onclick = () => this.finish();
        this.renderSpots();
        this.updateCount();
        return true;
    },

    renderSpots() {
        const s = this.active;
        if (!s || !s.spotLayer) return;
        s.spotLayer.innerHTML = '';
        s.spots.forEach((spot, index) => {
            const el = document.createElement('button');
            el.type = 'button';
            el.className = 'hidden-map-spot hidden-map-spot--glow';
            el.title = spot.label || '藏物点';
            el.dataset.spotId = spot.spotId || '';
            const seedText = `${spot.spotId || ''}:${spot.label || ''}:${index}`;
            let seed = 0;
            for (let i = 0; i < seedText.length; i++) seed = (seed * 31 + seedText.charCodeAt(i)) % 9973;
            const delay = -((seed % 260) / 100);
            const duration = 2.25 + ((seed % 90) / 100);
            el.style.setProperty('--hidden-map-glow-delay', `${delay.toFixed(2)}s`);
            el.style.setProperty('--hidden-map-glow-duration', `${duration.toFixed(2)}s`);
            el.style.setProperty('--hidden-map-glow-spark-delay', `${(delay - 0.55).toFixed(2)}s`);
            const r = Number(spot.radius) || 6;
            el.style.left = `${(Number(spot.x) || 0) - r}%`;
            el.style.top = `${(Number(spot.y) || 0) - r}%`;
            el.style.width = `${r * 2}%`;
            el.style.height = `${r * 2}%`;
            el.style.borderRadius = '999px';
            el.onclick = ev => {
                ev.stopPropagation();
                this.findSpot(spot, el, ev);
            };
            s.spotLayer.appendChild(el);
        });
    },

    findItem(project, itemId) {
        const id = String(itemId || '').trim();
        if (!id || typeof ItemLibraryConfig === 'undefined') return null;
        return ItemLibraryConfig.findItem(project, id) || null;
    },

    itemImageUrl(item) {
        const alias = item && String(item.iconAlias || '').trim();
        if (!alias || typeof AssetManager === 'undefined') return '';
        return (AssetManager.getPath && AssetManager.getPath('items', alias)) || '';
    },

    parseFoundText(text) {
        const rawText = String(text || '');
        if (typeof TopicPoolConfig !== 'undefined' && /^\s*话题[:：]/m.test(rawText)) {
            const parsed = TopicPoolConfig.parseEntryText(this.active && this.active.project, rawText);
            return (parsed.steps || [])
                .filter(st => st && (st.type === 'narration' || st.type === 'dialogue'))
                .map(st => {
                    if (st.type === 'narration') {
                        return { type: 'narration', speaker: '', speakerRef: '', expression: '', text: st.text || '' };
                    }
                    return {
                        type: 'dialogue',
                        speaker: st.speakerName || st.speakerRef || '',
                        speakerRef: st.speakerRef || st.speakerName || '',
                        expression: st.expression || '',
                        text: st.text || ''
                    };
                })
                .filter(row => String(row.text || '').trim());
        }
        return rawText
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean)
            .map(line => {
                const m = line.match(/^([^:：]{1,24})[:：]\s*(.*)$/);
                if (!m) return { type: 'narration', speaker: '', speakerRef: '', expression: '', text: line };
                const speaker = String(m[1] || '').trim();
                const body = String(m[2] || '').trim();
                if (!speaker || speaker === '旁白' || speaker === '叙述' || speaker === '系统') {
                    return { type: 'narration', speaker: '', speakerRef: '', expression: '', text: body };
                }
                let parsed = null;
                if (typeof TopicPoolConfig !== 'undefined') {
                    parsed = TopicPoolConfig.parseSpeakerToken(this.active && this.active.project, speaker);
                }
                return {
                    type: 'dialogue',
                    speaker: (parsed && parsed.speakerName) || speaker,
                    speakerRef: (parsed && parsed.speakerRef) || speaker,
                    expression: (parsed && parsed.emotion) || '',
                    text: body
                };
            })
            .filter(row => row.text);
    },

    showFoundPanel(spot, originEvent, done, options = {}) {
        const s = this.active;
        if (!s || !s.root) {
            if (typeof done === 'function') done();
            return;
        }
        const item = this.findItem(s.project, spot.itemId);
        const itemUrl = this.itemImageUrl(item);
        const lines = options && options.skipText ? [] : this.parseFoundText(spot.foundText);
        const panel = document.createElement('div');
        panel.className = 'hidden-map-found-panel';
        panel.innerHTML = `
            <div class="hidden-map-found-card">
                <div class="hidden-map-found-item">
                    <div class="hidden-map-found-thumb">
                        <span class="hidden-map-found-sparkle hidden-map-found-sparkle--a"></span>
                        <span class="hidden-map-found-sparkle hidden-map-found-sparkle--b"></span>
                        <span class="hidden-map-found-sparkle hidden-map-found-sparkle--c"></span>
                        <span class="hidden-map-found-sparkle hidden-map-found-sparkle--d"></span>
                        <span class="hidden-map-found-sparkle hidden-map-found-sparkle--e"></span>
                    </div>
                    <div class="hidden-map-found-name"></div>
                </div>
            </div>
        `;
        const card = panel.querySelector('.hidden-map-found-card');
        if (card && originEvent && Number.isFinite(originEvent.clientX) && Number.isFinite(originEvent.clientY)) {
            const rect = s.root.getBoundingClientRect();
            const x = Math.max(88, Math.min(rect.width - 88, originEvent.clientX - rect.left));
            const y = Math.max(88, Math.min(rect.height - 88, originEvent.clientY - rect.top));
            card.style.left = `${x}px`;
            card.style.top = `${y}px`;
        }
        const thumb = panel.querySelector('.hidden-map-found-thumb');
        const nameEl = panel.querySelector('.hidden-map-found-name');
        nameEl.textContent = (item && item.name) || spot.label || '';
        if (itemUrl) {
            const img = document.createElement('img');
            img.src = itemUrl;
            img.alt = (item && item.name) || spot.label || '';
            img.onerror = () => img.remove();
            thumb.appendChild(img);
            if (typeof AssetManager !== 'undefined' && AssetManager.resolveProjectAssetUrl && item && item.iconAlias) {
                AssetManager.resolveProjectAssetUrl('items', item.iconAlias).then(url => {
                    if (url && img.parentNode) img.src = url;
                });
            }
        }
        const close = () => {
            if (panel.parentNode) panel.parentNode.removeChild(panel);
            if (lines.length) this.startTextSession(lines, done);
            else if (typeof done === 'function') done();
        };
        panel.onclick = ev => {
            ev.stopPropagation();
            close();
        };
        s.root.appendChild(panel);
    },

    startTextSession(lines, done) {
        const s = this.active;
        if (!s) {
            if (typeof done === 'function') done();
            return;
        }
        const canvas = document.getElementById('game-canvas');
        if (canvas) canvas.classList.add('hidden-map-dialogue-active');
        s.root && s.root.classList.add('hidden-map-runtime--text');
        s.textSession = {
            lines: Array.isArray(lines) ? lines : [],
            index: 0,
            done: typeof done === 'function' ? done : null
        };
        if (!this._textClickHandler) {
            this._textClickHandler = ev => {
                const cur = this.active;
                if (!cur || !cur.textSession) return;
                ev.preventDefault();
                ev.stopPropagation();
                if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
                this.advanceTextSession();
            };
        }
        if (canvas) canvas.addEventListener('click', this._textClickHandler, true);
        this.showTextSessionLine();
    },

    showTextSessionLine() {
        const s = this.active;
        const ts = s && s.textSession;
        if (!s || !ts) return;
        const row = ts.lines[ts.index];
        if (!row) {
            this.endTextSession();
            return;
        }
        const displayStep = row.type === 'dialogue'
            ? {
                  ...(s.step || {}),
                  id: `${(s.step && s.step.id) || 'hidden_map'}_found_${ts.index}`,
                  type: 'dialogue',
                  speakerRef: row.speakerRef || row.speaker || '',
                  expression: row.expression || '',
                  text: row.text || ''
              }
            : {
                  ...(s.step || {}),
                  id: `${(s.step && s.step.id) || 'hidden_map'}_found_${ts.index}`,
                  type: 'narration',
                  text: row.text || ''
              };
        if (typeof UIManager !== 'undefined' && UIManager.showTextStep) {
            UIManager.showTextStep(s.scene || {}, displayStep, null);
        }
        if (typeof Renderer !== 'undefined' && Renderer.renderCharacterForStep) {
            Renderer.renderCharacterForStep(s.scene || {}, displayStep);
        }
    },

    advanceTextSession() {
        const s = this.active;
        const ts = s && s.textSession;
        if (!s || !ts) return;
        if (typeof UIManager !== 'undefined' && UIManager.consumeTypewriterSkipIfBusy) {
            if (UIManager.consumeTypewriterSkipIfBusy()) return;
        }
        if (typeof UIManager !== 'undefined' && UIManager.nextPage && UIManager.isAtEndOfStep) {
            if (!UIManager.isAtEndOfStep()) {
                UIManager.nextPage();
                return;
            }
        }
        ts.index += 1;
        if (ts.index >= ts.lines.length) {
            this.endTextSession();
            return;
        }
        this.showTextSessionLine();
    },

    endTextSession() {
        const s = this.active;
        if (!s || !s.textSession) return;
        const done = s.textSession.done;
        s.textSession = null;
        const canvas = document.getElementById('game-canvas');
        if (canvas) {
            canvas.classList.remove('hidden-map-dialogue-active');
            if (this._textClickHandler) canvas.removeEventListener('click', this._textClickHandler, true);
        }
        if (s.root) s.root.classList.remove('hidden-map-runtime--text');
        if (typeof UIManager !== 'undefined' && UIManager.cancelTypewriter) UIManager.cancelTypewriter();
        const layerDialogue = document.getElementById('layer-dialogue');
        if (layerDialogue) layerDialogue.style.display = 'none';
        const charLayer = document.getElementById('layer-char');
        if (charLayer) {
            charLayer.innerHTML = '';
            charLayer.style.display = 'none';
        }
        if (typeof done === 'function') done();
    },

    updateCount() {
        const s = this.active;
        if (!s) return;
        const countEl = s.root.querySelector('.hidden-map-count');
        if (countEl) countEl.textContent = `已找到 ${s.foundCount} / ${s.allowedFindCount}`;
    },

    playFoundSound() {
        const s = this.active;
        const foundSound = String((s && s.map && s.map.foundSoundAlias) || '').trim();
        if (foundSound && typeof StoryEffects !== 'undefined' && StoryEffects.playSound) {
            StoryEffects.playSound(foundSound);
        }
    },

    collectSpot(spot, el) {
        const s = this.active;
        if (!s || !spot || spot.found) return false;
        spot.found = true;
        s.foundCount += 1;
        const marker =
            el ||
            (s.spotLayer && spot.spotId
                ? Array.from(s.spotLayer.querySelectorAll('[data-spot-id]')).find(
                      node => String(node.dataset.spotId || '') === String(spot.spotId || '')
                  )
                : null);
        if (marker) {
            marker.classList.add('is-found');
            marker.disabled = true;
        }
        if (typeof InventorySystem !== 'undefined') {
            InventorySystem.addItem('player', spot.itemId, {
                project: s.project,
                source: s.map.mapId,
                count: 1
            });
        }
        this.updateCount();
        return true;
    },

    maybeFinishAfterCollect() {
        const s = this.active;
        if (!s) return;
        if (s.map.finishMode !== 'manual' && s.foundCount >= s.allowedFindCount) {
            window.setTimeout(() => this.finish(), 120);
        }
    },

    itemDisplayName(spot) {
        const s = this.active;
        const item = this.findItem(s && s.project, spot && spot.itemId);
        return (item && item.name) || (spot && spot.label) || '';
    },

    escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    },

    showCollectChoice(spot, el) {
        const s = this.active;
        if (!s || !s.root || !spot || spot.found) return;
        const panel = document.createElement('div');
        panel.className = 'hidden-map-collect-choice';
        const itemName = this.itemDisplayName(spot);
        panel.innerHTML = `
            <div class="hidden-map-collect-card">
                <div class="hidden-map-collect-text">是否收下「${this.escapeHtml(itemName)}」？</div>
                <div class="hidden-map-collect-actions">
                    <button type="button" data-action="accept">收下</button>
                    <button type="button" data-action="reject">不收</button>
                </div>
            </div>
        `;
        const close = () => {
            if (panel.parentNode) panel.parentNode.removeChild(panel);
        };
        panel.addEventListener('click', ev => {
            ev.stopPropagation();
            const btn = ev.target && ev.target.closest ? ev.target.closest('button[data-action]') : null;
            if (!btn) return;
            const action = btn.dataset.action;
            close();
            if (action === 'accept') {
                this.collectSpot(spot, el);
                const lines = this.parseFoundText(spot.acceptText);
                const done = () => {
                    spot._busy = false;
                    this.maybeFinishAfterCollect();
                };
                if (lines.length) this.startTextSession(lines, done);
                else done();
                return;
            }
            const lines = this.parseFoundText(spot.rejectText);
            const done = () => {
                spot._busy = false;
            };
            if (lines.length) this.startTextSession(lines, done);
            else done();
        });
        s.root.appendChild(panel);
    },

    findSpot(spot, el, originEvent = null) {
        const s = this.active;
        if (!s || !spot || spot.found || spot._busy) return;
        if (s.foundCount >= s.allowedFindCount) return;
        const choiceMode = s.map && s.map.collectMode === 'choice';
        spot._busy = true;
        this.playFoundSound();
        if (!choiceMode) {
            this.collectSpot(spot, el);
            this.showFoundPanel(spot, originEvent, () => {
                spot._busy = false;
                this.maybeFinishAfterCollect();
            });
            return;
        }
        this.showFoundPanel(
            spot,
            originEvent,
            () => {
                this.showCollectChoice(spot, el);
            }
        );
    },

    finish() {
        const s = this.active;
        if (!s) return;
        const cb = s.onFinish;
        this.close();
        if (typeof cb === 'function') cb();
    },

    close() {
        const s = this.active;
        if (s && s.textSession) {
            s.textSession.done = null;
            this.endTextSession();
        }
        if (s && s.root && s.root.parentNode) s.root.parentNode.removeChild(s.root);
        const layerDialogue = document.getElementById('layer-dialogue');
        const layerOptions = document.getElementById('layer-options');
        if (layerDialogue) layerDialogue.style.display = '';
        if (layerOptions) layerOptions.style.display = '';
        this.active = null;
    }
};

if (typeof window !== 'undefined') window.HiddenMapRuntime = HiddenMapRuntime;
