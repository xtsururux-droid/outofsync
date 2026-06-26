/**
 * main.js - 初始化与引导逻辑
 */
window.addEventListener('load', () => {
    initResponsiveCanvas();
    window.addEventListener('resize', initResponsiveCanvas);
    initBootProcess();
});

function initResponsiveCanvas() {
    const viewport = document.getElementById('game-viewport');
    if (!viewport) return;
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    const gameWidth = 1280;
    const gameHeight = 720;
    /** 与设计分辨率一致的布局尺寸；整体缩放只靠 transform，避免与 width/height 叠加造成「缩放两次」 */
    let scale = Math.min(windowWidth / gameWidth, windowHeight / gameHeight, 1);
    viewport.style.width = `${gameWidth}px`;
    viewport.style.height = `${gameHeight}px`;
    viewport.style.transformOrigin = 'center center';
    viewport.style.position = 'absolute';
    viewport.style.left = '50%';
    viewport.style.top = '50%';
    viewport.style.transform = `translate(-50%, -50%) scale(${scale})`;
}

function initBootProcess() {
    const btnSelect = document.getElementById('btn-select-file');
    const btnContinue = document.getElementById('btn-continue-game');
    const btnNewGame = document.getElementById('btn-new-game');
    const fileInput = document.getElementById('project-upload');
    const bootScreen = document.getElementById('boot-screen');
    const gameViewport = document.getElementById('game-viewport');
    let pendingProjectData = null;

    const prepareScreen = document.getElementById('game-prepare-screen');
    const prepareCountdown = document.getElementById('game-prepare-countdown');
    const prepareHint = document.getElementById('game-prepare-hint');

    const shouldRunBootPrepare = launchOpts => {
        if (launchOpts && launchOpts.sceneId && launchOpts.fragmentId) return false;
        try {
            const sp = new URLSearchParams(window.location.search);
            if (sp.get('gaaFragmentPreview') === '1' || sp.get('gaaProjectPreview') === '1') return false;
        } catch {}
        return true;
    };

    const runBootPrepare = async (data, launchOpts) => {
        if (prepareScreen) {
            prepareScreen.style.display = 'flex';
            if (bootScreen) bootScreen.style.display = 'none';
        } else if (bootScreen) {
            bootScreen.style.display = 'flex';
            const bootHint = document.getElementById('boot-save-hint');
            if (bootHint) bootHint.textContent = '正在准备，请稍候…';
        }
        if (prepareHint) prepareHint.textContent = '正在加载，请稍等…';
        if (prepareCountdown) prepareCountdown.textContent = '';
        try {
            await (typeof Renderer !== 'undefined' && Renderer.preloadBootSessionAssets
                ? Renderer.preloadBootSessionAssets(data, launchOpts)
                : Promise.resolve());
        } finally {
            if (prepareScreen) prepareScreen.style.display = 'none';
        }
    };

    const restoreBootAfterStartFailure = () => {
        if (prepareScreen) prepareScreen.style.display = 'none';
        if (gameViewport) gameViewport.style.display = 'none';
        if (bootScreen) bootScreen.style.display = 'flex';
        if (btnNewGame) btnNewGame.disabled = false;
        if (btnContinue) btnContinue.disabled = false;
    };

    const startGame = async (data, launchOpts = null) => {
        if (typeof Renderer === 'undefined' || !Renderer.init) {
            throw new Error('游戏核心脚本未加载完整，请按 Ctrl+F5 强制刷新页面。');
        }
        if (shouldRunBootPrepare(launchOpts)) {
            await runBootPrepare(data, launchOpts);
        } else if (bootScreen) {
            bootScreen.style.display = 'none';
        }
        if (gameViewport) gameViewport.style.display = 'block';
        const isContinue = !!(launchOpts && launchOpts.continueSnapshot);
        if (!isContinue && typeof GameState !== 'undefined' && GameState.initCharacterState) {
            GameState.initCharacterState(data);
        }
        await Renderer.init(data, launchOpts);
    };

    const safeStartGame = async (data, launchOpts) => {
        if (btnNewGame) btnNewGame.disabled = true;
        if (btnContinue) btnContinue.disabled = true;
        try {
            await startGame(data, launchOpts);
        } catch (err) {
            console.error('[startGame] 启动失败', err);
            restoreBootAfterStartFailure();
            alert('启动失败：' + (err && err.message ? err.message : String(err)));
        } finally {
            if (btnNewGame && pendingProjectData) btnNewGame.disabled = false;
            if (btnContinue && pendingProjectData) btnContinue.disabled = false;
        }
    };

    const refreshBootSaveUi = data => {
        const hint = document.getElementById('boot-save-hint');
        if (!data) {
            if (hint) hint.textContent = '请先加载项目（或选择项目文件）。';
            if (btnContinue) btnContinue.style.display = 'none';
            return;
        }
        if (typeof PlaySave === 'undefined') {
            if (hint) {
                hint.textContent =
                    '存档功能未加载，请按 Ctrl+F5 强制刷新页面后重试。';
            }
            if (btnContinue) btnContinue.style.display = 'none';
            return;
        }
        PlaySave.normalizeSettings(data);
        const summary = PlaySave.getSaveSummary(data);
        const hasSave = !!(summary && summary.snapshot);
        const enabled = PlaySave.isAutoSaveEnabled(data);
        const ps = data.playSave || {};
        const checkpointLabel =
            ps.autoSaveLabelSuffix && String(ps.autoSaveLabelSuffix).trim()
                ? `「${ps.autoSaveLabelSuffix}」`
                : '您设定的存档标签';
        const sceneRow = (data.scenes || []).find(s => s && s.id === ps.autoSaveSceneId);
        const sceneLabel = (sceneRow && (sceneRow.name || sceneRow.id)) || '指定场景';
        if (btnContinue) btnContinue.style.display = hasSave ? '' : 'none';
        if (btnContinue && hasSave && summary) {
            btnContinue.textContent = `继续游戏（${summary.place}）`;
        }
        if (hint) {
            if (hasSave && summary.timeStr) {
                hint.textContent = `上次自动存档：${summary.timeStr}`;
            } else if (enabled) {
                hint.textContent =
                    `尚无自动存档。需要先在【${sceneLabel}】玩到步骤 ${checkpointLabel}，关闭后再开才会出现「继续游戏」。`;
            } else {
                hint.textContent =
                    '本项目未启用游玩存档；请在编辑器勾选「游玩存档」并导出后再玩。';
            }
        }
    };

    const showBootMenu = data => {
        pendingProjectData = data;
        bootScreen.style.display = 'flex';
        gameViewport.style.display = 'none';
        setBootProjectReady(true);
        refreshBootSaveUi(data);
    };

    /** 自动加载 episode.json 后的进入方式：默认与以前一样直接新游戏；仅 URL 带 menu=1 或有档且未要求跳过时才停菜单 */
    const repairLoadedProjectAssets = data => {
        if (data && typeof AssetManager !== 'undefined' && AssetManager.init) {
            AssetManager.init();
            if (AssetManager.repairProjectEmbedded) AssetManager.repairProjectEmbedded(data);
        }
        return data;
    };

    const launchAfterProjectLoaded = data => {
        data = repairLoadedProjectAssets(data);
        const sp = new URLSearchParams(window.location.search);
        if (sp.get('menu') === '1') {
            showBootMenu(data);
            if (btnSelect) btnSelect.textContent = '选择其它项目文件';
            return;
        }
        if (sp.get('continue') === '1') {
            const snap =
                typeof PlaySave !== 'undefined' && PlaySave.readSnapshot
                    ? PlaySave.readSnapshot(data)
                    : null;
            if (snap) {
                safeStartGame(data, { continueSnapshot: snap });
                return;
            }
            alert('尚未有存档');
            showBootMenu(data);
            if (btnSelect) btnSelect.textContent = '选择其它项目文件';
            return;
        }
        if (sp.get('new') === '1' || sp.get('newgame') === '1') {
            safeStartGame(data, null);
            return;
        }
        const hasSave =
            typeof PlaySave !== 'undefined' &&
            PlaySave.hasReadableSave &&
            PlaySave.hasReadableSave(data);
        if (hasSave && sp.get('skipmenu') !== '1') {
            showBootMenu(data);
            if (btnSelect) btnSelect.textContent = '选择其它项目文件';
            return;
        }
        safeStartGame(data, null);
    };

    const stripFragmentPreviewParamsFromUrl = () => {
        try {
            const u = new URL(window.location.href);
            if (
                u.searchParams.get('gaaFragmentPreview') !== '1' &&
                u.searchParams.get('gaaProjectPreview') !== '1' &&
                !u.searchParams.get('fpid') &&
                !u.searchParams.get('pid')
            )
                return;
            u.searchParams.delete('gaaFragmentPreview');
            u.searchParams.delete('gaaProjectPreview');
            u.searchParams.delete('fpid');
            u.searchParams.delete('pid');
            const tail = (u.search || '') + (u.hash || '');
            window.history.replaceState({}, '', u.pathname + tail);
        } catch {}
    };

    const tryConsumeEditorFragmentPreview = () => {
        try {
            if (new URLSearchParams(window.location.search).get('gaaFragmentPreview') !== '1') return null;
            const sp = new URLSearchParams(window.location.search);
            let fpid = sp.get('fpid') || '';
            fpid = String(fpid).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
            if (!fpid) {
                stripFragmentPreviewParamsFromUrl();
                alert('片段预览链接无效（缺少 fpid）。请从编辑器的「立即播放」重新打开。');
                return null;
            }
            const key = `gaa_fragment_preview_payload_${fpid}`;
            const raw = localStorage.getItem(key);
            try {
                localStorage.removeItem(key);
            } catch {}
            stripFragmentPreviewParamsFromUrl();
            if (!raw) {
                alert('未找到片段预览数据（可能已过期或已被读取）。请从编辑器重新点「立即播放」。');
                return null;
            }
            const parsed = JSON.parse(raw);
            if (!parsed || !parsed.project || !parsed.sceneId || !parsed.fragmentId) return null;
            return { project: parsed.project, sceneId: parsed.sceneId, fragmentId: parsed.fragmentId };
        } catch (e) {
            if (typeof console !== 'undefined' && console.warn) console.warn('读取片段预览数据失败', e);
            stripFragmentPreviewParamsFromUrl();
            return null;
        }
    };

    const tryConsumeEditorProjectPreview = () => {
        try {
            const sp = new URLSearchParams(window.location.search);
            if (sp.get('gaaProjectPreview') !== '1') return null;
            let pid = sp.get('pid') || '';
            pid = String(pid).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
            if (!pid) {
                stripFragmentPreviewParamsFromUrl();
                alert('调试试玩链接无效（缺少 pid）。请从编辑器重新点击「调试」。');
                return null;
            }
            const key = `gaa_project_preview_payload_${pid}`;
            const raw = localStorage.getItem(key);
            try {
                localStorage.removeItem(key);
            } catch {}
            stripFragmentPreviewParamsFromUrl();
            if (!raw) {
                alert('未找到编辑器传来的调试项目数据。请从编辑器重新点击「调试」。');
                return null;
            }
            const parsed = JSON.parse(raw);
            return parsed && parsed.project ? parsed.project : null;
        } catch (e) {
            if (typeof console !== 'undefined' && console.warn) console.warn('读取编辑器调试项目数据失败', e);
            stripFragmentPreviewParamsFromUrl();
            return null;
        }
    };

    const tryLoadByFetch = async () => {
        const res = await fetch(`episode.json?v=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) {
            throw new Error(`fetch 无法读取 episode.json (${res.status})`);
        }
        return await res.json();
    };

    const tryLoadByXHR = async (sync = false) => {
        return await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', `episode.json?v=${Date.now()}`, !sync);
            if (sync) {
                try {
                    xhr.send(null);
                    if (xhr.status === 200 || xhr.status === 0) {
                        resolve(JSON.parse(xhr.responseText));
                        return;
                    }
                    reject(new Error(`同步 XHR 无法读取 episode.json (${xhr.status})`));
                } catch (err) {
                    reject(err);
                }
                return;
            }
            xhr.onreadystatechange = () => {
                if (xhr.readyState !== 4) return;
                if (xhr.status === 200 || xhr.status === 0) {
                    try {
                        resolve(JSON.parse(xhr.responseText));
                    } catch (err) {
                        reject(new Error('XHR 读取成功但 JSON 解析失败'));
                    }
                    return;
                }
                reject(new Error(`XHR 无法读取 episode.json (${xhr.status})`));
            };
            xhr.onerror = () => reject(new Error('XHR 读取 episode.json 失败'));
            xhr.send();
        });
    };

    const isFileProtocol = () => {
        try {
            return window.location.protocol === 'file:';
        } catch {
            return false;
        }
    };

    const tryLoadByFs = async () => {
        if (typeof window.require !== 'function') {
            throw new Error('当前环境不支持 window.require');
        }
        const fs = window.require('fs');
        const path = window.require('path');
        const baseDir = decodeURIComponent(window.location.pathname).replace(/^\/([a-zA-Z]:\/)/, '$1');
        const jsonPath = path.join(path.dirname(baseDir), 'episode.json');
        const text = fs.readFileSync(jsonPath, 'utf8');
        return JSON.parse(text);
    };

    const setBootProjectReady = ready => {
        if (btnNewGame) {
            btnNewGame.disabled = !ready;
            btnNewGame.style.opacity = ready ? '' : '0.45';
            btnNewGame.style.cursor = ready ? 'pointer' : 'not-allowed';
        }
        if (btnContinue) btnContinue.disabled = !ready;
    };

    const showBootLoadFailed = err => {
        console.warn('自动加载 episode.json 失败，切换为手动选择：', err);
        pendingProjectData = null;
        bootScreen.style.display = 'flex';
        gameViewport.style.display = 'none';
        setBootProjectReady(false);
        const hint = document.getElementById('boot-save-hint');
        if (hint) {
            if (isFileProtocol()) {
                hint.textContent =
                    '当前是双击打开的页面，浏览器通常不能自动读 json。请先点下面橙色按钮，选中与 index.html 同目录的 episode.json。';
            } else {
                hint.textContent =
                    '未能自动读取 episode.json。请点「选择 episode.json」手动选中项目文件，或确认它与 index.html 在同一文件夹。';
            }
        }
        if (btnSelect) {
            btnSelect.textContent = '选择 episode.json 开始';
        }
    };

    const tryAutoLoadDefaultProject = async () => {
        try {
            let data = null;
            const loaders = [tryLoadByFetch, () => tryLoadByXHR(false), () => tryLoadByXHR(true), tryLoadByFs];
            let lastErr = null;
            for (const load of loaders) {
                try {
                    data = await load();
                    if (data) break;
                } catch (e) {
                    lastErr = e;
                }
            }
            if (!data) throw lastErr || new Error('无法加载 episode.json');
            launchAfterProjectLoaded(data);
        } catch (err) {
            showBootLoadFailed(err);
        }
    };

    if (btnContinue) {
        btnContinue.onclick = () => {
            if (!pendingProjectData) return;
            const snap =
                typeof PlaySave !== 'undefined' && PlaySave.readSnapshot
                    ? PlaySave.readSnapshot(pendingProjectData)
                    : null;
            if (!snap) {
                alert('未找到可继续的自动存档。');
                refreshBootSaveUi(pendingProjectData);
                return;
            }
            safeStartGame(pendingProjectData, { continueSnapshot: snap });
        };
    }
    if (btnNewGame) {
        btnNewGame.onclick = () => {
            if (!pendingProjectData) {
                alert('请先点「选择 episode.json」加载项目，再开始新游戏。');
                if (btnSelect) btnSelect.click();
                return;
            }
            safeStartGame(pendingProjectData, null);
        };
    }

    btnSelect.onclick = () => fileInput.click();

    fileInput.onchange = async e => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const data = await StorageManager.loadProjectFile(file);
            data.__projectFileName = file.name || '';
            launchAfterProjectLoaded(data);
        } catch (err) {
            alert('项目加载失败: ' + err);
        }
    };

    const fragPv = tryConsumeEditorFragmentPreview();
    if (fragPv) {
        safeStartGame(fragPv.project, { sceneId: fragPv.sceneId, fragmentId: fragPv.fragmentId });
        return;
    }

    const projectPreview = tryConsumeEditorProjectPreview();
    if (projectPreview) {
        safeStartGame(projectPreview, null);
        return;
    }

    tryAutoLoadDefaultProject();
}
