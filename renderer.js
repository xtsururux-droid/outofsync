/**
 * renderer.js - 视觉渲染核心 (别名解析 + 等比布局)
 */
const Renderer = {
    storyData: null,
    imageCache: {},

    resolveCharacterSpriteUrl(scene) {
        return CharacterBinding.resolveSpriteUrl(scene, this.storyData);
    },

    /**
     * @param {object} data 项目数据
     * @param {{ sceneId?: string, fragmentId?: string, continueSnapshot?: object } | null} launchOpts 片段预览 / 继续游戏读档
     */
    async init(data, launchOpts = null) {
        this.storyData = data;
        this._activateProjectResourceScope(data);
        if (typeof AssetManager !== 'undefined' && AssetManager.init) {
            AssetManager.init();
            if (AssetManager.repairProjectEmbedded) AssetManager.repairProjectEmbedded(data);
            AssetManager.applyProjectEmbedded(data.embeddedAssetLibrary || null);
            if (typeof AssetCatalogTypes !== 'undefined' && AssetCatalogTypes.verifyManagerShape) {
                AssetCatalogTypes.verifyManagerShape(AssetManager, 'BU 运行端');
            }
            if (AssetManager.auditEmbeddedAssetsForRuntime) {
                AssetManager.auditEmbeddedAssetsForRuntime().catch(() => {});
            }
        }
        if (typeof SceneManager !== 'undefined' && SceneManager.init) {
            SceneManager.init(data);
        }
        if (typeof CustomUiRuntime !== 'undefined' && CustomUiRuntime.apply) {
            CustomUiRuntime.apply(data);
        }
        await this.preloadAllResources();
        this.setupEvents();
        const sid = launchOpts && launchOpts.sceneId;
        const fid = launchOpts && launchOpts.fragmentId;
        const cont = launchOpts && launchOpts.continueSnapshot;
        if (sid && fid && typeof SceneManager !== 'undefined') {
            SceneManager.jumpToScene(sid, '', { skipEnterStep: true, skipFragmentActivate: true });
            const ok =
                typeof SceneManager.enterFragment === 'function'
                    ? SceneManager.enterFragment(fid, sid, '', { editorPreview: true })
                    : false;
            if (!ok && typeof console !== 'undefined' && console.warn) {
                console.warn('[Renderer] 片段预览进入失败，留在场景', sid, '首步');
            }
        } else if (cont && typeof PlaySave !== 'undefined' && PlaySave.restoreAndEnter) {
            const ok = PlaySave.restoreAndEnter(data, cont);
            if (!ok) {
                if (typeof console !== 'undefined' && console.warn) {
                    console.warn('[Renderer] 读档失败，改为新游戏');
                }
                const firstId = (data.scenes && data.scenes[0] && data.scenes[0].id) || 'start';
                SceneManager.jumpTo(firstId);
            }
        } else {
            const firstId = (data.scenes && data.scenes[0] && data.scenes[0].id) || 'start';
            SceneManager.jumpTo(firstId);
        }
    },

    _resolveBootEntry(data, launchOpts) {
        const cont = launchOpts && launchOpts.continueSnapshot;
        if (cont && cont.sceneId) {
            return {
                sceneId: String(cont.sceneId || '').trim(),
                labelSuffix: cont.labelSuffix != null ? String(cont.labelSuffix).trim() : ''
            };
        }
        if (launchOpts && launchOpts.sceneId) {
            return { sceneId: String(launchOpts.sceneId).trim(), labelSuffix: '' };
        }
        const firstId = (data.scenes && data.scenes[0] && data.scenes[0].id) || 'start';
        return { sceneId: firstId, labelSuffix: '' };
    },

    _bootStepIndex(scene, labelSuffix) {
        const steps = scene && Array.isArray(scene.steps) ? scene.steps : [];
        const lab = String(labelSuffix || '').trim();
        if (!lab) return 0;
        const ix = steps.findIndex(st => st && String(st.labelSuffix || '').trim() === lab);
        return ix >= 0 ? ix : 0;
    },

    _resolveMedia(type, alias) {
        const name = String(alias || '').trim();
        if (!name) return '';
        return typeof AssetManager !== 'undefined' && AssetManager.resolveMediaUrl
            ? AssetManager.resolveMediaUrl(type, name) || ''
            : typeof AssetManager !== 'undefined' && AssetManager.getPath
              ? AssetManager.getPath(type, name) || ''
              : '';
    },

    _activateProjectResourceScope(data) {
        if (typeof DirectoryMemory === 'undefined') return;
        const keys = [
            data && data.__projectFileName,
            data && data.projectName,
            data && data.projectName ? `${data.projectName}_exported.json` : '',
            'episode.json'
        ];
        if (DirectoryMemory.setActiveProjectKeys) DirectoryMemory.setActiveProjectKeys(keys);
        else if (DirectoryMemory.setActiveProjectKey) DirectoryMemory.setActiveProjectKey(keys.find(Boolean) || '');
    },

    async _resolveMediaAsync(type, alias) {
        const name = String(alias || '').trim();
        if (!name) return '';
        if (typeof AssetManager !== 'undefined' && AssetManager.resolveProjectAssetUrl) {
            const url = await AssetManager.resolveProjectAssetUrl(type, name);
            if (url) return url;
        }
        return this._resolveMedia(type, name);
    },

    async _collectBootSessionUrls(data, launchOpts) {
        const images = [];
        const audios = [];
        const videos = [];
        if (!data || !Array.isArray(data.scenes)) return { images, audios, videos };
        const entry = this._resolveBootEntry(data, launchOpts);
        const scene = data.scenes.find(s => s && s.id === entry.sceneId);
        if (!scene) return { images, audios, videos };
        const bgAlias = scene.background && scene.background.url ? String(scene.background.url).trim() : '';
        const bgUrl = await this._resolveMediaAsync('backgrounds', bgAlias);
        if (bgUrl) images.push(bgUrl);
        const musicAlias = scene.music && scene.music.url ? String(scene.music.url).trim() : '';
        const musicUrl = await this._resolveMediaAsync('music', musicAlias);
        if (musicUrl) audios.push(musicUrl);
        const startIx = this._bootStepIndex(scene, entry.labelSuffix);
        const steps = scene.steps || [];
        for (let i = startIx; i < Math.min(steps.length, startIx + 40); i++) {
            const st = steps[i];
            if (!st) continue;
            if (st.type === 'cg') {
                const cg = st.cg && typeof st.cg === 'object' ? st.cg : {};
                const cgAlias = cg.url ? String(cg.url).trim() : '';
                const cgUrl =
                    cg.embeddedDataUrl ||
                    await this._resolveMediaAsync(cg.mediaType === 'video' ? 'videos' : 'storyGraphics', cgAlias) ||
                    await this._resolveMediaAsync('storyGraphics', cgAlias);
                if (cgUrl) {
                    if (cg.mediaType === 'video' || /\.(mp4|webm|ogg)(\?|#|$)/i.test(cgUrl)) videos.push(cgUrl);
                    else images.push(cgUrl);
                }
                const cgMusic = st.cgMusicAlias != null ? String(st.cgMusicAlias).trim() : '';
                const cgMusicUrl = await this._resolveMediaAsync('music', cgMusic);
                if (cgMusicUrl) audios.push(cgMusicUrl);
                break;
            }
            if (st.type === 'graphicReading' && typeof GraphicReadingConfig !== 'undefined') {
                const mod = GraphicReadingConfig.findModule(data, st.graphicReadingModuleId);
                if (mod) {
                    for (const img of mod.images || []) {
                        const imgUrl = img && img.alias ? await this._resolveMediaAsync('storyGraphics', img.alias) : '';
                        if (imgUrl) images.push(imgUrl);
                    }
                    const musicUrl2 = mod.cgMusicAlias ? await this._resolveMediaAsync('music', mod.cgMusicAlias) : '';
                    if (musicUrl2) audios.push(musicUrl2);
                }
                break;
            }
        }
        return { images, audios, videos };
    },

    _preloadBootImage(url) {
        return new Promise(resolve => {
            if (!url) {
                resolve();
                return;
            }
            if (this.imageCache[url] && this.imageCache[url].complete && this.imageCache[url].naturalWidth) {
                resolve();
                return;
            }
            const img = this.imageCache[url] || new Image();
            const done = () => resolve();
            img.onload = done;
            img.onerror = done;
            img.src = url;
            this.imageCache[url] = img;
            setTimeout(done, 15000);
        });
    },

    _preloadBootAudio(url) {
        return new Promise(resolve => {
            if (!url) {
                resolve();
                return;
            }
            const audio = new Audio();
            const done = () => {
                audio.src = '';
                resolve();
            };
            audio.addEventListener('canplaythrough', done, { once: true });
            audio.addEventListener('error', done, { once: true });
            audio.preload = 'auto';
            audio.src = url;
            setTimeout(done, 15000);
        });
    },

    _preloadBootVideo(url) {
        return new Promise(resolve => {
            if (!url) {
                resolve();
                return;
            }
            const video = document.createElement('video');
            const done = () => {
                video.src = '';
                resolve();
            };
            video.muted = true;
            video.preload = 'auto';
            video.addEventListener('canplaythrough', done, { once: true });
            video.addEventListener('error', done, { once: true });
            video.src = url;
            setTimeout(done, 20000);
        });
    },

    async preloadBootSessionAssets(data, launchOpts) {
        this._activateProjectResourceScope(data);
        if (typeof AssetManager !== 'undefined' && AssetManager.init) {
            AssetManager.init();
            if (AssetManager.repairProjectEmbedded) AssetManager.repairProjectEmbedded(data);
            AssetManager.applyProjectEmbedded((data && data.embeddedAssetLibrary) || null);
        }
        const pack = await this._collectBootSessionUrls(data, launchOpts);
        const jobs = [
            ...[...new Set(pack.images)].map(url => this._preloadBootImage(url)),
            ...[...new Set(pack.audios)].map(url => this._preloadBootAudio(url)),
            ...[...new Set(pack.videos)].map(url => this._preloadBootVideo(url))
        ];
        await Promise.all(jobs);
    },

    async preloadAllResources() {
        if (!this.storyData || !this.storyData.scenes) return;
        const imagesToLoad = [];
        for (const scene of this.storyData.scenes) {
            if (scene.background && scene.background.url) {
                const alias = scene.background.url;
                const path = await this._resolveMediaAsync('backgrounds', alias);
                if (path) imagesToLoad.push(path);
            }
            if (scene.storyGraphic) {
                if (scene.storyGraphic.embeddedDataUrl) {
                    imagesToLoad.push(scene.storyGraphic.embeddedDataUrl);
                } else if (scene.storyGraphic.url) {
                    const a = scene.storyGraphic.url;
                    const path = await this._resolveMediaAsync('storyGraphics', a);
                    if (path) imagesToLoad.push(path);
                }
            }
        }
        const aliases =
            typeof AssetManager !== 'undefined' && AssetManager.collectCharacterSpriteAliases
                ? AssetManager.collectCharacterSpriteAliases(this.storyData)
                : new Set();
        for (const alias of aliases) {
            const path = await this._resolveMediaAsync('characters', alias);
            if (path) imagesToLoad.push(path);
        }
        for (const m of this.storyData.graphicReadingModules || []) {
            for (const img of m.images || []) {
                const alias = img && img.alias ? String(img.alias).trim() : '';
                if (!alias) continue;
                const path = await this._resolveMediaAsync('storyGraphics', alias);
                if (path) imagesToLoad.push(path);
            }
            if (m && m.cgMusicAlias) await this._resolveMediaAsync('music', m.cgMusicAlias);
        }

        const uniqueImages = [...new Set(imagesToLoad)];
        uniqueImages.forEach(url => {
            const img = new Image();
            img.src = url;
            this.imageCache[url] = img;
        });
    },

    setupEvents() {
        document.getElementById('game-canvas').addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            if (e.target.closest && e.target.closest('#layer-owned-gallery')) return;
            if (typeof SceneManager !== 'undefined' && SceneManager.onAdvance) {
                SceneManager.onAdvance();
            }
        });
    },

    renderScene(scene, opts = null) {
        if (!scene) return;
        if (typeof StoryEffects !== 'undefined' && StoryEffects.clear) {
            StoryEffects.clear();
        }

        const ownBg = scene.background || {};
        const inheritedBg = opts && opts.inheritedBackground ? opts.inheritedBackground : null;
        const hasOwnBg = ownBg && String(ownBg.url || '').trim();
        const hasInheritedBg = inheritedBg && String(inheritedBg.url || '').trim();
        const bgRaw = hasOwnBg ? ownBg : hasInheritedBg ? inheritedBg : ownBg;
        const bgNorm = LayoutHelpers.normalizeBackground(bgRaw);
        const bgLayer = document.getElementById('layer-bg');
        bgLayer.innerHTML = '';
        const bgPath =
            bgRaw.url &&
            (typeof AssetManager !== 'undefined' && AssetManager.resolveMediaUrl
                ? AssetManager.resolveMediaUrl('backgrounds', bgRaw.url)
                : typeof AssetManager !== 'undefined' && AssetManager.getPath
                  ? AssetManager.getPath('backgrounds', bgRaw.url)
                  : null);
        const bgImg = (bgPath && this.imageCache[bgPath]) || new Image();
        if (bgPath && !this.imageCache[bgPath]) {
            bgImg.src = bgPath;
            bgImg.onerror = () => {
                if (typeof console !== 'undefined' && console.warn) {
                    console.warn('[Renderer] 背景图加载失败（请确认与 index.html 同目录下存在该文件，或重新导出带内嵌图的项目）:', bgPath);
                }
            };
        }

        const applyBg = () => LayoutHelpers.applyBackgroundContain(bgImg, bgNorm);
        if (bgImg.complete && bgImg.naturalWidth) applyBg();
        else bgImg.onload = applyBg;
        bgLayer.appendChild(bgImg);

        const charLayer = document.getElementById('layer-char');
        charLayer.innerHTML = '';
        // 立绘由 enterCurrentStep 在更新对话框布局后再绘制（否则小图高度测量错误）

        const storyLayer = document.getElementById('layer-story');
        if (storyLayer) {
            storyLayer.innerHTML = '';
            const sg = scene.storyGraphic || {};
            let storySrc = null;
            if (sg.embeddedDataUrl) storySrc = sg.embeddedDataUrl;
            else if (sg.url) {
                storySrc =
                    typeof AssetManager !== 'undefined' && AssetManager.resolveMediaUrl
                        ? AssetManager.resolveMediaUrl('storyGraphics', sg.url)
                        : typeof AssetManager !== 'undefined' && AssetManager.getPath
                          ? AssetManager.getPath('storyGraphics', sg.url)
                          : null;
            }
            if (storySrc) {
                const img = this.imageCache[storySrc] || new Image();
                if (!this.imageCache[storySrc]) img.src = storySrc;
                const wrap = document.createElement('div');
                wrap.style.cssText =
                    'position:relative;display:flex;align-items:center;justify-content:center;width:100%;height:100%;';
                wrap.appendChild(img);
                storyLayer.appendChild(wrap);

                const runFx = () => {
                    if (typeof StoryEffects !== 'undefined' && StoryEffects.runForScene) {
                        StoryEffects.runForScene(scene);
                    }
                };
                if (img.complete && img.naturalWidth) runFx();
                else {
                    img.onload = runFx;
                    img.onerror = runFx;
                }
            } else if (typeof StoryEffects !== 'undefined' && StoryEffects.runForScene) {
                StoryEffects.runForScene(scene);
            }
        }

        // 对话/CG/选项由 SceneManager.enterCurrentStep() 驱动 UIManager 展示
    }
};

