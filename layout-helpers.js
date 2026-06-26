/**
 * layout-helpers.js - 背景/立绘等比布局（与编辑器、运行端共用逻辑）
 */
const LayoutHelpers = {
    VIEW_W: 1280,
    VIEW_H: 720,

    normalizeBackground(bg) {
        const b = bg || {};
        const ox = Number(b.offsetX);
        const oy = Number(b.offsetY);
        const fx = Number(b.fitPanX);
        const fy = Number(b.fitPanY);
        const legacyCenteredOffset =
            Number(b.width) === 1920 &&
            Number(b.height) === 1080 &&
            Number(b.scale == null ? 1 : b.scale) === 1 &&
            Number.isFinite(ox) &&
            Number.isFinite(oy) &&
            ox === 320 &&
            oy === 180 &&
            Number.isFinite(fx) &&
            Number.isFinite(fy) &&
            fx === ox &&
            fy === oy;
        const fitPanX = legacyCenteredOffset ? 0 : b.fitPanX != null ? b.fitPanX : b.offsetX != null ? b.offsetX : 0;
        const fitPanY = legacyCenteredOffset ? 0 : b.fitPanY != null ? b.fitPanY : b.offsetY != null ? b.offsetY : 0;
        const fitZoom = b.fitZoom != null ? b.fitZoom : b.scale != null ? b.scale : 1;
        return { ...b, fitPanX, fitPanY, fitZoom };
    },

    normalizeCharacterLayout(ch) {
        const c = ch || {};
        const layout = c.layout || {};
        return {
            panX: layout.panX != null ? layout.panX : 0,
            panY: layout.panY != null ? layout.panY : 0,
            zoom: layout.zoom != null && layout.zoom > 0 ? layout.zoom : 1
        };
    },

    /** 将图片以「contain」放入视口后，再乘 fitZoom 并做平移；不拉伸变形 */
    applyBackgroundContain(img, bgNorm) {
        const iw = img.naturalWidth || 1;
        const ih = img.naturalHeight || 1;
        const baseContain = Math.min(this.VIEW_W / iw, this.VIEW_H / ih);
        const s = baseContain * (bgNorm.fitZoom != null ? bgNorm.fitZoom : 1);
        const dispW = iw * s;
        const dispH = ih * s;
        const ox = (this.VIEW_W - dispW) / 2 + (bgNorm.fitPanX || 0);
        const oy = (this.VIEW_H - dispH) / 2 + (bgNorm.fitPanY || 0);
        img.style.width = `${dispW}px`;
        img.style.height = `${dispH}px`;
        img.style.left = `${ox}px`;
        img.style.top = `${oy}px`;
        img.style.position = 'absolute';
        img.style.objectFit = 'fill';
        img.style.maxWidth = 'none';
        img.style.maxHeight = 'none';
    }
};

