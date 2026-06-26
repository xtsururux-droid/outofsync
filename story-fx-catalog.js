/**
 * story-fx-catalog.js — 步骤特效 v2 目录（与编辑器 / StoryFxEngine 一致）
 * family: sad_combo | rom_entry | rom_ambient | rom_exit | rom_combo | shock
 * target: 通用 | CG | 立绘
 */
const StoryFxCatalog = (() => {
    const T = { ALL: '通用', CG: 'CG', SPRITE: '立绘' };

    const list = [];

    function add(family, target, id, extra = {}) {
        list.push({ family, target, id, ...extra });
    }

    // 一、悲伤绝望类（组合型）
    add('sad_combo', T.CG, '深渊坠落', { entryMs: 1200, ambientLoop: true, exitMs: 1000 });
    add('sad_combo', T.SPRITE, '残叶凋零', { entryMs: 1000, ambientLoop: true, exitMs: 800 });
    add('sad_combo', T.ALL, '泪眼朦胧', { entryMs: 1500, ambientLoop: true, exitMs: 1200 });
    add('sad_combo', T.SPRITE, '灰烬崩解', { entryMs: 800, ambientLoop: true, exitMs: 1000 });
    add('sad_combo', T.CG, '镜面破碎', { entryMs: 1000, ambientLoop: false, exitMs: 800 });
    add('sad_combo', T.ALL, '雨幕长街', { entryMs: 1200, ambientLoop: true, exitMs: 1000 });
    add('sad_combo', T.CG, '像素瓦解', { entryMs: 1500, ambientLoop: false, exitMs: 1000 });
    add('sad_combo', T.SPRITE, '囚笼禁锢', { entryMs: 1000, ambientLoop: false, exitMs: 800 });
    add('sad_combo', T.ALL, '红叶祭礼', { entryMs: 1200, ambientLoop: true, exitMs: 1000 });
    add('sad_combo', T.CG, '时空拉远', { entryMs: 1000, ambientLoop: false, exitMs: 1200 });

    // 二、浪漫入场类
    add('rom_entry', T.ALL, '淡入', { entryMs: 2000 });
    add('rom_entry', T.ALL, '暖阳初照', { entryMs: 1500 });
    add('rom_entry', T.ALL, '樱花绽放', { entryMs: 1200 });
    add('rom_entry', T.ALL, '星光汇聚', { entryMs: 1500 });
    add('rom_entry', T.ALL, '晨曦揭幕', { entryMs: 1000 });
    add('rom_entry', T.ALL, '涟漪显现', { entryMs: 1500 });
    add('rom_entry', T.ALL, '粉色悸动', { entryMs: 800 });
    add('rom_entry', T.ALL, '柔焦转晴', { entryMs: 1500 });
    add('rom_entry', T.ALL, '流光掠影', { entryMs: 1000 });
    add('rom_entry', T.ALL, '金沙铺场', { entryMs: 1200 });

    // 三、浪漫氛围类
    add('rom_ambient', T.ALL, '樱吹雪', { ambientLoop: true });
    add('rom_ambient', T.ALL, '萤火微芒', { ambientLoop: true });
    add('rom_ambient', T.ALL, '秋日私语', { ambientLoop: true });
    add('rom_ambient', T.ALL, '林间浮光', { ambientLoop: true });
    add('rom_ambient', T.SPRITE, '思念回旋', { ambientLoop: true });
    add('rom_ambient', T.ALL, '粉色呼吸', { ambientLoop: true });
    add('rom_ambient', T.ALL, '微醺烟霭', { ambientLoop: true });
    add('rom_ambient', T.ALL, '星河璀璨', { ambientLoop: true });
    add('rom_ambient', T.ALL, '樱之光斑', { ambientLoop: true });
    add('rom_ambient', T.ALL, '柔光圣域', { ambientLoop: true });
    add('rom_ambient', T.ALL, '柔光圣城', { ambientLoop: true });

    // 四、浪漫出场类
    add('rom_exit', T.ALL, '淡出', { exitMs: 2000 });
    add('rom_exit', T.ALL, '繁花掩映', { exitMs: 800 });
    add('rom_exit', T.ALL, '白光升华', { exitMs: 500 });
    add('rom_exit', T.ALL, '纸鹤折叠', { exitMs: 1200 });
    add('rom_exit', T.ALL, '流光遁影', { exitMs: 600 });
    add('rom_exit', T.ALL, '像素溶解', { exitMs: 1000 });
    add('rom_exit', T.ALL, '碎星散去', { exitMs: 1200 });
    add('rom_exit', T.ALL, '涟漪消散', { exitMs: 1000 });
    add('rom_exit', T.ALL, '柔焦隐入', { exitMs: 1200 });
    add('rom_exit', T.ALL, '画面翻转', { exitMs: 800 });

    // 五、浪漫组合类
    add('rom_combo', T.SPRITE, '樱舞缘生', { entryMs: 1000, ambientLoop: true, exitMs: 800 });
    add('rom_combo', T.CG, '夏末协奏', { entryMs: 1200, ambientLoop: false, exitMs: 1000 });
    add('rom_combo', T.ALL, '一瞬万年', { entryMs: 800, ambientLoop: true, exitMs: 1500 });
    add('rom_combo', T.CG, '幻梦浮生', { entryMs: 1500, ambientLoop: false, exitMs: 1000 });
    add('rom_combo', T.SPRITE, '枫林晚照', { entryMs: 1000, ambientLoop: false, exitMs: 1000 });
    add('rom_combo', T.ALL, '萤火誓言', { entryMs: 1200, ambientLoop: true, exitMs: 1000 });
    add('rom_combo', T.CG, '星辰契约', { entryMs: 1500, ambientLoop: false, exitMs: 800 });
    add('rom_combo', T.SPRITE, '樱瓣追随', { entryMs: 800, ambientLoop: true, exitMs: 1000 });
    add('rom_combo', T.ALL, '金沙转场', { entryMs: 1200, ambientLoop: true, exitMs: 800 });
    add('rom_combo', T.CG, '流光岁月', { entryMs: 1000, ambientLoop: false, exitMs: 1000 });
    /** 脚本自动导入等场景：全屏 CG 友好 — 淡入 2s → 林间浮光氛围 → 淡出 2s */
    add('rom_combo', T.CG, '淡入林间淡出', { entryMs: 2000, ambientLoop: true, exitMs: 2000 });

    const FAMILIES = [
        { id: 'sad_combo', label: '悲伤绝望' },
        { id: 'rom_entry', label: '浪漫入场' },
        { id: 'rom_ambient', label: '浪漫氛围' },
        { id: 'rom_exit', label: '浪漫出场' },
        { id: 'rom_combo', label: '浪漫组合' },
        { id: 'shock', label: '立绘特效' }
    ];

    const TARGETS = [
        { id: T.ALL, label: '通用' },
        { id: T.CG, label: 'CG版' },
        { id: T.SPRITE, label: '立绘版' }
    ];

    const SHOCK_IDS = ['漂浮', '打击', '愤怒', '闪电', '绝望', '混乱', '冰点', '崩塌'];

    function meta(id) {
        return list.find(x => x.id === id) || null;
    }

    function listEffects(family, targetId) {
        if (family === 'shock') return SHOCK_IDS.map(id => ({ id, family: 'shock', target: T.ALL }));
        const tid = targetId || T.ALL;
        return list.filter(e => e.family === family && e.target === tid);
    }

    function demoDurationsMs() {
        return { entry: 2000, ambient: 3000, exit: 2000 };
    }

    return {
        T,
        FAMILIES,
        TARGETS,
        SHOCK_IDS,
        ALL: list,
        meta,
        listEffects,
        demoDurationsMs
    };
})();