Renderer.renderCharacterForStep = function (scene, step) {
    const charLayer = document.getElementById('layer-char');
    if (!charLayer) return;
    charLayer.innerHTML = '';
    if (!scene) return;

    // narration/choice/random/cg 步骤默认不显示立绘（CG 是否显示立绘由 UIManager 控制 show/hide layer-char）
    const t = step && step.type ? step.type : 'dialogue';
    if (t !== 'dialogue') return;

    const charPath = CharacterBinding.resolveSpriteUrlForStep(scene, step, this.storyData);
    if (!charPath) return;

    const dlgBox = document.getElementById('dialogue-box');
    const canvas = document.getElementById('game-canvas');
    /** 与设计坐标一致的实际画布高度（若视口曾被错误缩小，可避免与固定 VIEW_H 混用把小图槽算爆） */
    const viewH = (canvas && canvas.clientHeight > 0 ? canvas.clientHeight : LayoutHelpers.VIEW_H);
    /**
     * 立绘可用高度（小图）：
     * 运行端对话层固定 bottom:24px；槽高必须与 viewH、对白框同属一套布局像素。
     */
    let slotH = Math.max(48, Math.min(viewH, 520));
    if (dlgBox) {
        const DIALOG_BOTTOM = 24;
        // 运行端对白框为固定三行高度，正常在约 136px；给出固定下限避免字体渲染差异导致槽高飘动
        const boxH = Math.max(136, dlgBox.offsetHeight || 136);
        const raw = viewH - DIALOG_BOTTOM - boxH - 4;
        slotH = Math.max(48, Math.min(viewH, raw));
    }

    const mode = (step && step.charMode) || 'big'; // 'big' | 'small'
    const mirror = !!(step && step.mirror);

    const defaultSpriteLayout =
        typeof CharacterBinding !== 'undefined' && CharacterBinding.resolveDefaultLayoutForStep
            ? CharacterBinding.resolveDefaultLayoutForStep(scene, step, this.storyData)
            : null;
    const laySource =
        step && step.charLayout && typeof step.charLayout === 'object'
            ? { layout: step.charLayout }
            : defaultSpriteLayout
              ? { layout: defaultSpriteLayout }
              : scene.character;
    const lay = LayoutHelpers.normalizeCharacterLayout(laySource);
    const wrap = document.createElement('div');
    wrap.style.position = 'absolute';
    wrap.style.left = '50%';
    wrap.style.pointerEvents = 'none';
    wrap.style.display = 'flex';
    wrap.style.alignItems = 'flex-end';
    wrap.style.justifyContent = 'center';
    wrap.style.transformOrigin = '50% 100%';

    if (mode === 'small') {
        // 小图：上沿对齐画布顶，下沿对齐对话框组件上沿（槽内等比放大，底部对齐）
        wrap.style.top = '0';
        wrap.style.bottom = 'auto';
        wrap.style.height = `${slotH}px`;
    } else {
        // 大图：占满全屏高（等比，仅控制高度）
        wrap.style.top = '0';
        wrap.style.bottom = '0';
        wrap.style.height = '';
    }

    wrap.style.transform = `translateX(calc(-50% + ${lay.panX}px)) translateY(${lay.panY}px) scale(${lay.zoom})`;

    const img = this.imageCache[charPath] || new Image();
    if (!this.imageCache[charPath]) img.src = charPath;
    img.style.height = '100%';
    img.style.width = 'auto';
    img.style.objectFit = 'contain';
    img.style.transform = mirror ? 'scaleX(-1)' : '';

    wrap.appendChild(img);
    charLayer.appendChild(wrap);
};

SceneManager.jumpTo = function (id) {
    this.jumpToScene(id, '');
};