/** 场景 → 立绘资源路径（编辑器与运行端共用，不依赖 renderer.js） */
const CharacterBinding = {
    resolveSpriteUrl(scene, projectData) {
        if (!scene) return null;
        if (scene.characterRef && projectData && projectData.characterRoster) {
            const c = projectData.characterRoster.find(x => x.id === scene.characterRef);
            if (c && c.expressions) {
                const keys = Object.keys(c.expressions).filter(k => !k.startsWith('__pending_'));
                const key =
                    (scene.expression && c.expressions[scene.expression] && scene.expression) ||
                    (c.defaultExpression && c.expressions[c.defaultExpression] && c.defaultExpression) ||
                    keys[0];
                const slot = key ? c.expressions[key] : null;
                if (slot && slot.spriteAsset) {
                    const alias = slot.spriteAsset;
                    return typeof AssetManager !== 'undefined' && AssetManager.resolveMediaUrl
                        ? AssetManager.resolveMediaUrl('characters', alias)
                        : typeof AssetManager !== 'undefined' && AssetManager.getPath
                          ? AssetManager.getPath('characters', alias) || alias
                          : alias;
                }
            }
        }
        if (scene.character && scene.character.url) {
            const alias = scene.character.url;
            return typeof AssetManager !== 'undefined' && AssetManager.resolveMediaUrl
                ? AssetManager.resolveMediaUrl('characters', alias)
                : typeof AssetManager !== 'undefined' && AssetManager.getPath
                  ? AssetManager.getPath('characters', alias) || alias
                  : alias;
        }
        return null;
    },

    /**
     * 对白说话人引用：支持正文同款「{记忆槽}」占位；解析后若为人物中文名则转为名册 id（立绘按 id 查找）。
     */
    resolveSpeakerRefToCharacterId(rawRef, projectData) {
        const roster = projectData && projectData.characterRoster ? projectData.characterRoster : [];
        let ref = String(rawRef || '').trim();
        if (!ref) return '';
        if (typeof GameState !== 'undefined' && GameState.get) {
            ref = ref.replace(/\{([^}]+)\}/g, (_, key) => {
                const k = String(key || '').trim();
                if (!k) return '';
                const v = GameState.get(k);
                return v != null && v !== undefined ? String(v) : '';
            }).trim();
        }
        if (!ref) return '';
        if (roster.some(x => x && x.id === ref)) return ref;
        const byName = roster.find(x => x && String((x.name || '').trim()) === ref);
        return byName && byName.id ? byName.id : ref;
    },

    resolveExpressionSlotForStep(scene, step, projectData) {
        const roster = projectData && projectData.characterRoster ? projectData.characterRoster : [];
        const rawSp = (step && step.speakerRef) || (scene && scene.characterRef) || '';
        const speakerRef = this.resolveSpeakerRefToCharacterId(rawSp, projectData);
        const exprKey = (step && step.expression) || (scene && scene.expression) || '';
        if (!speakerRef) return null;
        const c = roster.find(x => x && x.id === speakerRef);
        if (!c || !c.expressions) return null;
        const keys = Object.keys(c.expressions).filter(k => !k.startsWith('__pending_'));
        const key =
            (exprKey && c.expressions[exprKey] && exprKey) ||
            (c.defaultExpression && c.expressions[c.defaultExpression] && c.defaultExpression) ||
            keys[0];
        const slot = key ? c.expressions[key] : null;
        return slot ? { character: c, expressionKey: key, slot } : null;
    },

    resolveDefaultLayoutForStep(scene, step, projectData) {
        const hit = this.resolveExpressionSlotForStep(scene, step, projectData);
        const layout = hit && hit.slot && hit.slot.defaultLayout;
        if (!layout || typeof layout !== 'object') return null;
        const raw = layout.layout && typeof layout.layout === 'object' ? layout.layout : layout;
        return LayoutHelpers.normalizeCharacterLayout({ layout: raw });
    },

    /** 步骤 → 立绘资源路径（优先用 step.speakerRef / step.expression） */
    resolveSpriteUrlForStep(scene, step, projectData) {
        const roster = projectData && projectData.characterRoster ? projectData.characterRoster : [];
        const rawSp = (step && step.speakerRef) || (scene && scene.characterRef) || '';
        const speakerRef = this.resolveSpeakerRefToCharacterId(rawSp, projectData);
        const exprKey = (step && step.expression) || (scene && scene.expression) || '';
        if (speakerRef) {
            const c = roster.find(x => x.id === speakerRef);
            if (c && c.expressions) {
                const keys = Object.keys(c.expressions).filter(k => !k.startsWith('__pending_'));
                const key =
                    (exprKey && c.expressions[exprKey] && exprKey) ||
                    (c.defaultExpression && c.expressions[c.defaultExpression] && c.defaultExpression) ||
                    keys[0];
                const slot = key ? c.expressions[key] : null;
                if (slot && slot.spriteAsset) {
                    const alias = slot.spriteAsset;
                    return typeof AssetManager !== 'undefined' && AssetManager.resolveMediaUrl
                        ? AssetManager.resolveMediaUrl('characters', alias)
                        : typeof AssetManager !== 'undefined' && AssetManager.getPath
                          ? AssetManager.getPath('characters', alias) || alias
                          : alias;
                }
            }
        }
        // fallback：旧版单图立绘
        if (scene && scene.character && scene.character.url) {
            const alias = scene.character.url;
            return typeof AssetManager !== 'undefined' && AssetManager.resolveMediaUrl
                ? AssetManager.resolveMediaUrl('characters', alias)
                : typeof AssetManager !== 'undefined' && AssetManager.getPath
                  ? AssetManager.getPath('characters', alias) || alias
                  : alias;
        }
        return null;
    }
};
