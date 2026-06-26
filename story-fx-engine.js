/**
 * story-fx-engine.js — 步骤特效 v2 运行时（入场→氛围→出场；樱花/黄叶/红叶走资源库）
 * 依赖：StoryFxCatalog、StoryEffects（cleanup/_addCleanup）、AssetManager、UIManager、SceneManager（部分钩子）
 */
const StoryFxEngine = (() => {
    const T = StoryFxCatalog.T;
    /** 编辑器演示时把粒子/遮罩挂到此容器，避免污染游戏 layer-fx */
    let _demoHost = null;

    function parseFx(step) {
        const fx = step && step.stepFx;
        if (!fx || typeof fx !== 'object') return null;
        if (Number(fx.v) !== 2) return null;
        const family = String(fx.family || '').trim();
        let target = String(fx.target || T.ALL).trim() || T.ALL;
        const effect = String(fx.effect || '').trim();
        if (family === 'shock') {
            if (!effect) return null;
            return { family: 'shock', target: T.ALL, effect };
        }
        if (family === 'rom_combo' || family === 'sad_combo') {
            if (!effect) return null;
            return { family, target, effect };
        }
        const re = String(fx.romEntryEffect || '').trim();
        const ra = String(fx.romAmbientEffect || '').trim();
        const rx = String(fx.romExitEffect || '').trim();
        const ambPick = ra || (family === 'rom_ambient' ? effect : '');
        const entPick = re || (family === 'rom_entry' ? effect : '');
        const exitPick = rx || (family === 'rom_exit' ? effect : '');
        if (entPick) {
            target = resolveEffectTarget('rom_entry', entPick);
            return { family: 'rom_entry', target, effect: entPick };
        }
        if (ambPick) {
            target = resolveEffectTarget('rom_ambient', ambPick);
            return { family: 'rom_ambient', target, effect: ambPick };
        }
        if (family && effect) {
            return { family, target, effect };
        }
        if (exitPick) {
            target = resolveEffectTarget('rom_exit', exitPick);
            return { family: 'rom_exit', target, effect: exitPick };
        }
        return null;
    }

    function metaOf(spec) {
        return StoryFxCatalog.meta(spec.effect) || {};
    }

    /** 步骤上 entrySec 1～10（秒），覆盖目录默认入场时长 */
    function readEntryMsOverride(step) {
        const fx = step && step.stepFx;
        if (!fx || typeof fx !== 'object') return null;
        const sec = Number(fx.entrySec);
        if (!Number.isFinite(sec) || sec < 1 || sec > 10) return null;
        return Math.round(Math.max(200, Math.min(10000, sec * 1000)));
    }

    /** 步骤上 exitSec 1～10（秒），覆盖目录默认出场时长 */
    function readExitMsOverride(step) {
        const fx = step && step.stepFx;
        if (!fx || typeof fx !== 'object') return null;
        const sec = Number(fx.exitSec);
        if (!Number.isFinite(sec) || sec < 1 || sec > 10) return null;
        return Math.round(Math.max(200, Math.min(12000, sec * 1000)));
    }

    function resolveEffectTarget(family, effectId) {
        const f = String(family || '').trim();
        const id = String(effectId || '').trim();
        if (!f || f === 'shock' || !id) return T.ALL;
        const inCg = StoryFxCatalog.listEffects(f, T.CG).some(e => e && e.id === id);
        const inSp = StoryFxCatalog.listEffects(f, T.SPRITE).some(e => e && e.id === id);
        const inAll = StoryFxCatalog.listEffects(f, T.ALL).some(e => e && e.id === id);
        if (inAll) return T.ALL;
        if (inCg && !inSp) return T.CG;
        if (inSp && !inCg) return T.SPRITE;
        if (inCg) return T.CG;
        return T.ALL;
    }

    /** 离场出场：优先 romExitEffect，其次主 family 为 rom_exit 时的 effect */
    function leavingExitPlaySpec(step) {
        const fx = step && step.stepFx;
        if (!fx || typeof fx !== 'object' || Number(fx.v) !== 2) return parseFx(step);
        const fam = String(fx.family || '').trim();
        if (fam === 'rom_combo' || fam === 'sad_combo') return parseFx(step);
        const rx = String(fx.romExitEffect || '').trim();
        if (rx) return { family: 'rom_exit', effect: rx, target: resolveEffectTarget('rom_exit', rx) };
        return parseFx(step);
    }

    function threePhaseFamily(f) {
        return f === 'sad_combo' || f === 'rom_combo';
    }

    function exitOnlyFamily(f) {
        return f === 'rom_exit';
    }

    function romanticFamily(f) {
        return f === 'rom_entry' || f === 'rom_ambient' || f === 'rom_exit' || f === 'rom_combo';
    }

    function particlePath(alias) {
        if (typeof AssetManager === 'undefined') return null;
        if (typeof AssetManager.resolveParticleImageUrl === 'function') {
            return AssetManager.resolveParticleImageUrl(alias);
        }
        const u =
            AssetManager.resolveMediaUrl && AssetManager.resolveMediaUrl('particles', alias)
                ? AssetManager.resolveMediaUrl('particles', alias)
                : AssetManager.getPath
                  ? AssetManager.getPath('particles', alias)
                  : null;
        if (!u) return null;
        if (typeof AssetManager.isVideoLikeMediaUrl === 'function' && AssetManager.isVideoLikeMediaUrl(u)) return null;
        return u;
    }

    /** 无图或视频粒子时：用 CSS「叶片」下落，物理与 mountParticleFall 一致 */
    function mountSyntheticLeafFall(alias, opts = {}) {
        const fx = layerFx();
        if (!fx) return;
        const holder = document.createElement('div');
        holder.dataset.sfxV2 = '1';
        holder.className = 'fx-overlay fx-particle-fall sfx-v2-synth-leaf';
        const spdSynth = opts.speedScale != null ? opts.speedScale : 1;
        const n = opts.count != null ? opts.count : 22;
        const pal =
            alias === '红叶'
                ? () =>
                      `linear-gradient(${115 + Math.random() * 40}deg,rgba(220,55,40,0.95),rgba(140,25,18,0.88) 45%,rgba(90,15,12,0.75))`
                : alias === '黄叶'
                  ? () =>
                        `linear-gradient(${95 + Math.random() * 35}deg,rgba(255,210,120,0.92),rgba(200,140,40,0.82) 50%,rgba(120,80,20,0.7))`
                  : () =>
                        `linear-gradient(${80 + Math.random() * 50}deg,rgba(255,230,245,0.95),rgba(255,180,200,0.75) 55%,rgba(255,150,180,0.55))`;
        const items = [];
        for (let i = 0; i < n; i++) {
            const el = document.createElement('div');
            const sc = (opts.scaleMin != null ? opts.scaleMin : 0.28) + Math.random() * (opts.scaleRand != null ? opts.scaleRand : 0.5);
            const base = 26 + Math.random() * 18;
            const w = base * sc;
            const h = (base * 0.72 + Math.random() * 8) * sc;
            el.style.cssText =
                `position:absolute;top:0;left:0;width:${w}px;height:${h}px;pointer-events:none;` +
                `border-radius:55% 8% 60% 12% / 50% 45% 50% 48%;` +
                `background:${pal()};box-shadow:0 1px 3px rgba(0,0,0,0.25);opacity:0.82;`;
            const vx = opts.vxSpread != null ? -opts.vxSpread + Math.random() * (2 * opts.vxSpread) : -0.9 + Math.random() * 1.8;
            const vy = opts.vyMin != null ? opts.vyMin + Math.random() * (opts.vyRand != null ? opts.vyRand : 1.4) : 0.9 + Math.random() * 1.6;
            const rot = Math.random() * Math.PI * 2;
            let vr = opts.spin != null ? (-opts.spin + Math.random() * (2 * opts.spin)) * sc : (-0.02 + Math.random() * 0.04) * sc;
            const rom = !!opts.romantic;
            if (rom) vr *= 0.85 + Math.random() * 1.1;
            items.push({
                el,
                x: 0,
                y: 0,
                vx,
                vy,
                rot,
                vr,
                ph: Math.random() * Math.PI * 2,
                ph2: Math.random() * Math.PI * 2,
                rom
            });
            holder.appendChild(el);
        }
        fx.appendChild(holder);
        const layoutSpawn = () => {
            const { w, h } = particleBounds(holder);
            items.forEach(it => {
                it.x = Math.random() * w;
                it.y = -30 - Math.random() * Math.max(80, h * 0.55);
            });
        };
        layoutSpawn();
        requestAnimationFrame(() => requestAnimationFrame(layoutSpawn));
        let raf = 0;
        const tick = () => {
            if (!holder.isConnected) return;
            const t = performance.now() / 1000;
            const { w, h } = particleBounds(holder);
            items.forEach(it => {
                const sway0 = opts.sway ? Math.sin(it.y * 0.012) * opts.sway : 0;
                const swayR = it.rom ? Math.sin(t * 0.85 + it.ph) * 0.55 + Math.cos(t * 0.5 + it.ph2) * 0.35 : 0;
                it.x += (it.vx + sway0 + swayR) * spdSynth;
                it.y += (it.vy + (it.rom ? Math.sin(t * 0.62 + it.ph2) * 0.22 : 0)) * spdSynth;
                const spinVar = it.rom ? 0.55 + 0.65 * Math.sin(t * 0.9 + it.ph) : 1;
                it.rot += it.vr * spinVar * spdSynth;
                if (it.y > h + 40) {
                    it.y = -30 - Math.random() * Math.max(60, h * 0.35);
                    it.x = Math.random() * w;
                }
                if (it.x < -80) it.x = w + 20;
                if (it.x > w + 80) it.x = -20;
                const pulse = it.rom ? 1 + 0.14 * Math.sin(t * 1.15 + it.ph) + 0.06 * Math.sin(t * 2.3 + it.ph2) : 1;
                it.el.style.transform = `translate(${it.x}px, ${it.y}px) rotate(${it.rot}rad) scale(${pulse})`;
                const opBase = opts.opacityBase != null ? opts.opacityBase : 0.55;
                const op = it.rom ? opBase * (0.82 + 0.18 * Math.sin(t * 1.4 + it.ph2)) : opBase;
                it.el.style.opacity = String(Math.max(0.2, Math.min(1, op)));
            });
            raf = requestAnimationFrame(tick);
        };
        tick();
        if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
            StoryEffects._addCleanup(() => {
                cancelAnimationFrame(raf);
                holder.remove();
            });
        }
    }

    function resolveMediaEl(target) {
        const story = document.getElementById('layer-story');
        const ch = document.getElementById('layer-char');
        const bg = document.getElementById('layer-bg');
        if (target === T.CG && story && story.style.display !== 'none') {
            const m = story.querySelector('img,video');
            if (m) return { el: m, wrap: m.parentElement && m.parentElement !== document.body ? m.parentElement : story };
        }
        if (target === T.SPRITE && ch) {
            const m = ch.querySelector('img');
            if (m) return { el: m, wrap: ch };
        }
        if (story && story.style.display !== 'none') {
            const m = story.querySelector('img,video');
            if (m) return { el: m, wrap: m.parentElement && m.parentElement !== document.body ? m.parentElement : story };
        }
        if (ch) {
            const m = ch.querySelector('img');
            if (m) return { el: m, wrap: ch };
        }
        if (bg) {
            const m = bg.querySelector('img');
            if (m) return { el: m, wrap: bg };
        }
        return { el: null, wrap: null };
    }

    function layerFx() {
        if (_demoHost) return _demoHost;
        return document.getElementById('layer-fx');
    }

    function clearV2Dom() {
        const fx = layerFx();
        if (!fx) return;
        fx.querySelectorAll('[data-sfx-v2]').forEach(n => n.remove());
    }

    function mountOverlay(htmlClass, innerHtml) {
        const fx = layerFx();
        if (!fx) return null;
        const d = document.createElement('div');
        d.dataset.sfxV2 = '1';
        d.className = `fx-overlay ${htmlClass}`;
        d.style.pointerEvents = 'none';
        if (innerHtml) d.innerHTML = innerHtml;
        fx.appendChild(d);
        return d;
    }

    function particleBounds(holder) {
        let w = holder.clientWidth;
        let h = holder.clientHeight;
        if (w < 48 || h < 48) {
            const p = holder.parentElement;
            if (p && p.getBoundingClientRect) {
                const r = p.getBoundingClientRect();
                w = Math.max(48, r.width || 0);
                h = Math.max(48, r.height || 0);
            }
        }
        return { w: Math.max(48, w || 0), h: Math.max(48, h || 0) };
    }

    /** 无粒子图资源时的叠层星光（编辑器小预览与缺资源时仍可见） */
    function mountSyntheticSparkles(count) {
        const fx = layerFx();
        if (!fx) return;
        const holder = document.createElement('div');
        holder.dataset.sfxV2 = '1';
        holder.className = 'fx-overlay';
        const n = count != null ? count : 26;
        for (let i = 0; i < n; i++) {
            const d = document.createElement('div');
            const delay = Math.random() * 3.5;
            const dur = 2.2 + Math.random() * 3;
            d.style.cssText =
                `position:absolute;left:${Math.random() * 100}%;top:${Math.random() * 100}%;width:3px;height:3px;border-radius:50%;` +
                `background:rgba(255,255,255,0.92);box-shadow:0 0 8px 2px rgba(200,220,255,0.85),0 0 14px rgba(160,190,255,0.45);` +
                `animation:fx-twinkle ${dur}s ease-in-out infinite;animation-delay:${delay}s;pointer-events:none;`;
            holder.appendChild(d);
        }
        fx.appendChild(holder);
        if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
            StoryEffects._addCleanup(() => {
                holder.remove();
            });
        }
    }

    /** 浪漫类默认 fallback：柔边光斑，随机大小/色相/闪烁节奏 */
    function mountRomanticBokehFallback(count) {
        const fx = layerFx();
        if (!fx) return;
        const holder = document.createElement('div');
        holder.dataset.sfxV2 = '1';
        holder.className = 'fx-overlay';
        holder.style.mixBlendMode = 'screen';
        const n = count != null ? count : 30;
        for (let i = 0; i < n; i++) {
            const el = document.createElement('div');
            const sz = 4 + Math.random() * 22;
            const hue = 25 + Math.random() * 55;
            const delay = Math.random() * 4;
            const dur = 3 + Math.random() * 4.5;
            el.style.cssText =
                `position:absolute;left:${Math.random() * 100}%;top:${Math.random() * 100}%;width:${sz}px;height:${sz}px;border-radius:50%;` +
                `background:radial-gradient(circle,hsla(${hue},88%,92%,0.55) 0%,hsla(${hue + 15},70%,72%,0.2) 45%,transparent 70%);` +
                `box-shadow:0 0 ${6 + sz * 0.4}px hsla(${hue},85%,88%,0.35);filter:blur(${0.3 + Math.random() * 1.2}px);` +
                `animation:sfx-v2-rom-bokeh-float ${dur}s ease-in-out infinite;animation-delay:${delay}s;pointer-events:none;opacity:0.75;`;
            holder.appendChild(el);
        }
        fx.appendChild(holder);
        if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
            StoryEffects._addCleanup(() => {
                holder.remove();
            });
        }
    }

    /** 幻梦浮生氛围：RAF 漂移的柔光斑（不依赖可能被忽略的 CSS 动画） */
    function mountDriftingDreamBokeh() {
        const fx = layerFx();
        if (!fx) return;
        const holder = document.createElement('div');
        holder.dataset.sfxV2 = '1';
        holder.className = 'fx-overlay';
        holder.style.mixBlendMode = 'screen';
        const n = 28;
        const parts = [];
        for (let i = 0; i < n; i++) {
            const el = document.createElement('div');
            const sz = 5 + Math.random() * 20;
            const hue = 230 + Math.random() * 85;
            el.style.cssText =
                `position:absolute;left:0;top:0;width:${sz}px;height:${sz}px;border-radius:50%;pointer-events:none;` +
                `background:radial-gradient(circle,hsla(${hue},70%,92%,0.5) 0%,hsla(${hue + 20},55%,75%,0.18) 50%,transparent 72%);` +
                `box-shadow:0 0 ${4 + sz * 0.35}px hsla(${hue},65%,88%,0.35);filter:blur(${0.4 + Math.random() * 1}px);will-change:transform,opacity;`;
            holder.appendChild(el);
            parts.push({
                el,
                x: Math.random() * 100,
                y: Math.random() * 100,
                ph: Math.random() * 6.28,
                ph2: Math.random() * 6.28,
                sp: 0.35 + Math.random() * 0.55
            });
        }
        fx.appendChild(holder);
        let raf = 0;
        const t0 = performance.now();
        const tick = now => {
            if (!holder.isConnected) return;
            const t = (now - t0) / 1000;
            parts.forEach(p => {
                const dx = Math.sin(t * p.sp + p.ph) * 3.2 + Math.cos(t * 0.37 + p.ph2) * 1.8;
                const dy = Math.cos(t * p.sp * 0.9 + p.ph2) * 2.8 + Math.sin(t * 0.29 + p.ph) * 1.4;
                p.x = (p.x + dx * 0.035 + 100) % 100;
                p.y = (p.y + dy * 0.032 + 100) % 100;
                const op = 0.35 + 0.45 * Math.sin(t * (1.4 + p.sp) + p.ph);
                const sc = 0.88 + 0.2 * Math.sin(t * 1.8 + p.ph2);
                p.el.style.left = `${p.x}%`;
                p.el.style.top = `${p.y}%`;
                p.el.style.opacity = String(Math.max(0.15, Math.min(0.92, op)));
                p.el.style.transform = `translate(-50%,-50%) scale(${sc})`;
            });
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
            StoryEffects._addCleanup(() => {
                cancelAnimationFrame(raf);
                holder.remove();
            });
        }
    }

    /** 粉色系：RAF 漂移微光斑（入场/氛围用，避免纯 CSS 静止感） */
    function mountDriftingPinkBokeh(count) {
        const fx = layerFx();
        if (!fx) return;
        const holder = document.createElement('div');
        holder.dataset.sfxV2 = '1';
        holder.className = 'fx-overlay';
        holder.style.mixBlendMode = 'screen';
        const n = count != null ? count : 24;
        const parts = [];
        for (let i = 0; i < n; i++) {
            const el = document.createElement('div');
            const sz = 4 + Math.random() * 16;
            const hue = 318 + Math.random() * 38;
            el.style.cssText =
                `position:absolute;left:0;top:0;width:${sz}px;height:${sz}px;border-radius:50%;pointer-events:none;` +
                `background:radial-gradient(circle,hsla(${hue},85%,94%,0.52) 0%,hsla(${hue + 12},70%,78%,0.2) 52%,transparent 74%);` +
                `box-shadow:0 0 ${3 + sz * 0.4}px hsla(${hue},80%,90%,0.38);filter:blur(${0.35 + Math.random() * 0.9}px);will-change:transform,opacity;`;
            holder.appendChild(el);
            parts.push({
                el,
                x: Math.random() * 100,
                y: Math.random() * 100,
                ph: Math.random() * 6.28,
                ph2: Math.random() * 6.28,
                sp: 0.38 + Math.random() * 0.62
            });
        }
        fx.appendChild(holder);
        let raf = 0;
        const t0 = performance.now();
        const tick = now => {
            if (!holder.isConnected) return;
            const t = (now - t0) / 1000;
            parts.forEach(p => {
                const dx = Math.sin(t * p.sp + p.ph) * 3.4 + Math.cos(t * 0.41 + p.ph2) * 1.9;
                const dy = Math.cos(t * p.sp * 0.88 + p.ph2) * 2.6 + Math.sin(t * 0.31 + p.ph) * 1.2 - 0.45;
                p.x = (p.x + dx * 0.036 + 100) % 100;
                p.y = (p.y + dy * 0.034 + 100) % 100;
                const op = 0.38 + 0.48 * Math.sin(t * (1.35 + p.sp) + p.ph);
                const sc = 0.86 + 0.22 * Math.sin(t * 1.75 + p.ph2);
                p.el.style.left = `${p.x}%`;
                p.el.style.top = `${p.y}%`;
                p.el.style.opacity = String(Math.max(0.18, Math.min(0.94, op)));
                p.el.style.transform = `translate(-50%,-50%) scale(${sc})`;
            });
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
            StoryEffects._addCleanup(() => {
                cancelAnimationFrame(raf);
                holder.remove();
            });
        }
    }

    /** 出场像素感：偏紫、略快的 RAF 微粒 */
    function mountExitVioletDrift(count) {
        const fx = layerFx();
        if (!fx) return;
        const holder = document.createElement('div');
        holder.dataset.sfxV2 = '1';
        holder.className = 'fx-overlay';
        holder.style.mixBlendMode = 'screen';
        const n = count != null ? count : 22;
        const parts = [];
        for (let i = 0; i < n; i++) {
            const el = document.createElement('div');
            const sz = 2 + Math.random() * 9;
            const hue = 258 + Math.random() * 42;
            el.style.cssText =
                `position:absolute;left:0;top:0;width:${sz}px;height:${sz}px;border-radius:35%;pointer-events:none;` +
                `background:radial-gradient(circle,hsla(${hue},72%,88%,0.55) 0%,transparent 68%);` +
                `box-shadow:0 0 ${2 + sz}px hsla(${hue},65%,82%,0.35);will-change:transform,opacity;`;
            holder.appendChild(el);
            parts.push({
                el,
                x: Math.random() * 100,
                y: Math.random() * 100,
                ph: Math.random() * 6.28,
                sp: 0.9 + Math.random() * 1.6
            });
        }
        fx.appendChild(holder);
        let raf = 0;
        const t0 = performance.now();
        const tick = now => {
            if (!holder.isConnected) return;
            const t = (now - t0) / 1000;
            parts.forEach(p => {
                p.x += Math.sin(t * p.sp + p.ph) * 0.55 + 0.08;
                p.y -= 0.12 + Math.sin(t * 1.1 + p.ph) * 0.06;
                p.x = (p.x + 100) % 100;
                if (p.y < -2) p.y = 102;
                const op = 0.32 + 0.55 * Math.sin(t * (3 + p.sp * 0.4) + p.ph);
                p.el.style.left = `${p.x}%`;
                p.el.style.top = `${p.y}%`;
                p.el.style.opacity = String(Math.max(0.12, Math.min(0.95, op)));
            });
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
            StoryEffects._addCleanup(() => {
                cancelAnimationFrame(raf);
                holder.remove();
            });
        }
    }

    /** 流光岁月：斜向微光条 + RAF 金白光点漂移 */
    function mountTimeStreamGlints() {
        mountRomanticLightStreaks(2400);
        const fx = layerFx();
        if (!fx) return;
        const holder = document.createElement('div');
        holder.dataset.sfxV2 = '1';
        holder.className = 'fx-overlay';
        holder.style.mixBlendMode = 'screen';
        const parts = [];
        for (let i = 0; i < 36; i++) {
            const el = document.createElement('div');
            const sz = 2 + Math.random() * 5;
            const hue = 40 + Math.random() * 50;
            el.style.cssText =
                `position:absolute;left:0;top:0;width:${sz}px;height:${sz}px;border-radius:50%;` +
                `background:hsla(${hue},90%,92%,0.9);box-shadow:0 0 ${3 + sz}px hsla(${hue},80%,96%,0.65);pointer-events:none;will-change:transform,opacity;`;
            holder.appendChild(el);
            parts.push({
                el,
                x: Math.random() * 100,
                y: Math.random() * 100,
                vx: 0.04 + Math.random() * 0.12,
                ph: Math.random() * 6.28
            });
        }
        fx.appendChild(holder);
        let raf = 0;
        const t0 = performance.now();
        const tick = now => {
            if (!holder.isConnected) return;
            const t = (now - t0) / 1000;
            parts.forEach(p => {
                p.x += p.vx * 0.12 + Math.sin(t * 0.8 + p.ph) * 0.08;
                p.y += Math.sin(t * 0.5 + p.ph) * 0.05;
                if (p.x > 105) p.x = -5;
                const op = 0.4 + 0.55 * Math.sin(t * (2.2 + p.vx * 10) + p.ph);
                p.el.style.left = `${p.x}%`;
                p.el.style.top = `${p.y}%`;
                p.el.style.opacity = String(Math.max(0.2, Math.min(1, op)));
                p.el.style.transform = `translate(-50%,-50%) scale(${0.85 + 0.25 * Math.sin(t * 1.6 + p.ph)})`;
            });
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
            StoryEffects._addCleanup(() => {
                cancelAnimationFrame(raf);
                holder.remove();
            });
        }
    }

    /** 夏末无黄叶资源时：暖色微尘 RAF */
    function mountDriftingWarmSpecks(count) {
        const fx = layerFx();
        if (!fx) return;
        const holder = document.createElement('div');
        holder.dataset.sfxV2 = '1';
        holder.className = 'fx-overlay';
        holder.style.mixBlendMode = 'screen';
        const n = count != null ? count : 28;
        const parts = [];
        for (let i = 0; i < n; i++) {
            const el = document.createElement('div');
            const w = 2 + Math.random() * 4;
            const h = 3 + Math.random() * 7;
            el.style.cssText =
                `position:absolute;left:0;top:0;width:${w}px;height:${h}px;border-radius:40%;` +
                `background:linear-gradient(180deg,hsla(35,90%,88%,0.9),hsla(25,75%,58%,0.25));opacity:0.65;pointer-events:none;`;
            holder.appendChild(el);
            parts.push({
                el,
                x: Math.random() * 100,
                y: Math.random() * 100,
                vy: 0.06 + Math.random() * 0.1,
                vx: -0.04 + Math.random() * 0.08,
                ph: Math.random() * 6.28
            });
        }
        fx.appendChild(holder);
        let raf = 0;
        const t0 = performance.now();
        const tick = now => {
            if (!holder.isConnected) return;
            const t = (now - t0) / 1000;
            parts.forEach(p => {
                p.x += p.vx * 0.1 + Math.sin(t * 0.6 + p.ph) * 0.06;
                p.y += p.vy * 0.12;
                if (p.y > 102) {
                    p.y = -2;
                    p.x = Math.random() * 100;
                }
                p.el.style.left = `${p.x}%`;
                p.el.style.top = `${p.y}%`;
                p.el.style.transform = `translate(-50%,-50%) rotate(${Math.sin(t + p.ph) * 25}deg)`;
            });
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
            StoryEffects._addCleanup(() => {
                cancelAnimationFrame(raf);
                holder.remove();
            });
        }
    }

    /** 星辰契约：稀疏星点 + 极轻氛围，避免大块「罩布」感 */
    function starfieldCovenant() {
        const d = mountOverlay('sfx-v2-stars-covenant fx-starry-night', '');
        if (!d) return;
        d.style.mixBlendMode = 'screen';
        d.style.opacity = '0.92';
        const starN = 48;
        for (let i = 0; i < starN; i++) {
            const s = document.createElement('div');
            s.className = 'fx-star';
            const sz = 1.2 + Math.random() * 2.8;
            s.style.width = `${sz}px`;
            s.style.height = `${sz}px`;
            s.style.left = `${Math.random() * 100}%`;
            s.style.top = `${Math.random() * 100}%`;
            s.style.animationDuration = `${1.6 + Math.random() * 2.8}s`;
            s.style.animationDelay = `${Math.random() * 2}s`;
            s.style.boxShadow = `0 0 ${1.5 + sz}px rgba(230,240,255,0.95)`;
            d.appendChild(s);
        }
        let bg = 0;
        let raf = 0;
        const tick = () => {
            if (!d.isConnected) return;
            bg = (bg + 0.05) % 360;
            d.style.background = `radial-gradient(circle at ${50 + Math.sin(bg * 0.025) * 6}% ${38 + Math.cos(bg * 0.018) * 5}%, rgba(255,255,255,0.07), transparent 38%), radial-gradient(circle at ${72 + Math.cos(bg * 0.02) * 8}% ${62 + Math.sin(bg * 0.016) * 6}%, rgba(200,215,255,0.06), transparent 42%)`;
            raf = requestAnimationFrame(tick);
        };
        tick();
        if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
            StoryEffects._addCleanup(() => {
                cancelAnimationFrame(raf);
                d.remove();
            });
        }
    }

    /** 粒子下落（樱花/黄叶/红叶）；坐标随容器尺寸变化（适配编辑器小预览框） */
    function mountParticleFall(alias, opts = {}) {
        const fx = layerFx();
        if (!fx) return;
        const path = particlePath(alias);
        if (!path) {
            mountSyntheticLeafFall(alias, opts);
            return;
        }
        const holder = document.createElement('div');
        holder.dataset.sfxV2 = '1';
        holder.className = 'fx-overlay fx-particle-fall';
        const spdPart = opts.speedScale != null ? opts.speedScale : 1;
        const n = opts.count != null ? opts.count : 22;
        const items = [];
        for (let i = 0; i < n; i++) {
            const img = document.createElement('img');
            img.src = path;
            img.className = 'fx-particle-img';
            img.draggable = false;
            const sc = (opts.scaleMin != null ? opts.scaleMin : 0.28) + Math.random() * (opts.scaleRand != null ? opts.scaleRand : 0.5);
            img.style.width = `${40 * sc}px`;
            const vx = opts.vxSpread != null ? -opts.vxSpread + Math.random() * (2 * opts.vxSpread) : -0.9 + Math.random() * 1.8;
            const vy = opts.vyMin != null ? opts.vyMin + Math.random() * (opts.vyRand != null ? opts.vyRand : 1.4) : 0.9 + Math.random() * 1.6;
            const rot = Math.random() * Math.PI * 2;
            let vr = opts.spin != null ? (-opts.spin + Math.random() * (2 * opts.spin)) * sc : (-0.02 + Math.random() * 0.04) * sc;
            const rom = !!opts.romantic;
            if (rom) {
                vr *= 0.85 + Math.random() * 1.1;
            }
            items.push({
                el: img,
                x: 0,
                y: 0,
                vx,
                vy,
                rot,
                vr,
                ph: Math.random() * Math.PI * 2,
                ph2: Math.random() * Math.PI * 2,
                rom
            });
            holder.appendChild(img);
        }
        fx.appendChild(holder);
        const layoutSpawn = () => {
            const { w, h } = particleBounds(holder);
            items.forEach(it => {
                it.x = Math.random() * w;
                it.y = -30 - Math.random() * Math.max(80, h * 0.55);
            });
        };
        layoutSpawn();
        requestAnimationFrame(() => requestAnimationFrame(layoutSpawn));
        let raf = 0;
        const tick = () => {
            if (!holder.isConnected) return;
            const t = performance.now() / 1000;
            const { w, h } = particleBounds(holder);
            items.forEach(it => {
                const sway0 = opts.sway ? Math.sin(it.y * 0.012) * opts.sway : 0;
                const swayR = it.rom ? Math.sin(t * 0.85 + it.ph) * 0.55 + Math.cos(t * 0.5 + it.ph2) * 0.35 : 0;
                it.x += (it.vx + sway0 + swayR) * spdPart;
                it.y += (it.vy + (it.rom ? Math.sin(t * 0.62 + it.ph2) * 0.22 : 0)) * spdPart;
                const spinVar = it.rom ? 0.55 + 0.65 * Math.sin(t * 0.9 + it.ph) : 1;
                it.rot += it.vr * spinVar * spdPart;
                if (it.y > h + 40) {
                    it.y = -30 - Math.random() * Math.max(60, h * 0.35);
                    it.x = Math.random() * w;
                }
                if (it.x < -80) it.x = w + 20;
                if (it.x > w + 80) it.x = -20;
                const pulse = it.rom ? 1 + 0.14 * Math.sin(t * 1.15 + it.ph) + 0.06 * Math.sin(t * 2.3 + it.ph2) : 1;
                it.el.style.transform = `translate(${it.x}px, ${it.y}px) rotate(${it.rot}rad) scale(${pulse})`;
                const opBase = opts.opacityBase != null ? opts.opacityBase : 0.55;
                const op = it.rom ? opBase * (0.82 + 0.18 * Math.sin(t * 1.4 + it.ph2)) : opBase;
                it.el.style.opacity = String(Math.max(0.2, Math.min(1, op)));
            });
            raf = requestAnimationFrame(tick);
        };
        tick();
        if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
            StoryEffects._addCleanup(() => {
                cancelAnimationFrame(raf);
                holder.remove();
            });
        }
    }

    /** 编辑器预览等：FX 挂在非 #layer-fx 容器时，在本容器内画雨（全局仍走 StoryEffects） */
    function mountLocalRainCanvas() {
        const fx = layerFx();
        if (!fx) return;
        const c = document.createElement('canvas');
        c.dataset.sfxV2 = '1';
        c.className = 'fx-overlay fx-rain-canvas';
        c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;opacity:0.82;';
        fx.appendChild(c);
        const ctx = c.getContext('2d');
        let drops = [];
        let raf = 0;
        let logW = 320;
        let logH = 180;
        const layout = () => {
            const r = fx.getBoundingClientRect();
            const w = Math.max(80, r.width || fx.clientWidth || 320);
            const h = Math.max(80, r.height || fx.clientHeight || 180);
            logW = w;
            logH = h;
            const dpr = Math.min(2, typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1);
            c.width = Math.floor(w * dpr);
            c.height = Math.floor(h * dpr);
            c.style.width = `${w}px`;
            c.style.height = `${h}px`;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            const n = Math.min(150, Math.max(40, Math.floor((w * h) / 8000)));
            drops = [];
            for (let i = 0; i < n; i++) {
                drops.push({
                    x: Math.random() * w,
                    y: Math.random() * h,
                    len: 8 + Math.random() * 16,
                    speed: 0.7 + Math.random() * 2.2,
                    drift: -0.55 + Math.random() * 1.1
                });
            }
        };
        layout();
        let ro = null;
        if (typeof ResizeObserver !== 'undefined') {
            ro = new ResizeObserver(() => layout());
            ro.observe(fx);
        }
        const tick = () => {
            if (!c.isConnected) return;
            const w = logW;
            const h = logH;
            ctx.clearRect(0, 0, w, h);
            ctx.strokeStyle = 'rgba(200, 220, 255, 0.38)';
            ctx.lineWidth = 1;
            drops.forEach(d => {
                ctx.beginPath();
                ctx.moveTo(d.x, d.y);
                ctx.lineTo(d.x + d.drift * 6, d.y + d.len);
                ctx.stroke();
                d.y += d.speed;
                d.x += d.drift * 0.35;
                if (d.y > h + 12) {
                    d.y = -12;
                    d.x = Math.random() * w;
                }
            });
            raf = requestAnimationFrame(tick);
        };
        tick();
        if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
            StoryEffects._addCleanup(() => {
                cancelAnimationFrame(raf);
                if (ro) try { ro.disconnect(); } catch {}
                c.remove();
            });
        }
    }

    function mountRainCanvas() {
        const fx = layerFx();
        const globalFx = typeof document !== 'undefined' ? document.getElementById('layer-fx') : null;
        if (fx === globalFx && typeof StoryEffects !== 'undefined' && StoryEffects.startOverlay) {
            StoryEffects.startOverlay('rainFine');
            return;
        }
        mountLocalRainCanvas();
    }

    function mountLightningFlashLoop() {
        const fx = layerFx();
        if (!fx) return;
        const flash = document.createElement('div');
        flash.dataset.sfxV2 = '1';
        flash.style.cssText =
            'position:absolute;inset:0;pointer-events:none;background:rgba(255,255,255,0.12);opacity:0;transition:opacity 0.08s;';
        fx.appendChild(flash);
        const iv = window.setInterval(() => {
            if (!flash.isConnected) return;
            flash.style.opacity = Math.random() > 0.65 ? '1' : '0';
            window.setTimeout(() => {
                flash.style.opacity = '0';
            }, 40);
        }, 2200 + Math.random() * 1800);
        if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
            StoryEffects._addCleanup(() => {
                clearInterval(iv);
                flash.remove();
            });
        }
    }

    let _session = null;

    function endSession() {
        _session = null;
    }

    function sourceNeedsDeferredCgClose(src) {
        const s = parseFx(src);
        if (!s || !threePhaseFamily(s.family)) return false;
        return true;
    }

    function shouldSkipCleanupForOverlay(sourceStep, enteringStep, cgSession) {
        if (!cgSession || !cgSession.visualActive || !sourceStep || !enteringStep) return false;
        if (sourceStep.id === enteringStep.id) return false;
        const s = parseFx(sourceStep);
        if (!s) return false;
        if (threePhaseFamily(s.family)) return true;
        // 仅氛围挂在 CG 上时，跨步叠层仍在，不应在进入对白/旁白时清 layer-fx（否则会提前拆掉林间浮光等）
        if (sourceStep.type === 'cg' && s.family === 'rom_ambient') return true;
        if (sourceStep.type === 'cg' && (s.family === 'rom_entry' || s.family === 'rom_exit')) return true;
        return false;
    }

    /** 复合浪漫（入场+氛围）：与组合/冲击互斥；在 clearV2Dom 之前调用 */
    function tryCompoundRomanticEnter(step, cg) {
        const fx = step && step.stepFx;
        if (!fx || typeof fx !== 'object' || Number(fx.v) !== 2) return false;
        const famMain = String(fx.family || '').trim();
        if (famMain === 'rom_combo' || famMain === 'sad_combo' || famMain === 'shock') return false;

        const re = String(fx.romEntryEffect || '').trim();
        const ra = String(fx.romAmbientEffect || '').trim();
        const mainEff = String(fx.effect || '').trim();
        const entryId = re || (famMain === 'rom_entry' ? mainEff : '');
        const ambId = ra || (famMain === 'rom_ambient' ? mainEff : '');
        if (!entryId && !ambId) return false;

        if (cg && cg.visualActive && cg.sourceStep && cg.sourceStep.id !== step.id) {
            if (shouldSkipCleanupForOverlay(cg.sourceStep, step, cg)) return true;
        }

        clearV2Dom();
        endSession();

        const entSpec = entryId
            ? { family: 'rom_entry', effect: entryId, target: resolveEffectTarget('rom_entry', entryId) }
            : null;
        const ambSpec = ambId
            ? { family: 'rom_ambient', effect: ambId, target: resolveEffectTarget('rom_ambient', ambId) }
            : null;
        const pickTarget = ambSpec ? ambSpec.target : entSpec.target;
        const { el, wrap } = resolveMediaEl(pickTarget);

        if (!entSpec) {
            if (!ambSpec) return false;
            const metaA = metaOf(ambSpec.effect);
            _session = {
                stepId: step.id,
                spec: ambSpec,
                meta: metaA,
                phase: 'ambient',
                media: el,
                wrap,
                ambientStarted: true
            };
            runAmbient(ambSpec, el, wrap, metaA);
            return true;
        }

        const metaE = metaOf(entSpec.effect);
        const base = Math.max(200, Math.min(10000, metaE.entryMs != null ? Number(metaE.entryMs) : 1500));
        const ov = readEntryMsOverride(step);
        const entryMs = ov != null ? ov : base;
        _session = { stepId: step.id, spec: entSpec, meta: metaE, phase: 'entry', media: el, wrap };
        runEntry(entSpec, el, wrap, entryMs, () => {
            if (!ambSpec) return;
            if (!_session || _session.stepId !== step.id) return;
            const metaA = metaOf(ambSpec.effect);
            _session = {
                stepId: step.id,
                spec: ambSpec,
                meta: metaA,
                phase: 'ambient',
                media: el,
                wrap,
                ambientStarted: true
            };
            runAmbient(ambSpec, el, wrap, metaA);
        });
        return true;
    }

    /**
     * 三阶段组合在 CG 上：若点「下一条」后 CG 叠层仍延续到下一步（见 SceneManager.isCgOverlayPersistingAfterLeavingThisCgStep），
     * 则不得在 advance 离开 CG 步时播出场（否则会提前拆掉林间浮光等）；出场由 runCgEndExitSequence / 关 layer 时触发。
     */
    function deferComboLeavingExitWhileCgVisualActive(step, spec) {
        if (!spec || !threePhaseFamily(spec.family) || !step || step.type !== 'cg') return false;
        const sm = typeof SceneManager !== 'undefined' ? SceneManager : null;
        const cg = sm && sm._cgSession;
        if (!cg || !cg.visualActive || !cg.sourceStep) return false;
        if (String(cg.sourceStep.id) !== String(step.id)) return false;
        return !!(sm.isCgOverlayPersistingAfterLeavingThisCgStep && sm.isCgOverlayPersistingAfterLeavingThisCgStep(step));
    }

    function onStepEnter(step, ctx = {}) {
        const spec = parseFx(step);
        const cg = ctx.cgSession;
        if (spec && spec.family === 'shock') {
            endSession();
            return;
        }
        if (!spec || exitOnlyFamily(spec.family)) {
            _session = spec && exitOnlyFamily(spec.family) ? { stepId: step.id, spec, phase: 'exit_marker' } : null;
            return;
        }

        if (cg && cg.visualActive && cg.sourceStep && cg.sourceStep.id !== step.id) {
            if (shouldSkipCleanupForOverlay(cg.sourceStep, step, cg)) {
                return;
            }
        }

        if (tryCompoundRomanticEnter(step, cg)) return;

        clearV2Dom();
        endSession();

        const meta = metaOf(spec);
        const { el, wrap } = resolveMediaEl(spec.target);

        if (spec.family === 'rom_ambient') {
            _session = { stepId: step.id, spec, meta, phase: 'ambient', media: el, wrap, ambientStarted: true };
            runAmbient(spec, el, wrap, meta);
            return;
        }
        if (spec.family === 'rom_entry') {
            _session = { stepId: step.id, spec, meta, phase: 'entry', media: el, wrap };
            const base = Math.max(200, Math.min(10000, meta.entryMs != null ? Number(meta.entryMs) : 1500));
            const ov = readEntryMsOverride(step);
            const entryMsOnly = ov != null ? ov : base;
            runEntry(spec, el, wrap, entryMsOnly, () => {});
            return;
        }

        _session = {
            stepId: step.id,
            spec,
            meta,
            phase: 'ambient',
            media: el,
            wrap,
            ambientStarted: false
        };

        const entryBase = meta.entryMs != null ? Number(meta.entryMs) : 1000;
        const entryOv = readEntryMsOverride(step);
        const entryMs = entryOv != null ? entryOv : entryBase;

        runEntry(spec, el, wrap, entryMs, () => {
            if (!_session || _session.stepId !== step.id) return;
            runAmbient(spec, el, wrap, meta);
            _session.ambientStarted = true;
        });
    }

    function runEntry(spec, el, wrap, entryMs, done) {
        const ms = Math.max(200, Math.min(10000, entryMs));
        const id = spec.effect;
        const ease = 'cubic-bezier(0.25, 0.1, 0.25, 1)';

        if (spec.family === 'sad_combo' && id === '镜面破碎') {
            shakeThenCrack(el, wrap);
            if (el && wrap) {
                el.style.opacity = '0';
                el.style.transition = `opacity ${ms}ms ${ease}`;
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        el.style.opacity = '1';
                    });
                });
            }
            window.setTimeout(done, ms);
            if (el && wrap && typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
                StoryEffects._addCleanup(() => {
                    el.style.transition = '';
                    el.style.opacity = '';
                });
            }
            return;
        }
        if (spec.family === 'sad_combo' && id === '像素瓦解') {
            const holdMs = 2000;
            const disintegrateMs = 3200;
            despairPixelDisintegrate(el, wrap, disintegrateMs, holdMs);
            window.setTimeout(done, holdMs + disintegrateMs);
            if (el && wrap && typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
                StoryEffects._addCleanup(() => {
                    el.style.transition = '';
                    el.style.opacity = '';
                    el.style.filter = '';
                    el.style.transform = '';
                });
            }
            return;
        }
        if (spec.family === 'sad_combo' && id === '囚笼禁锢') {
            cageBars();
            if (el && wrap) {
                el.style.opacity = '0';
                el.style.transition = `opacity ${ms}ms ${ease}`;
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        el.style.opacity = '1';
                    });
                });
            }
            window.setTimeout(done, ms);
            if (el && wrap && typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
                StoryEffects._addCleanup(() => {
                    el.style.transition = '';
                    el.style.opacity = '';
                });
            }
            return;
        }
        if (spec.family === 'sad_combo' && id === '泪眼朦胧') {
            liquidWobble();
            if (el && wrap) {
                el.style.opacity = '0';
                el.style.transition = `opacity ${ms}ms ${ease}`;
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        el.style.opacity = '1';
                    });
                });
            }
            window.setTimeout(done, ms);
            if (el && wrap && typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
                StoryEffects._addCleanup(() => {
                    el.style.transition = '';
                    el.style.opacity = '';
                });
            }
            return;
        }

        if (!el || !wrap) {
            window.setTimeout(done, Math.min(ms, 400));
            return;
        }

        if (spec.family === 'rom_entry' && id === '淡入') {
            el.style.opacity = '0';
            el.style.transition = `opacity ${ms}ms ${ease}`;
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    el.style.opacity = '1';
                });
            });
            if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
                StoryEffects._addCleanup(() => {
                    el.style.transition = '';
                    el.style.opacity = '';
                });
            }
            window.setTimeout(done, ms);
            return;
        }

        if (spec.family === 'sad_combo' && id === '深渊坠落') {
            const mask = mountOverlay('sfx-v2-abyss-mask', '');
            if (mask) {
                mask.style.cssText +=
                    'background:#000;opacity:1;transition:opacity 0.4s ease;transform:scale(1.15);transform-origin:center;';
                requestAnimationFrame(() => {
                    mask.style.opacity = '0';
                    mask.style.transition = `opacity ${Math.min(1200, ms)}ms ease, transform ${Math.min(1200, ms)}ms ease`;
                    mask.style.transform = 'scale(1)';
                });
            }
            el.style.transformOrigin = '50% 50%';
            el.style.transform = 'scale(0.92)';
            el.style.transition = `transform ${ms}ms ${ease}, opacity ${ms}ms ease`;
            el.style.opacity = '0';
            requestAnimationFrame(() => {
                el.style.opacity = '1';
                el.style.transform = 'scale(1)';
            });
            window.setTimeout(done, ms);
            if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
                StoryEffects._addCleanup(() => {
                    el.style.transition = '';
                    el.style.transform = '';
                    el.style.opacity = '';
                    if (mask) mask.remove();
                });
            }
            return;
        }

        if (spec.family === 'sad_combo' && id === '残叶凋零') {
            el.style.transformOrigin = '50% 100%';
            el.style.transform = 'scale(0.5)';
            el.style.filter = 'grayscale(0)';
            el.style.transition = `transform ${ms}ms ${ease}, filter 0.6s ease`;
            requestAnimationFrame(() => {
                el.style.transform = 'scale(1)';
                el.style.filter = 'grayscale(1)';
            });
            window.setTimeout(done, ms);
            if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
                StoryEffects._addCleanup(() => {
                    el.style.transition = '';
                    el.style.transform = '';
                });
            }
            return;
        }

        if (spec.family === 'rom_combo' && id === '淡入林间淡出') {
            if (!el || !wrap) {
                window.setTimeout(done, Math.min(ms, 400));
                return;
            }
            el.style.opacity = '0';
            el.style.transition = `opacity ${ms}ms ${ease}`;
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    el.style.opacity = '1';
                });
            });
            window.setTimeout(done, ms);
            if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
                StoryEffects._addCleanup(() => {
                    el.style.transition = '';
                    el.style.opacity = '';
                });
            }
            return;
        }

        if ((spec.family === 'rom_entry' || spec.family === 'rom_combo') && (id === '柔焦转晴' || id === '幻梦浮生')) {
            el.style.opacity = '0';
            el.style.filter = 'blur(28px)';
            el.style.transition = `opacity ${ms}ms ease, filter ${ms}ms ease`;
            requestAnimationFrame(() => {
                el.style.opacity = '1';
                el.style.filter = 'blur(0)';
            });
            window.setTimeout(done, ms);
            if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
                StoryEffects._addCleanup(() => {
                    el.style.transition = '';
                    el.style.filter = '';
                    el.style.opacity = '';
                });
            }
            return;
        }

        if (spec.family === 'rom_combo' && id === '流光岁月') {
            el.style.opacity = '0';
            el.style.filter = 'saturate(1.05)';
            el.style.transition = `opacity ${ms}ms ease, filter ${ms}ms ease, transform ${ms}ms ease`;
            el.style.transform = 'scale(1.02)';
            requestAnimationFrame(() => {
                el.style.opacity = '1';
                el.style.filter = 'saturate(1.12)';
                el.style.transform = 'scale(1)';
            });
            window.setTimeout(done, ms);
            if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
                StoryEffects._addCleanup(() => {
                    el.style.transition = '';
                    el.style.filter = '';
                    el.style.opacity = '';
                    el.style.transform = '';
                });
            }
            return;
        }

        if (spec.family === 'rom_entry' && id === '樱花绽放') {
            el.style.opacity = '0';
            el.style.transition = `opacity ${ms}ms ease`;
            requestAnimationFrame(() => {
                el.style.opacity = '1';
            });
            burstSakura(ms);
            window.setTimeout(done, ms);
            return;
        }

        if (spec.family === 'rom_entry' && id === '金沙铺场') {
            el.style.opacity = '0';
            el.style.transition = `opacity ${ms}ms ease`;
            requestAnimationFrame(() => {
                el.style.opacity = '1';
            });
            goldSandSweep(ms);
            window.setTimeout(done, ms);
            return;
        }

        if (spec.family === 'rom_entry' && id === '暖阳初照') {
            const w = mountOverlay('sfx-v2-warm-sun', '');
            if (w) {
                w.style.cssText +=
                    'mix-blend-mode:screen;background:radial-gradient(circle at 50% 18%,rgba(255,248,220,0.48),rgba(255,230,190,0.2) 42%,transparent 62%);animation:sfx-v2-rom-sacred-pulse 5.5s ease-in-out infinite,sfx-v2-rom-mist-drift 16s ease-in-out infinite;';
            }
            mountDriftingWarmSpecks(22);
            mountGoldMotes({ count: 18 });
            el.style.opacity = '0';
            el.style.filter = 'brightness(0.9) saturate(0.95)';
            el.style.transition = `opacity ${ms}ms ease, filter ${ms}ms ease, transform ${ms}ms ease`;
            el.style.transform = 'scale(1.04)';
            requestAnimationFrame(() => {
                el.style.opacity = '1';
                el.style.filter = 'brightness(1.08) saturate(1.08)';
                el.style.transform = 'scale(1)';
            });
            window.setTimeout(done, ms);
            if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
                StoryEffects._addCleanup(() => {
                    el.style.transition = '';
                    el.style.transform = '';
                    el.style.opacity = '';
                    el.style.filter = '';
                    if (w) w.remove();
                });
            }
            return;
        }

        if (spec.family === 'rom_entry' && id === '星光汇聚') {
            mountRomanticBokehFallback(16);
            mountGoldMotes({ count: 28 });
            el.style.opacity = '0';
            el.style.transition = `opacity ${ms}ms ease, filter ${ms}ms ease`;
            el.style.filter = 'blur(6px)';
            requestAnimationFrame(() => {
                el.style.opacity = '1';
                el.style.filter = 'blur(0)';
            });
            window.setTimeout(done, ms);
            if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
                StoryEffects._addCleanup(() => {
                    el.style.transition = '';
                    el.style.opacity = '';
                    el.style.filter = '';
                });
            }
            return;
        }

        if (spec.family === 'rom_entry' && id === '晨曦揭幕') {
            const c = mountOverlay('sfx-v2-dawn', '');
            if (c) {
                c.style.cssText +=
                    'mix-blend-mode:screen;background:linear-gradient(185deg,rgba(255,245,220,0.45) 0%,rgba(255,220,180,0.12) 38%,transparent 58%);animation:sfx-v2-rom-mist-breathe 4.2s ease-in-out infinite;';
            }
            mountGoldMotes({ count: 20 });
            el.style.opacity = '0';
            el.style.transform = 'translateY(-1.5%)';
            el.style.transition = `opacity ${ms}ms ease, transform ${ms}ms ease`;
            requestAnimationFrame(() => {
                el.style.opacity = '1';
                el.style.transform = 'translateY(0)';
            });
            window.setTimeout(done, ms);
            if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
                StoryEffects._addCleanup(() => {
                    el.style.transition = '';
                    el.style.opacity = '';
                    el.style.transform = '';
                    if (c) c.remove();
                });
            }
            return;
        }

        if (spec.family === 'rom_entry' && id === '涟漪显现') {
            const r = mountOverlay('sfx-v2-ripple', '');
            if (r) {
                r.style.cssText +=
                    'mix-blend-mode:screen;opacity:0.62;background:repeating-radial-gradient(circle at 50% 50%,transparent 0,transparent 6%,rgba(255,255,255,0.1) 7%,transparent 9%),repeating-radial-gradient(circle at 50% 50%,transparent 0,transparent 14%,rgba(255,248,235,0.06) 15%,transparent 17%);animation:sfx-v2-rom-ripple 3.4s ease-out infinite,sfx-v2-rom-mist-drift 14s ease-in-out infinite;';
            }
            mountGoldMotes({ count: 14 });
            el.style.opacity = '0';
            el.style.transform = 'scale(0.96)';
            el.style.transition = `opacity ${ms}ms ease, transform ${ms}ms ease`;
            requestAnimationFrame(() => {
                el.style.opacity = '1';
                el.style.transform = 'scale(1)';
            });
            window.setTimeout(done, ms);
            if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
                StoryEffects._addCleanup(() => {
                    el.style.transition = '';
                    el.style.opacity = '';
                    el.style.transform = '';
                    if (r) r.remove();
                });
            }
            return;
        }

        if (spec.family === 'rom_entry' && id === '流光掠影') {
            mountRomanticLightStreaks(ms);
            mountGoldMotes({ count: 16 });
            el.style.opacity = '0';
            el.style.transition = `opacity ${ms}ms ease, transform ${ms}ms cubic-bezier(0.2,0.85,0.2,1)`;
            el.style.transform = 'translateX(-2.5%) skewX(-0.6deg)';
            requestAnimationFrame(() => {
                el.style.opacity = '1';
                el.style.transform = 'translateX(0) skewX(0deg)';
            });
            window.setTimeout(done, ms);
            if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
                StoryEffects._addCleanup(() => {
                    el.style.transition = '';
                    el.style.opacity = '';
                    el.style.transform = '';
                });
            }
            return;
        }

        if (spec.family === 'rom_entry' && id === '粉色悸动') {
            const p = mountOverlay('sfx-v2-pink-entry', '');
            if (p) {
                p.style.cssText +=
                    'mix-blend-mode:screen;background:radial-gradient(ellipse at 55% 40%,rgba(255,180,210,0.32),transparent 58%);animation:sfx-v2-pink-breath 3.2s ease-in-out infinite;';
            }
            mountDriftingPinkBokeh(20);
            el.style.opacity = '0';
            el.style.transform = 'scale(0.98)';
            el.style.transition = `opacity ${ms}ms ease, transform ${ms}ms ease`;
            requestAnimationFrame(() => {
                el.style.opacity = '1';
                el.style.transform = 'scale(1)';
            });
            window.setTimeout(done, ms);
            if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
                StoryEffects._addCleanup(() => {
                    el.style.transition = '';
                    el.style.opacity = '';
                    el.style.transform = '';
                    if (p) p.remove();
                });
            }
            return;
        }

        /* 默认入场：淡入 + 轻微放大 */
        el.style.opacity = '0';
        el.style.transform = 'scale(0.97)';
        el.style.transition = `opacity ${ms}ms ease, transform ${ms}ms ease`;
        requestAnimationFrame(() => {
            el.style.opacity = '1';
            el.style.transform = 'scale(1)';
        });
        window.setTimeout(done, ms);
        if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
            StoryEffects._addCleanup(() => {
                el.style.transition = '';
                el.style.transform = '';
                el.style.opacity = '';
            });
        }
    }

    function mountRomanticLightStreaks(entryMs) {
        const fx = layerFx();
        if (!fx) return;
        const holder = document.createElement('div');
        holder.dataset.sfxV2 = '1';
        holder.className = 'fx-overlay';
        holder.style.overflow = 'hidden';
        const n = 14;
        for (let i = 0; i < n; i++) {
            const s = document.createElement('div');
            const h = 12 + Math.random() * 36;
            const top = Math.random() * 88;
            const delay = Math.random() * 0.9;
            const dur = 2.8 + Math.random() * 2.4;
            s.style.cssText =
                `position:absolute;left:-40%;top:${top}%;width:55%;height:${h}px;opacity:0;` +
                `transform:rotate(-28deg) translateX(0);transform-origin:center;` +
                `background:linear-gradient(90deg,transparent 0%,rgba(255,255,255,0.03) 20%,rgba(255,250,235,0.22) 50%,rgba(255,255,255,0.04) 80%,transparent 100%);` +
                `filter:blur(${1 + Math.random() * 2}px);` +
                `animation:sfx-v2-rom-streak ${dur}s ease-in-out ${delay}s infinite;pointer-events:none;`;
            holder.appendChild(s);
        }
        fx.appendChild(holder);
        if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
            StoryEffects._addCleanup(() => {
                holder.remove();
            });
        }
    }

    function burstSakura(durationMs) {
        const dur = Math.max(2400, durationMs * 3);
        const path = particlePath('樱花');
        const fx = layerFx();
        if (!fx) return;
        const holder = document.createElement('div');
        holder.dataset.sfxV2 = '1';
        holder.className = 'fx-overlay';
        const cx = 50;
        const cy = 45;
        const n = 7;
        for (let i = 0; i < n; i++) {
            const petal = path ? document.createElement('img') : document.createElement('div');
            petal.style.position = 'absolute';
            petal.style.left = `${cx}%`;
            petal.style.top = `${cy}%`;
            const w = 22 + Math.random() * 18;
            if (path) {
                const img = petal;
                img.src = path;
                img.draggable = false;
                img.style.width = `${w}px`;
            } else {
                petal.style.width = `${w}px`;
                petal.style.height = `${w * 0.68}px`;
                petal.style.borderRadius = '55% 10% 58% 12% / 48% 42% 50% 45%';
                petal.style.background = `linear-gradient(${70 + Math.random() * 40}deg,rgba(255,245,252,0.95),rgba(255,190,210,0.82) 50%,rgba(255,160,190,0.65))`;
                petal.style.boxShadow = '0 0 8px rgba(255,180,200,0.45)';
            }
            const ang = (Math.PI * 2 * i) / n + Math.random() * 0.4;
            const dist = 28 + Math.random() * 18;
            const turn = 1.2 + Math.random() * 3.2;
            const scale0 = 0.75 + Math.random() * 0.35;
            petal.style.filter = 'drop-shadow(0 0 6px rgba(255,200,220,0.45))';
            petal.style.transition = `transform ${dur}ms cubic-bezier(0.2,0.8,0.2,1), opacity ${dur}ms ease`;
            petal.style.transform = `translate(-50%,-50%) rotate(0deg) scale(${scale0})`;
            petal.style.opacity = '1';
            holder.appendChild(petal);
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    petal.style.transform = `translate(-50%,-50%) translate(${Math.cos(ang) * dist}vw, ${Math.sin(ang) * dist}vh) rotate(${turn}turn) scale(${0.85 + Math.random() * 0.35})`;
                    petal.style.opacity = '0.88';
                });
            });
        }
        fx.appendChild(holder);
        window.setTimeout(() => holder.remove(), dur + 120);
    }

    function goldSandSweep(durationMs) {
        const d = mountOverlay('sfx-v2-goldsand', '');
        if (!d) return;
        d.style.mixBlendMode = 'screen';
        d.style.background =
            'linear-gradient(180deg, rgba(255,240,210,0.62), rgba(255,225,175,0.35) 28%, rgba(255,210,150,0.14) 52%, transparent 72%),' +
            'radial-gradient(ellipse at 50% 0%, rgba(255,230,160,0.35), transparent 55%)';
        d.style.opacity = '0';
        d.style.transform = 'translateY(-100%)';
        d.style.transition = `transform ${durationMs}ms ease-out, opacity ${Math.min(400, durationMs)}ms ease`;
        mountGoldMotes({ count: 56 });
        requestAnimationFrame(() => {
            d.style.opacity = '1';
            d.style.transform = 'translateY(0)';
        });
        window.setTimeout(() => d.remove(), durationMs + 200);
    }

    function runAmbient(spec, el, wrap, meta) {
        const id = spec.effect;
        if (spec.family === 'rom_ambient' || spec.family === 'rom_combo' || spec.family === 'sad_combo') {
            if (spec.family === 'rom_combo' && id === '淡入林间淡出') {
                mountRomanticForestDust();
                return;
            }
            if (id === '樱吹雪' || id === '樱舞缘生' || id === '樱瓣追随') {
                mountParticleFall('樱花', {
                    count: id === '樱舞缘生' ? 30 : 26,
                    vxSpread: 1.15,
                    vyMin: 0.65,
                    vyRand: 1.25,
                    sway: 0.52,
                    spin: 0.065,
                    romantic: true,
                    speedScale: 0.32
                });
            } else if (id === '秋日私语' || id === '枫林晚照') {
                mountParticleFall('黄叶', { count: 18, scaleMin: 0.25, scaleRand: 0.45 });
                mountParticleFall('红叶', { count: 14, scaleMin: 0.22, scaleRand: 0.5, vyMin: 0.5, vyRand: 1.1 });
            } else if (id === '红叶祭礼') {
                mountParticleFall('红叶', { count: 36, vxSpread: 0.2, vyMin: 1.2, vyRand: 0.9, spin: 0, opacityBase: 0.7 });
            } else if (id === '萤火微芒' || id === '萤火誓言') {
                fireflies({ oath: id === '萤火誓言' });
            } else if (id === '雨幕长街') {
                mountRainCanvas();
                mountLightningFlashLoop();
                const g = mountOverlay('sfx-v2-rain-tint', '');
                if (g) g.style.cssText += 'background:rgba(28,52,88,0.38);mix-blend-mode:multiply;';
                const mist = mountOverlay('sfx-v2-rain-mist', '');
                if (mist) {
                    mist.style.cssText +=
                        'mix-blend-mode:soft-light;opacity:0.35;background:linear-gradient(175deg,rgba(80,120,180,0.2),transparent 45%);animation:sfx-v2-rom-mist-drift 10s ease-in-out infinite;';
                }
            } else if (id === '残叶凋零') {
                mountParticleFall('黄叶', { count: 30, vxSpread: 0.35, spin: 0.06 });
            } else if (id === '思念回旋') {
                orbitLeaf(el);
            } else if (id === '粉色呼吸' || id === '粉色悸动') {
                const p = mountOverlay('sfx-v2-pink-breath', '');
                if (p) {
                    p.style.background =
                        'radial-gradient(ellipse at 40% 35%,rgba(255,200,220,0.35),transparent 55%),rgba(255, 180, 200, 0.18)';
                    p.style.mixBlendMode = 'screen';
                    p.style.animation = 'sfx-v2-pink-breath 4s ease-in-out infinite, sfx-v2-rom-mist-drift 18s ease-in-out infinite';
                }
                if (id === '粉色悸动') mountDriftingPinkBokeh(22);
                else mountRomanticBokehFallback(12);
            } else if (id === '林间浮光') {
                mountRomanticForestDust();
            } else if (id === '微醺烟霭') {
                mountRomanticWineMist();
            } else if (id === '柔光圣域' || id === '柔光圣城') {
                mountRomanticSacredBloom();
            } else if (id === '幻梦浮生') {
                mountDriftingDreamBokeh();
            } else if (id === '流光岁月') {
                mountTimeStreamGlints();
            } else if (id === '星辰契约') {
                starfieldCovenant();
            } else if (id === '星河璀璨' || id === '一瞬万年') {
                starfieldLight();
                if (id === '一瞬万年') mountRomanticBokehFallback(14);
            } else if (id === '樱之光斑') {
                risingPetalSparkles();
            } else if (id === '金沙转场' || id === '金沙铺场') {
                goldDrift();
            } else if (id === '夏末协奏') {
                const warm = mountOverlay('sfx-v2-late-summer', '');
                if (warm) {
                    warm.style.cssText +=
                        'mix-blend-mode:soft-light;opacity:0.55;background:radial-gradient(ellipse at 55% 20%,rgba(255,230,180,0.35),transparent 50%),linear-gradient(105deg,rgba(255,200,140,0.08),transparent 45%);animation:sfx-v2-rom-mist-drift 12s ease-in-out infinite,sfx-v2-rom-mist-breathe 6s ease-in-out infinite;';
                }
                mountGoldMotes({ count: 26 });
                if (el) {
                    el.style.transition = 'transform 2.2s ease-out, filter 2.2s ease-out';
                    el.style.transform = 'translateX(22px)';
                    el.style.filter = 'sepia(0.08) saturate(1.08)';
                }
                mountParticleFall('黄叶', {
                    count: 22,
                    vyMin: 0.35,
                    vyRand: 1,
                    vxSpread: 0.85,
                    sway: 0.5,
                    spin: 0.055,
                    romantic: true
                });
            } else if (id === '深渊坠落') {
                if (el) {
                    el.style.transition = 'transform 6s ease-out';
                    el.style.transform = 'scale(0.8)';
                }
                smokeRings();
            } else if (id === '时空拉远') {
                if (el) {
                    el.style.transition = 'transform 8s ease-out, filter 8s ease';
                    el.style.transform = 'scale(0.5)';
                    el.style.filter = 'saturate(1.15) hue-rotate(-8deg)';
                }
                purpleVeil();
            } else if (id === '灰烬崩解') {
                emberRise();
            } else if (
                spec.family === 'sad_combo' &&
                (id === '镜面破碎' || id === '像素瓦解' || id === '囚笼禁锢' || id === '泪眼朦胧')
            ) {
                /* 已在 runEntry 挂载，氛围段不再叠默认樱花 */
            } else {
                if (romanticFamily(spec.family)) {
                    mountParticleFall('樱花', { count: 14, sway: 0.42, spin: 0.055, romantic: true });
                } else if (particlePath('樱花')) {
                    mountParticleFall('樱花', { count: 14, sway: 0.42, spin: 0.055, romantic: false });
                } else {
                    mountSyntheticSparkles(28);
                }
            }
        }
    }

    /** 萤火：柔光多层、随机色相/大小/旋转与飘逸轨迹（誓言版略更密） */
    function fireflies(opts) {
        const fx = layerFx();
        if (!fx) return;
        const oath = opts && opts.oath;
        const holder = document.createElement('div');
        holder.dataset.sfxV2 = '1';
        holder.className = 'fx-overlay';
        holder.style.mixBlendMode = 'screen';
        const n = oath ? 56 : 40;
        const dots = [];
        for (let i = 0; i < n; i++) {
            const el = document.createElement('div');
            const sz = 2.2 + Math.random() * (oath ? 12 : 9);
            const warm = Math.random() > 0.28;
            const hue = warm ? 42 + Math.random() * 38 : 195 + Math.random() * 45;
            const s = 70 + Math.random() * 28;
            const l0 = 82 + Math.random() * 14;
            const bg = `radial-gradient(circle at 35% 30%, hsla(${hue},${s}%,${l0}%,0.95) 0%, hsla(${hue + (warm ? -6 : 8)},${s - 8}%,${l0 - 18}%,0.4) 48%, transparent 72%)`;
            const glow1 = 3 + sz * 0.55;
            const glow2 = 6 + sz * 0.9;
            el.style.cssText =
                `position:absolute;left:0;top:0;width:${sz}px;height:${sz}px;border-radius:50%;background:${bg};` +
                `box-shadow:0 0 ${glow1}px ${1 + sz * 0.15}px hsla(${hue},85%,88%,0.5),0 0 ${glow2}px hsla(${warm ? hue + 12 : hue},65%,96%,0.28);` +
                `pointer-events:none;will-change:transform,opacity;transform-origin:center center;`;
            holder.appendChild(el);
            dots.push({
                el,
                x: Math.random() * 100,
                y: Math.random() * 100,
                vx: (-0.022 + Math.random() * 0.044) * (oath ? 1.15 : 1),
                vy: (-0.02 + Math.random() * 0.04) * (oath ? 1.15 : 1),
                ph: Math.random() * Math.PI * 2,
                ph2: Math.random() * Math.PI * 2,
                ph3: Math.random() * Math.PI * 2,
                rot: Math.random() * Math.PI * 2,
                vr: (-0.018 + Math.random() * 0.036) * (oath ? 1.35 : 1),
                wobA: 0.35 + Math.random() * 1.1,
                wobB: 0.28 + Math.random() * 0.95,
                opMul: 0.42 + Math.random() * 0.48
            });
        }
        fx.appendChild(holder);
        let raf = 0;
        const t0 = performance.now();
        const tick = now => {
            if (!holder.isConnected) return;
            const t = (now - t0) / 1000;
            dots.forEach(p => {
                const driftX =
                    Math.sin(t * p.wobA + p.ph) * 2.8 +
                    Math.cos(t * 0.37 * p.wobB + p.ph2) * 1.6 +
                    Math.sin(t * 0.21 + p.ph3) * 1.1;
                const driftY =
                    Math.cos(t * p.wobB * 0.92 + p.ph2) * 2.6 +
                    Math.sin(t * 0.33 * p.wobA + p.ph) * 1.5 +
                    Math.cos(t * 0.19 + p.ph3) * 1.05;
                p.x += p.vx + driftX * 0.018;
                p.y += p.vy + driftY * 0.018;
                if (p.x < -2) p.x = 102;
                if (p.x > 102) p.x = -2;
                if (p.y < -2) p.y = 102;
                if (p.y > 102) p.y = -2;
                p.rot += p.vr * (0.75 + 0.45 * Math.sin(t * 1.1 + p.ph2));
                const pulse = 0.78 + 0.28 * Math.sin(t * (1.6 + p.wobA * 0.4) + p.ph);
                const op = p.opMul * (0.55 + 0.45 * Math.sin(t * (2 + p.wobB * 0.3) + p.ph3));
                p.el.style.left = `${p.x}%`;
                p.el.style.top = `${p.y}%`;
                p.el.style.transform = `translate(-50%,-50%) rotate(${p.rot}rad) scale(${pulse})`;
                p.el.style.opacity = String(Math.max(0.08, Math.min(1, op)));
            });
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
            StoryEffects._addCleanup(() => {
                cancelAnimationFrame(raf);
                holder.remove();
            });
        }
    }

    /** 金沙漂浮微粒（与 goldDrift 底光叠用）；appendTo 时挂入父层并由父层统一移除 */
    function mountGoldMotes(opts) {
        const fx = layerFx();
        if (!fx) return;
        const parent = (opts && opts.appendTo) || fx;
        const count = (opts && opts.count) != null ? opts.count : 48;
        const holder = document.createElement('div');
        holder.dataset.sfxV2 = '1';
        holder.className = 'fx-overlay';
        holder.style.mixBlendMode = 'screen';
        const parts = [];
        for (let i = 0; i < count; i++) {
            const el = document.createElement('div');
            const w = 2 + Math.random() * 5;
            const h = 2 + Math.random() * 7;
            const rot = Math.random() * Math.PI;
            const hue = 38 + Math.random() * 22;
            el.style.cssText =
                `position:absolute;left:0;top:0;width:${w}px;height:${h}px;border-radius:50%;` +
                `background:linear-gradient(${45 + Math.random() * 40}deg,hsla(${hue},92%,88%,0.95),hsla(${hue - 10},80%,58%,0.25),transparent);` +
                `box-shadow:0 0 ${4 + w}px hsla(${hue},90%,80%,0.45);opacity:0.55;pointer-events:none;will-change:transform,opacity;`;
            holder.appendChild(el);
            parts.push({
                el,
                x: Math.random() * 100,
                y: Math.random() * 100,
                vx: -0.03 + Math.random() * 0.06,
                vy: 0.02 + Math.random() * 0.07,
                rot,
                vr: (-0.025 + Math.random() * 0.05) * (0.6 + Math.random()),
                ph: Math.random() * 6.28,
                ph2: Math.random() * 6.28,
                rise: 0.015 + Math.random() * 0.04
            });
        }
        parent.appendChild(holder);
        let raf = 0;
        const t0 = performance.now();
        const tick = now => {
            if (!holder.isConnected) return;
            const t = (now - t0) / 1000;
            parts.forEach(p => {
                p.x += p.vx + Math.sin(t * 0.7 + p.ph) * 0.12;
                p.y -= p.rise + Math.cos(t * 0.55 + p.ph2) * 0.018;
                p.rot += p.vr * (0.8 + 0.4 * Math.sin(t + p.ph));
                if (p.y < -3) {
                    p.y = 103 + Math.random() * 8;
                    p.x = Math.random() * 100;
                }
                if (p.x < -4) p.x = 104;
                if (p.x > 104) p.x = -4;
                const sc = 0.82 + 0.35 * Math.sin(t * 1.4 + p.ph2);
                const op = 0.28 + 0.55 * Math.sin(t * (1.2 + p.vr * 8) + p.ph) * 0.5 + 0.25;
                p.el.style.left = `${p.x}%`;
                p.el.style.top = `${p.y}%`;
                p.el.style.transform = `translate(-50%,-50%) rotate(${p.rot}rad) scale(${sc})`;
                p.el.style.opacity = String(Math.max(0.12, Math.min(0.95, op)));
            });
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        const reg = !(opts && opts.skipRegisterCleanup);
        if (reg && typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
            StoryEffects._addCleanup(() => {
                cancelAnimationFrame(raf);
                holder.remove();
            });
        }
    }

    function mountRomanticForestDust() {
        const fx = layerFx();
        if (!fx) return;
        const root = document.createElement('div');
        root.dataset.sfxV2 = '1';
        root.className = 'fx-overlay sfx-v2-rom-forest';
        root.style.cssText =
            'mix-blend-mode:screen;pointer-events:none;' +
            'background:radial-gradient(ellipse at 20% 30%,rgba(180,255,200,0.14),transparent 55%),radial-gradient(ellipse at 80% 70%,rgba(120,200,255,0.12),transparent 50%);' +
            'animation:sfx-v2-rom-mist-breathe 7s ease-in-out infinite;';
        fx.appendChild(root);
        mountGoldMotes({ appendTo: root, count: 26, skipRegisterCleanup: true });
        if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
            StoryEffects._addCleanup(() => {
                root.remove();
            });
        }
    }

    function mountRomanticWineMist() {
        const a = mountOverlay('sfx-v2-rom-wine', '');
        if (a) {
            a.style.cssText +=
                'mix-blend-mode:screen;opacity:0.88;background:radial-gradient(ellipse at 50% 100%,rgba(120,40,90,0.24),transparent 58%),radial-gradient(ellipse at 30% 20%,rgba(255,160,200,0.16),transparent 50%);animation:sfx-v2-rom-mist-breathe 9s ease-in-out infinite,sfx-v2-rom-mist-drift 14s ease-in-out infinite;';
        }
        mountGoldMotes({ count: 20 });
    }

    function mountRomanticSacredBloom() {
        const a = mountOverlay('sfx-v2-rom-sacred', '');
        if (a) {
            a.style.cssText +=
                'mix-blend-mode:screen;background:radial-gradient(circle at 50% 40%,rgba(255,248,220,0.38),transparent 52%),radial-gradient(circle at 10% 80%,rgba(255,220,180,0.14),transparent 45%);animation:sfx-v2-rom-sacred-pulse 6s ease-in-out infinite;';
        }
        mountGoldMotes({ count: 28 });
    }

    function starfield() {
        const d = mountOverlay('sfx-v2-stars fx-starry-night', '');
        if (!d) return;
        d.style.mixBlendMode = 'screen';
        const starN = 36;
        for (let i = 0; i < starN; i++) {
            const s = document.createElement('div');
            s.className = 'fx-star';
            const sz = 2 + Math.random() * 4;
            s.style.width = `${sz}px`;
            s.style.height = `${sz}px`;
            s.style.left = `${Math.random() * 100}%`;
            s.style.top = `${Math.random() * 100}%`;
            s.style.animationDuration = `${2.5 + Math.random() * 4}s`;
            s.style.animationDelay = `${Math.random() * 2.5}s`;
            s.style.boxShadow = `0 0 ${2 + sz}px rgba(220,235,255,0.85)`;
            d.appendChild(s);
        }
        let bg = 0;
        let raf = 0;
        const tick = () => {
            if (!d.isConnected) return;
            bg = (bg + 0.08) % 360;
            d.style.background = `radial-gradient(circle at ${50 + Math.sin(bg * 0.02) * 10}% ${42 + Math.cos(bg * 0.015) * 8}%, rgba(255,255,255,0.28), transparent 42%), radial-gradient(circle at ${30 + Math.cos(bg * 0.018) * 12}% ${65 + Math.sin(bg * 0.02) * 10}%, rgba(180,200,255,0.18), transparent 50%), rgba(8,6,26,0.42)`;
            raf = requestAnimationFrame(tick);
        };
        tick();
        if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
            StoryEffects._addCleanup(() => {
                cancelAnimationFrame(raf);
                d.remove();
            });
        }
    }

    /** 星河璀璨：更透的底色 + 密星点 + RAF 轻漂移，避免「整块罩布」静止感 */
    function starfieldLight() {
        const d = mountOverlay('sfx-v2-stars-light fx-starry-night', '');
        if (!d) return;
        d.style.mixBlendMode = 'screen';
        d.style.opacity = '0.96';
        const starN = 72;
        for (let i = 0; i < starN; i++) {
            const s = document.createElement('div');
            s.className = 'fx-star';
            const sz = 1 + Math.random() * 3.2;
            s.style.width = `${sz}px`;
            s.style.height = `${sz}px`;
            s.style.left = `${Math.random() * 100}%`;
            s.style.top = `${Math.random() * 100}%`;
            s.style.animationDuration = `${1.4 + Math.random() * 2.6}s`;
            s.style.animationDelay = `${Math.random() * 2}s`;
            s.style.boxShadow = `0 0 ${1.2 + sz}px rgba(230,240,255,0.95)`;
            d.appendChild(s);
        }
        let bg = 0;
        let raf = 0;
        const tick = () => {
            if (!d.isConnected) return;
            bg = (bg + 0.12) % 360;
            d.style.background = `radial-gradient(circle at ${50 + Math.sin(bg * 0.028) * 14}% ${40 + Math.cos(bg * 0.02) * 10}%, rgba(255,255,255,0.12), transparent 46%), radial-gradient(circle at ${28 + Math.cos(bg * 0.022) * 16}% ${68 + Math.sin(bg * 0.024) * 12}%, rgba(200,215,255,0.09), transparent 52%), rgba(12,10,32,0.14)`;
            raf = requestAnimationFrame(tick);
        };
        tick();
        if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
            StoryEffects._addCleanup(() => {
                cancelAnimationFrame(raf);
                d.remove();
            });
        }
    }

    /** 樱之光斑：细碎星点、不规则上升、速度/大小/闪烁各异 */
    function risingPetalSparkles() {
        const fx = layerFx();
        if (!fx) return;
        const holder = document.createElement('div');
        holder.dataset.sfxV2 = '1';
        holder.className = 'fx-overlay';
        holder.style.mixBlendMode = 'screen';
        const n = 68;
        const parts = [];
        for (let i = 0; i < n; i++) {
            const el = document.createElement('div');
            const sz = 1.1 + Math.random() * 3.8;
            const hue = 328 + Math.random() * 28;
            el.style.cssText =
                `position:absolute;left:0;top:0;width:${sz}px;height:${sz}px;border-radius:50%;pointer-events:none;` +
                `background:radial-gradient(circle,hsla(${hue},92%,97%,0.95) 0%,hsla(${hue + 8},75%,82%,0.35) 45%,transparent 72%);` +
                `box-shadow:0 0 ${2 + sz * 1.2}px hsla(${hue},88%,90%,0.55);will-change:transform,opacity;`;
            holder.appendChild(el);
            parts.push({
                el,
                x: Math.random() * 100,
                y: Math.random() * 100,
                vy: 0.012 + Math.random() * 0.055,
                vx: -0.028 + Math.random() * 0.056,
                ph: Math.random() * 6.28,
                sp: 0.35 + Math.random() * 1.25
            });
        }
        fx.appendChild(holder);
        let raf = 0;
        const t0 = performance.now();
        const tick = now => {
            if (!holder.isConnected) return;
            const t = (now - t0) / 1000;
            parts.forEach(p => {
                p.y -= p.vy * (0.75 + 0.35 * Math.sin(t * p.sp + p.ph));
                p.x += p.vx * 0.1 + Math.sin(t * 0.55 + p.ph) * 0.018;
                if (p.y < -1) {
                    p.y = 101 + Math.random() * 6;
                    p.x = Math.random() * 100;
                }
                const tw =
                    0.28 +
                    0.72 *
                        Math.sin(t * (2.1 + p.sp * 1.4) + p.ph) *
                        Math.sin(t * (0.9 + p.sp * 0.5) + p.ph * 1.7);
                const sc = 0.65 + 0.55 * tw;
                p.el.style.left = `${p.x}%`;
                p.el.style.top = `${p.y}%`;
                p.el.style.opacity = String(Math.max(0.15, Math.min(1, tw)));
                p.el.style.transform = `translate(-50%,-50%) scale(${sc})`;
            });
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
            StoryEffects._addCleanup(() => {
                cancelAnimationFrame(raf);
                holder.remove();
            });
        }
    }

    function goldDrift() {
        const d = mountOverlay('sfx-v2-gold-drift', '');
        if (!d) return;
        d.style.mixBlendMode = 'screen';
        d.style.background =
            'linear-gradient(115deg,transparent 0%,rgba(255,230,190,0.08) 32%,rgba(255,245,210,0.2) 50%,rgba(255,210,150,0.1) 68%,transparent 100%),' +
            'radial-gradient(ellipse at 45% 0%,rgba(255,228,160,0.42),transparent 58%),' +
            'radial-gradient(ellipse at 72% 95%,rgba(255,190,120,0.18),transparent 48%)';
        d.style.animation = 'sfx-v2-gold-sheen 10s ease-in-out infinite, sfx-v2-pink-breath 5.5s ease-in-out infinite';
        mountGoldMotes({ count: 52 });
    }

    function orbitLeaf(mediaEl) {
        if (!mediaEl) return;
        const path = particlePath('红叶');
        const leaf = path ? document.createElement('img') : document.createElement('div');
        leaf.dataset.sfxV2 = '1';
        if (path) {
            leaf.src = path;
            leaf.draggable = false;
        } else {
            leaf.style.width = '36px';
            leaf.style.height = '26px';
            leaf.style.borderRadius = '50% 12% 55% 10%';
            leaf.style.background =
                'linear-gradient(125deg,rgba(210,50,35,0.95),rgba(130,25,18,0.88) 50%,rgba(85,12,10,0.82))';
        }
        leaf.style.cssText += `position:absolute;width:36px;pointer-events:none;z-index:5;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.3));`;
        const wrap = mediaEl.parentElement || document.getElementById('layer-char');
        if (!wrap) return;
        if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
        wrap.appendChild(leaf);
        let ang = 0;
        const cx = () => mediaEl.offsetLeft + mediaEl.offsetWidth / 2;
        const cy = () => mediaEl.offsetTop + mediaEl.offsetHeight / 2;
        let raf = 0;
        const tick = () => {
            if (!leaf.isConnected) return;
            ang += 0.019 + Math.sin(ang * 0.08) * 0.004;
            const rx = 78 + Math.sin(ang * 0.7) * 10;
            const ry = 34 + Math.cos(ang * 0.5) * 8;
            const x = cx() + Math.cos(ang) * rx - 18;
            const y = cy() + Math.sin(ang * 2) * ry - 18;
            leaf.style.left = `${x}px`;
            leaf.style.top = `${y}px`;
            leaf.style.transform = `rotate(${ang * 28 + Math.sin(ang * 3) * 12}deg) scale(${0.92 + Math.sin(ang * 2.1) * 0.08})`;
            raf = requestAnimationFrame(tick);
        };
        tick();
        if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
            StoryEffects._addCleanup(() => {
                cancelAnimationFrame(raf);
                leaf.remove();
            });
        }
    }

    function smokeRings() {
        const fx = layerFx();
        if (!fx) return;
        const holder = document.createElement('div');
        holder.dataset.sfxV2 = '1';
        holder.className = 'fx-overlay';
        let raf = 0;
        const parts = [];
        for (let i = 0; i < 20; i++) {
            const d = document.createElement('div');
            d.style.cssText = `position:absolute;width:40px;height:40px;border-radius:50%;background:rgba(0,0,0,0.25);left:50%;top:50%;transform:translate(-50%,-50%);`;
            holder.appendChild(d);
            parts.push({ el: d, t: Math.random() * 2000, sp: 0.15 + Math.random() * 0.25, ang: Math.random() * Math.PI * 2 });
        }
        fx.appendChild(holder);
        const t0 = performance.now();
        const tick = now => {
            if (!holder.isConnected) return;
            const t = now - t0;
            parts.forEach(p => {
                const life = (t + p.t) * p.sp;
                const r = 80 + life * 0.35;
                p.el.style.width = `${r}px`;
                p.el.style.height = `${r}px`;
                p.el.style.opacity = String(Math.max(0, 0.45 - life * 0.0004));
                p.el.style.transform = `translate(-50%,-50%) translate(${Math.cos(p.ang) * life * 0.08}px, ${Math.sin(p.ang) * life * 0.08}px)`;
            });
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
            StoryEffects._addCleanup(() => {
                cancelAnimationFrame(raf);
                holder.remove();
            });
        }
    }

    function shakeThenCrack(el, wrap) {
        const root =
            (wrap && wrap.nodeType === 1 && wrap) ||
            (typeof document !== 'undefined' && document.getElementById('game-canvas')) ||
            (el && el.parentElement) ||
            null;
        let t = 0;
        const prev = root ? root.style.transform : '';
        const iv = window.setInterval(() => {
            t += 50;
            if (!root) {
                clearInterval(iv);
                return;
            }
            if (t < 2000) {
                root.style.transform = `translate(${(Math.random() - 0.5) * 5}px,${(Math.random() - 0.5) * 4}px)`;
            } else {
                root.style.transform = prev || '';
                clearInterval(iv);
            }
        }, 50);
        const crack = mountOverlay('sfx-v2-crack', '');
        if (crack) {
            crack.style.cssText +=
                'background:repeating-linear-gradient(135deg, transparent, transparent 8px, rgba(255,255,255,0.12) 8px, rgba(255,255,255,0.12) 9px), rgba(0,0,0,0.08);mix-blend-mode:overlay;animation:sfx-v2-crack-flash 2.2s ease-in-out infinite;';
        }
        mountExitVioletDrift(10);
        if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
            StoryEffects._addCleanup(() => {
                clearInterval(iv);
                if (root) root.style.transform = prev || '';
                if (crack) crack.remove();
            });
        }
    }

    function glitchDrift(el) {
        if (el) {
            el.style.transition = 'transform 18s linear, filter 18s linear';
            el.style.transform = 'translateX(-18px) skewX(-0.4deg)';
            el.style.filter = 'hue-rotate(4deg) contrast(1.06)';
        }
        const g = mountOverlay('sfx-v2-glitch', '');
        if (g) {
            g.style.cssText +=
                'background-image:repeating-linear-gradient(transparent, transparent 2px, rgba(120,0,180,0.08) 2px, rgba(120,0,180,0.08) 4px);animation:sfx-v2-pink-breath 0.35s steps(2) infinite;mix-blend-mode:overlay;opacity:0.42;';
        }
        const j = mountOverlay('sfx-v2-glitch-jitter', '');
        if (j) {
            j.style.cssText += 'mix-blend-mode:screen;opacity:0.22;background:rgba(80,40,120,0.15);pointer-events:none;';
            let raf = 0;
            const t0 = performance.now();
            const tick = now => {
                if (!j.isConnected) return;
                const t = (now - t0) / 1000;
                j.style.transform = `translate(${(Math.sin(t * 11.2) + Math.sin(t * 17.3)) * 1.8}px,${(Math.cos(t * 9.1) + Math.sin(t * 13.8)) * 1.2}px)`;
                raf = requestAnimationFrame(tick);
            };
            raf = requestAnimationFrame(tick);
            if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
                StoryEffects._addCleanup(() => {
                    cancelAnimationFrame(raf);
                    j.remove();
                });
            }
        }
        mountExitVioletDrift(14);
    }

    function despairPixelDisintegrate(el, wrap, durationMs, holdMs) {
        if (!el) return;
        const host = wrap || el.parentElement || layerFx();
        if (!host) return;
        const hostRect = host.getBoundingClientRect ? host.getBoundingClientRect() : null;
        const elRect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
        if (!hostRect || !elRect || elRect.width < 8 || elRect.height < 8) {
            glitchDrift(el);
            return;
        }
        const prevHostPos = host.style.position || '';
        if (!prevHostPos || prevHostPos === 'static') host.style.position = 'relative';
        const prevOverflow = host.style.overflow || '';
        host.style.overflow = 'hidden';
        const prevTransition = el.style.transition || '';
        const prevOpacity = el.style.opacity || '';
        const prevFilter = el.style.filter || '';
        const prevTransform = el.style.transform || '';
        const ms = Math.max(700, Math.min(5000, Number(durationMs) || 1500));
        const hold = Math.max(0, Number(holdMs) || 0);
        const left = elRect.left - hostRect.left;
        const top = elRect.top - hostRect.top;
        const w = elRect.width;
        const h = elRect.height;
        const holder = document.createElement('div');
        holder.dataset.sfxV2 = '1';
        holder.style.cssText =
            `position:absolute;left:${left}px;top:${top}px;width:${w}px;height:${h}px;` +
            'pointer-events:none;z-index:30;overflow:visible;contain:layout paint;';
        const veil = document.createElement('div');
        veil.dataset.sfxV2 = '1';
        veil.style.cssText =
            'position:absolute;inset:0;pointer-events:none;z-index:29;opacity:0;' +
            'background:radial-gradient(ellipse at 50% 42%,rgba(35,20,55,0.05),rgba(5,3,10,0.72) 74%),linear-gradient(180deg,rgba(20,10,35,0.12),rgba(0,0,0,0.58));' +
            `transition:opacity ${Math.round(ms * 0.72)}ms ease;mix-blend-mode:multiply;`;
        host.appendChild(veil);
        host.appendChild(holder);

        const src = el.currentSrc || el.src || '';
        const cols = Math.max(12, Math.min(26, Math.round(w / 42)));
        const rows = Math.max(7, Math.min(16, Math.round(h / 42)));
        const cw = w / cols;
        const ch = h / rows;
        const blocks = [];
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const b = document.createElement('div');
                const delay = 80 + (x / cols) * 180 + (y / rows) * 260 + Math.random() * 260;
                const dur = ms * (0.62 + Math.random() * 0.34);
                const dx = (Math.random() - 0.5) * 130 + (x - cols / 2) * 2.2;
                const dy = 34 + Math.random() * 120 + y * 4;
                const rot = (Math.random() - 0.5) * 34;
                b.style.cssText =
                    `position:absolute;left:${x * cw}px;top:${y * ch}px;width:${Math.ceil(cw) + 0.6}px;height:${Math.ceil(ch) + 0.6}px;` +
                    'pointer-events:none;will-change:transform,opacity,filter;opacity:1;' +
                    `transition:transform ${dur}ms cubic-bezier(.2,.65,.1,1) ${delay}ms,opacity ${dur}ms ease ${delay}ms,filter ${dur}ms ease ${delay}ms;`;
                if (src) {
                    b.style.backgroundImage = `url("${String(src).replace(/"/g, '\\"')}")`;
                    b.style.backgroundSize = `${w}px ${h}px`;
                    b.style.backgroundPosition = `-${x * cw}px -${y * ch}px`;
                } else {
                    b.style.background = 'linear-gradient(135deg,rgba(185,170,255,0.26),rgba(20,12,32,0.2))';
                }
                b.style.filter = 'grayscale(0.25) contrast(1.04)';
                holder.appendChild(b);
                blocks.push({ b, dx, dy, rot });
            }
        }

        el.style.transition = `opacity ${Math.round(ms * 0.45)}ms ease,filter ${Math.round(ms * 0.65)}ms ease,transform ${Math.round(ms * 0.65)}ms ease`;
        let startTimer = 0;
        const startBreak = () => {
            requestAnimationFrame(() => {
                veil.style.opacity = '1';
                el.style.opacity = '0.08';
                el.style.filter = 'grayscale(1) contrast(0.78) blur(2.5px)';
                el.style.transform = 'scale(0.985) translateY(2px)';
                blocks.forEach(({ b, dx, dy, rot }) => {
                    b.style.opacity = '0';
                    b.style.filter = 'grayscale(1) contrast(0.65) blur(1.6px)';
                    b.style.transform = `translate(${dx}px,${dy}px) rotate(${rot}deg) scale(${0.72 + Math.random() * 0.18})`;
                });
            });
            mountExitVioletDrift(30);
        };
        if (hold > 0) startTimer = window.setTimeout(startBreak, hold);
        else startBreak();
        if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
            StoryEffects._addCleanup(() => {
                if (startTimer) window.clearTimeout(startTimer);
                holder.remove();
                veil.remove();
                host.style.position = prevHostPos;
                host.style.overflow = prevOverflow;
                el.style.transition = prevTransition;
                el.style.opacity = prevOpacity;
                el.style.filter = prevFilter;
                el.style.transform = prevTransform;
            });
        }
    }

    function cageBars() {
        const l = mountOverlay('sfx-v2-cage-left', '');
        const r = mountOverlay('sfx-v2-cage-right', '');
        if (l)
            l.style.cssText +=
                'width:35%;left:0;top:0;bottom:0;background:linear-gradient(90deg,rgba(0,0,0,0.92),transparent);transform:translateX(0);transition:transform 1.2s ease;';
        if (r)
            r.style.cssText +=
                'width:35%;right:0;left:auto;top:0;bottom:0;background:linear-gradient(-90deg,rgba(0,0,0,0.92),transparent);transition:transform 1.2s ease;';
        requestAnimationFrame(() => {
            if (l) l.style.transform = 'translateX(12%)';
            if (r) r.style.transform = 'translateX(-12%)';
        });
        const dust = mountOverlay('sfx-v2-dust', '');
        if (dust) dust.style.cssText += 'background:rgba(255,255,255,0.03);animation:sfx-v2-pink-breath 6s ease-in-out infinite;';
        let raf = 0;
        const ph = Math.random() * 6.28;
        const tick = () => {
            const ok = (l && l.isConnected) || (r && r.isConnected);
            if (!ok) return;
            const wob = Math.sin(performance.now() * 0.0023 + ph) * 0.6;
            if (l && l.isConnected) l.style.transform = `translateX(calc(12% + ${wob}px))`;
            if (r && r.isConnected) r.style.transform = `translateX(calc(-12% + ${-wob}px))`;
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
            StoryEffects._addCleanup(() => {
                cancelAnimationFrame(raf);
            });
        }
    }

    function purpleVeil() {
        const v = mountOverlay('sfx-v2-purple', '');
        if (v) v.style.cssText += 'background:radial-gradient(circle at 50% 50%, rgba(60,20,90,0.25), transparent 70%);animation:sfx-v2-pink-breath 5s ease-in-out infinite;';
    }

    function emberRise() {
        const fx = layerFx();
        if (!fx) return;
        const holder = document.createElement('div');
        holder.dataset.sfxV2 = '1';
        holder.className = 'fx-overlay';
        for (let i = 0; i < 40; i++) {
            const d = document.createElement('div');
            d.style.cssText = `position:absolute;width:${2 + Math.random() * 3}px;height:${2 + Math.random() * 3}px;background:${Math.random() > 0.5 ? 'rgba(40,10,10,0.85)' : 'rgba(180,40,20,0.6)'};left:${20 + Math.random() * 60}%;bottom:0;border-radius:1px;`;
            holder.appendChild(d);
        }
        fx.appendChild(holder);
        let raf = 0;
        const parts = Array.from(holder.children).map(el => ({
            el,
            x: parseFloat(el.style.left),
            y: 100,
            vy: -0.4 - Math.random() * 1.2,
            vx: -0.15 + Math.random() * 0.3
        }));
        const tick = () => {
            if (!holder.isConnected) return;
            parts.forEach(p => {
                p.y += p.vy * 0.15;
                p.x += p.vx * 0.05;
                p.el.style.top = `${p.y}%`;
                p.el.style.left = `${p.x}%`;
                if (p.y < 8) {
                    p.y = 100;
                    p.x = 20 + Math.random() * 60;
                }
            });
            raf = requestAnimationFrame(tick);
        };
        tick();
        if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
            StoryEffects._addCleanup(() => {
                cancelAnimationFrame(raf);
                holder.remove();
            });
        }
    }

    function liquidWobble() {
        const w = mountOverlay('sfx-v2-liquid', '');
        if (w) {
            w.style.cssText +=
                'backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);animation:sfx-v2-liquid-move 3.5s ease-in-out infinite;';
        }
        const m = mountOverlay('sfx-v2-liquid-mist', '');
        if (m) {
            m.style.cssText +=
                'mix-blend-mode:soft-light;opacity:0.42;background:radial-gradient(ellipse at 48% 42%,rgba(200,220,255,0.22),transparent 52%),radial-gradient(ellipse at 62% 58%,rgba(255,210,230,0.14),transparent 48%);animation:sfx-v2-liquid-move 4.2s ease-in-out infinite,sfx-v2-rom-mist-drift 12s ease-in-out infinite;';
        }
        let raf = 0;
        const tear = mountOverlay('sfx-v2-liquid-scan', '');
        if (tear) {
            tear.style.cssText +=
                'mix-blend-mode:overlay;opacity:0.18;background:repeating-linear-gradient(0deg,transparent,transparent 6px,rgba(255,255,255,0.04) 6px,rgba(255,255,255,0.04) 7px);pointer-events:none;';
            const t0 = performance.now();
            const tick = now => {
                if (!tear.isConnected) return;
                const t = (now - t0) / 1000;
                tear.style.transform = `translateY(${Math.sin(t * 1.1) * 2}%) skewX(${Math.sin(t * 0.7) * 0.6}deg)`;
                raf = requestAnimationFrame(tick);
            };
            raf = requestAnimationFrame(tick);
        }
        if (tear && typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
            StoryEffects._addCleanup(() => {
                cancelAnimationFrame(raf);
                if (tear) tear.remove();
            });
        }
    }

    function runExit(spec, el, wrap, exitMs, done) {
        const ms = Math.max(200, Math.min(12000, exitMs));
        const id = spec.effect;
        if (!el) {
            window.setTimeout(done, ms);
            return;
        }
        if (spec.family === 'rom_combo' && id === '淡入林间淡出') {
            el.style.transition = `opacity ${ms}ms ease, filter ${ms}ms ease, transform ${ms}ms ease`;
            el.style.opacity = '0';
            window.setTimeout(done, ms + 40);
            if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
                StoryEffects._addCleanup(() => {
                    el.style.transition = '';
                    el.style.opacity = '';
                    el.style.filter = '';
                    el.style.transform = '';
                });
            }
            return;
        }
        if (id === '淡出' || id === '柔焦隐入' || id === '白光升华') {
            el.style.transition = `opacity ${ms}ms ease, filter ${ms}ms ease, transform ${ms}ms ease`;
            if (id === '柔焦隐入') el.style.filter = 'blur(28px)';
            if (id === '白光升华') {
                el.style.filter = 'brightness(2.8)';
            }
            el.style.opacity = '0';
            window.setTimeout(done, ms + 40);
            if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
                StoryEffects._addCleanup(() => {
                    el.style.transition = '';
                    el.style.opacity = '';
                    el.style.filter = '';
                    el.style.transform = '';
                });
            }
            return;
        }
        if (id === '繁花掩映') {
            mountParticleFall('樱花', { count: 50, vyMin: 2, vyRand: 2.5, vxSpread: 1.5, sway: 0.5, spin: 0.06, romantic: true });
            el.style.transition = `opacity ${ms}ms ease`;
            el.style.opacity = '0';
            window.setTimeout(done, ms + 40);
            return;
        }
        if (id === '红叶祭礼') {
            mountParticleFall('红叶', { count: 80, vyMin: 2.5, vyRand: 2, vxSpread: 0.4, spin: 0 });
            el.style.transition = `opacity ${ms}ms ease`;
            el.style.opacity = '0';
            window.setTimeout(done, ms + 40);
            return;
        }
        if (id === '碎星散去') {
            mountRomanticBokehFallback(26);
            mountGoldMotes({ count: 22 });
            el.style.transition = `opacity ${ms}ms ease, filter ${ms}ms ease`;
            el.style.filter = 'brightness(1.08)';
            el.style.opacity = '0';
            window.setTimeout(done, ms + 40);
            if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
                StoryEffects._addCleanup(() => {
                    el.style.transition = '';
                    el.style.opacity = '';
                    el.style.filter = '';
                });
            }
            return;
        }
        if (id === '纸鹤折叠') {
            mountDriftingPinkBokeh(18);
            el.style.transition = `opacity ${ms}ms ease, transform ${ms}ms cubic-bezier(0.4,0,0.2,1)`;
            el.style.transformOrigin = '50% 58%';
            el.style.transform = 'scale(0.82) rotate(-26deg) skewX(2deg)';
            el.style.opacity = '0';
            window.setTimeout(done, ms + 40);
            if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
                StoryEffects._addCleanup(() => {
                    el.style.transition = '';
                    el.style.opacity = '';
                    el.style.transform = '';
                    el.style.transformOrigin = '';
                });
            }
            return;
        }
        if (id === '流光遁影') {
            mountRomanticLightStreaks(ms);
            el.style.transition = `opacity ${ms * 0.8}ms ease, transform ${ms}ms ease`;
            el.style.transform = 'translateX(5%) skewX(1.8deg)';
            el.style.opacity = '0';
            window.setTimeout(done, ms + 40);
            if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
                StoryEffects._addCleanup(() => {
                    el.style.transition = '';
                    el.style.opacity = '';
                    el.style.transform = '';
                });
            }
            return;
        }
        if (id === '涟漪消散') {
            const rv = mountOverlay('sfx-v2-ripple-exit', '');
            if (rv) {
                rv.style.cssText +=
                    'mix-blend-mode:screen;opacity:0.45;background:repeating-radial-gradient(circle at 50% 50%,transparent 0,transparent 6%,rgba(255,255,255,0.06) 7%,transparent 9%);animation:sfx-v2-rom-ripple 2.2s ease-in-out infinite;';
            }
            el.style.transition = `opacity ${ms}ms ease, transform ${ms}ms ease`;
            el.style.transform = 'scale(0.94)';
            el.style.opacity = '0';
            window.setTimeout(done, ms + 40);
            if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
                StoryEffects._addCleanup(() => {
                    el.style.transition = '';
                    el.style.opacity = '';
                    el.style.transform = '';
                    if (rv) rv.remove();
                });
            }
            return;
        }
        if (id === '像素溶解') {
            mountExitVioletDrift(26);
            const scan = mountOverlay('sfx-v2-pixel-dissolve', '');
            if (scan) {
                scan.style.cssText +=
                    'mix-blend-mode:overlay;opacity:0.35;background-image:repeating-linear-gradient(90deg,transparent,transparent 3px,rgba(180,160,255,0.07) 3px,rgba(180,160,255,0.07) 4px);animation:sfx-v2-pink-breath 0.45s steps(2) infinite;';
            }
            el.style.transition = `opacity ${ms}ms ease, filter ${ms}ms ease, transform ${ms}ms ease`;
            el.style.filter = 'blur(6px) contrast(1.15) hue-rotate(6deg)';
            el.style.transform = 'scale(0.94) translate(4px,-2px)';
            el.style.opacity = '0';
            window.setTimeout(done, ms + 40);
            if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
                StoryEffects._addCleanup(() => {
                    el.style.transition = '';
                    el.style.opacity = '';
                    el.style.filter = '';
                    el.style.transform = '';
                    if (scan) scan.remove();
                });
            }
            return;
        }
        el.style.transition = `opacity ${ms}ms ease, transform ${ms}ms ease`;
        el.style.opacity = '0';
        el.style.transform = 'translateY(18%) scale(0.96)';
        window.setTimeout(done, ms + 40);
        if (typeof StoryEffects !== 'undefined' && StoryEffects._addCleanup) {
            StoryEffects._addCleanup(() => {
                el.style.transition = '';
                el.style.opacity = '';
                el.style.transform = '';
            });
        }
    }

    function getLeavingExitDelayMs(step) {
        const sCombo = parseFx(step);
        if (!sCombo) return -1;
        if (deferComboLeavingExitWhileCgVisualActive(step, sCombo)) {
            return -1;
        }
        if (threePhaseFamily(sCombo.family)) {
            const m = metaOf(sCombo);
            const base = Math.max(200, Math.min(12000, m.exitMs != null ? Number(m.exitMs) : 1000));
            const ex = readExitMsOverride(step);
            return ex != null ? ex : base;
        }
        const sExit = leavingExitPlaySpec(step);
        if (sExit && exitOnlyFamily(sExit.family)) {
            const m = metaOf(sExit);
            const base = Math.max(200, Math.min(12000, m.exitMs != null ? Number(m.exitMs) : 1000));
            const ex = readExitMsOverride(step);
            return ex != null ? ex : base;
        }
        return -1;
    }

    function playLeavingExit(step, then) {
        const sCombo = parseFx(step);
        if (!sCombo) {
            if (then) then();
            return;
        }
        if (deferComboLeavingExitWhileCgVisualActive(step, sCombo)) {
            if (then) then();
            return;
        }
        if (threePhaseFamily(sCombo.family)) {
            const { el } = resolveMediaEl(sCombo.target);
            const m = metaOf(sCombo);
            const baseMs = Math.max(200, Math.min(12000, m.exitMs != null ? Number(m.exitMs) : 1000));
            const ms = readExitMsOverride(step) != null ? readExitMsOverride(step) : baseMs;
            runExit(sCombo, el, null, ms, then);
            return;
        }
        const sExit = leavingExitPlaySpec(step);
        if (sExit && exitOnlyFamily(sExit.family)) {
            const { el } = resolveMediaEl(sExit.target);
            const m = metaOf(sExit);
            const baseMs = Math.max(200, Math.min(12000, m.exitMs != null ? Number(m.exitMs) : 1000));
            const ms = readExitMsOverride(step) != null ? readExitMsOverride(step) : baseMs;
            runExit(sExit, el, null, ms, then);
            return;
        }
        if (then) then();
    }

    function runCgEndExitSequence(sourceStep, scene, onDone) {
        const sCombo = parseFx(sourceStep);
        const pickTarget = sCombo ? sCombo.target : T.ALL;
        const { el } = resolveMediaEl(pickTarget);
        const msFor = spec => {
            const m = metaOf(spec);
            const baseMs = Math.max(200, Math.min(12000, m.exitMs != null ? Number(m.exitMs) : 1000));
            return readExitMsOverride(sourceStep) != null ? readExitMsOverride(sourceStep) : baseMs;
        };
        if (sCombo && threePhaseFamily(sCombo.family)) {
            runExit(sCombo, el, null, msFor(sCombo), onDone);
        } else {
            const sX = leavingExitPlaySpec(sourceStep);
            if (sX && exitOnlyFamily(sX.family)) {
                runExit(sX, el, null, msFor(sX), onDone);
            } else if (onDone) {
                onDone();
            }
        }
    }

    function isVideoPreviewUrl(u) {
        const s = String(u || '').toLowerCase();
        return /\.(mp4|webm|ogg|mov|m4v|avi)(\?|#|$)/i.test(s) || s.startsWith('data:video');
    }

    function appendDemoMedia(box, url, placeholderNoImage) {
        let mediaEl;
        if (url) {
            if (isVideoPreviewUrl(url)) {
                const vid = document.createElement('video');
                vid.src = url;
                vid.muted = true;
                vid.loop = true;
                vid.playsInline = true;
                vid.autoplay = true;
                vid.draggable = false;
                vid.style.cssText =
                    'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;';
                mediaEl = vid;
                vid.onerror = () => {
                    const ph = placeholderNoImage();
                    try {
                        vid.replaceWith(ph);
                    } catch {
                        box.appendChild(ph);
                    }
                    mediaEl = ph;
                };
                box.appendChild(vid);
            } else {
                const img = document.createElement('img');
                img.src = url;
                img.draggable = false;
                img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;';
                mediaEl = img;
                img.onerror = () => {
                    const ph = placeholderNoImage();
                    try {
                        img.replaceWith(ph);
                    } catch {
                        box.appendChild(ph);
                    }
                    mediaEl = ph;
                };
                box.appendChild(img);
            }
        } else {
            mediaEl = placeholderNoImage();
            box.appendChild(mediaEl);
        }
        return mediaEl;
    }

    /** 编辑器演示：2s 入场 + 3s 氛围 + 2s 出场（仅预览容器内）；durationOverrides 可含 entryMs / exitMs */
    function playDemo(rootEl, family, target, effectId, imgUrl, durationOverrides) {
        if (!rootEl) return;
        _demoHost = null;
        rootEl.innerHTML = '';
        const fakeStep = { id: 'demo', stepFx: { v: 2, family, target, effect: effectId } };
        const spec = parseFx(fakeStep);
        if (!spec || spec.family === 'shock') {
            const p = document.createElement('p');
            p.style.cssText = 'color:#888;padding:12px;font-size:13px;';
            p.textContent = spec && spec.family === 'shock' ? '立绘特效' : '请选择特效。';
            rootEl.appendChild(p);
            return;
        }
        const box = document.createElement('div');
        box.style.cssText =
            'position:relative;width:100%;aspect-ratio:16/9;background:#111;overflow:hidden;border-radius:8px;border:1px solid #444;';
        const url = String(imgUrl || '').trim();
        function placeholderNoImage() {
            const d = document.createElement('div');
            d.dataset.sfxDemoPh = '1';
            d.style.cssText =
                'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
                'background:linear-gradient(145deg,#1a1a24,#0d0d12);color:#888;font-size:12px;text-align:center;padding:8px;';
            d.textContent = '未找到 CG / 背景 / 立绘 预览图；请在资源库注册或在项目中配置人物立绘。';
            return d;
        }
        const mediaEl = appendDemoMedia(box, url, placeholderNoImage);
        const fxHost = document.createElement('div');
        fxHost.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:2;';
        box.appendChild(fxHost);
        rootEl.appendChild(box);

        _demoHost = fxHost;
        const demo = StoryFxCatalog.demoDurationsMs();
        const meta = StoryFxCatalog.meta(effectId) || {};
        const ov = durationOverrides && typeof durationOverrides === 'object' ? durationOverrides : null;
        const entryMsUse =
            ov && ov.entryMs != null ? Math.max(200, Math.min(10000, Number(ov.entryMs))) : demo.entry;
        const exitMsUse = ov && ov.exitMs != null ? Math.max(200, Math.min(12000, Number(ov.exitMs))) : demo.exit;
        runEntry(spec, mediaEl, box, entryMsUse, () => {
            runAmbient(spec, mediaEl, box, meta);
            window.setTimeout(() => {
                runExit(spec, mediaEl, box, exitMsUse, () => {
                    _demoHost = null;
                    try {
                        fxHost.innerHTML = '';
                    } catch {}
                    try {
                        mediaEl.style.opacity = '1';
                        mediaEl.style.filter = '';
                        mediaEl.style.transform = '';
                    } catch {}
                });
            }, demo.ambient);
        });
    }

    /** 编辑器：复合浪漫入场+氛围预览（与 tryCompoundRomanticEnter 一致，不含出场） */
    function playCompoundRomanticDemo(rootEl, fxLike, imgUrl) {
        if (!rootEl || !fxLike) return;
        const re = String(fxLike.romEntryEffect || '').trim();
        const ra = String(fxLike.romAmbientEffect || '').trim();
        if (!re && !ra) return;
        _demoHost = null;
        rootEl.innerHTML = '';
        const box = document.createElement('div');
        box.style.cssText =
            'position:relative;width:100%;aspect-ratio:16/9;background:#111;overflow:hidden;border-radius:8px;border:1px solid #444;';
        const url = String(imgUrl || '').trim();
        function placeholderNoImage() {
            const d = document.createElement('div');
            d.dataset.sfxDemoPh = '1';
            d.style.cssText =
                'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
                'background:linear-gradient(145deg,#1a1a24,#0d0d12);color:#888;font-size:12px;text-align:center;padding:8px;';
            d.textContent = '未找到 CG / 背景 / 立绘 预览图；请在资源库注册或在项目中配置人物立绘。';
            return d;
        }
        const mediaEl = appendDemoMedia(box, url, placeholderNoImage);
        const fxHost = document.createElement('div');
        fxHost.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:2;';
        box.appendChild(fxHost);
        rootEl.appendChild(box);
        _demoHost = fxHost;

        const stub = { id: 'demoCompound', stepFx: { v: 2, entrySec: fxLike.entrySec, exitSec: fxLike.exitSec } };
        const entSpec = re
            ? { family: 'rom_entry', effect: re, target: resolveEffectTarget('rom_entry', re) }
            : null;
        const ambSpec = ra
            ? { family: 'rom_ambient', effect: ra, target: resolveEffectTarget('rom_ambient', ra) }
            : null;

        const resetMedia = () => {
            try {
                mediaEl.style.opacity = '1';
                mediaEl.style.filter = '';
                mediaEl.style.transform = '';
            } catch {}
        };

        if (!entSpec) {
            if (ambSpec) {
                const metaA = metaOf(ambSpec.effect);
                runAmbient(ambSpec, mediaEl, box, metaA);
            }
            window.setTimeout(() => {
                _demoHost = null;
                try {
                    fxHost.innerHTML = '';
                } catch {}
                resetMedia();
            }, StoryFxCatalog.demoDurationsMs().ambient + 400);
            return;
        }

        const metaE = metaOf(entSpec.effect);
        const base = Math.max(200, Math.min(10000, metaE.entryMs != null ? Number(metaE.entryMs) : 1500));
        const entryMs = readEntryMsOverride(stub) != null ? readEntryMsOverride(stub) : base;
        runEntry(entSpec, mediaEl, box, entryMs, () => {
            if (!ambSpec) {
                _demoHost = null;
                try {
                    fxHost.innerHTML = '';
                } catch {}
                resetMedia();
                return;
            }
            const metaA = metaOf(ambSpec.effect);
            runAmbient(ambSpec, mediaEl, box, metaA);
            window.setTimeout(() => {
                _demoHost = null;
                try {
                    fxHost.innerHTML = '';
                } catch {}
                resetMedia();
            }, StoryFxCatalog.demoDurationsMs().ambient + 400);
        });
    }

    return {
        T,
        parseFx,
        metaOf,
        threePhaseFamily,
        sourceNeedsDeferredCgClose,
        shouldSkipCleanupForOverlay,
        onStepEnter,
        clearV2Dom,
        getLeavingExitDelayMs,
        playLeavingExit,
        runCgEndExitSequence,
        resolveMediaEl,
        playDemo,
        playCompoundRomanticDemo
    };
})();
