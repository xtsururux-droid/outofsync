/**
 * graphic-reading-config.js - 图文朗读模块：数据整理、图片排序、正文切图标记解析。
 */
const GraphicReadingConfig = {
    transitionOptions: [
        { id: 'fade', label: '淡入淡出', ms: 1000 },
        { id: 'softGlow', label: '柔光溶解', ms: 1200 },
        { id: 'slowZoom', label: '缓慢推近', ms: 1200 },
        { id: 'darkFade', label: '暗场过渡', ms: 1000 }
    ],

    normalizeProject(project) {
        if (!project || typeof project !== 'object') return [];
        if (!Array.isArray(project.graphicReadingModules)) project.graphicReadingModules = [];
        project.graphicReadingModules = project.graphicReadingModules
            .filter(m => m && typeof m === 'object')
            .map((m, i) => this.normalizeModule(m, i));
        return project.graphicReadingModules;
    },

    normalizeModule(m, index = 0) {
        const id =
            typeof m.id === 'string' && m.id.trim()
                ? m.id.trim()
                : `grmod_${Date.now().toString(36)}_${index}`;
        const transition = this.transitionOptions.some(x => x.id === m.transition) ? m.transition : 'fade';
        const transitionDefault = this.transitionOptions.find(x => x.id === transition) || this.transitionOptions[0];
        const secRaw = Number(m.transitionSeconds);
        const transitionSeconds =
            Number.isFinite(secRaw) && secRaw > 0
                ? Math.max(0.1, Math.min(20, secRaw))
                : transitionDefault.ms / 1000;
        const lines = Math.floor(Number(m.narrationLinesPerPage));
        const font = Math.floor(Number(m.narrationFontPx));
        const images = Array.isArray(m.images)
            ? m.images
                  .filter(x => x && typeof x === 'object')
                  .map((x, i) => ({
                      alias: String(x.alias || '').trim(),
                      title: String(x.title || '').trim(),
                      index: Number.isFinite(Number(x.index)) ? Math.max(1, Math.floor(Number(x.index))) : i + 1
                  }))
                  .filter(x => x.alias)
                  .sort((a, b) => a.index - b.index)
            : [];
        return {
            id,
            title: String(m.title || '').trim() || `图文朗读${index + 1}`,
            images,
            cgMusicAlias: String(m.cgMusicAlias || '').trim(),
            transition,
            transitionSeconds,
            narrationText: String(m.narrationText || '').replace(/\r\n/g, '\n'),
            copyBody: String(m.copyBody || '').replace(/\r\n/g, '\n'),
            narrationLinesPerPage: Number.isFinite(lines) && lines >= 1 ? Math.min(80, lines) : 6,
            narrationFontPx: Number.isFinite(font) && font >= 8 ? Math.min(48, font) : 16,
            narrationColor: String(m.narrationColor || '#e8e6e3').trim() || '#e8e6e3',
            narrationTypewriterMsPerChar:
                m.narrationTypewriterMsPerChar === '' || m.narrationTypewriterMsPerChar == null
                    ? 0
                    : Math.max(0, Number(m.narrationTypewriterMsPerChar) || 0)
        };
    },

    transitionInfo(id) {
        return this.transitionOptions.find(x => x.id === id) || this.transitionOptions[0];
    },

    transitionDurationMs(module) {
        const info = this.transitionInfo(module && module.transition);
        const sec = Number(module && module.transitionSeconds);
        return Number.isFinite(sec) && sec > 0 ? Math.round(Math.max(0.1, Math.min(20, sec)) * 1000) : info.ms;
    },

    stripImageTitle(fileName) {
        const base = String(fileName || '').replace(/\.[^.]+$/, '').trim();
        return base
            .replace(/\s*[（(]\s*\d+\s*[）)]\s*$/g, '')
            .replace(/\s*\d+\s*$/g, '')
            .trim();
    },

    imageNumberFromName(name, fallback = 1) {
        const s = String(name || '').replace(/\.[^.]+$/, '');
        const m = s.match(/[（(]\s*(\d+)\s*[）)]\s*$/) || s.match(/(\d+)\s*$/);
        return m ? Math.max(1, Math.floor(Number(m[1]) || fallback)) : fallback;
    },

    chineseNumber(n) {
        const nums = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
        const x = Math.floor(Number(n) || 0);
        if (x <= 0) return String(n);
        if (x < 10) return nums[x];
        if (x === 10) return '十';
        if (x < 20) return `十${nums[x - 10]}`;
        if (x < 100) return `${nums[Math.floor(x / 10)]}十${nums[x % 10] || ''}`;
        return String(x);
    },

    parseImageMarker(line) {
        const s = String(line || '').trim();
        const m = s.match(/^图\s*([一二三四五六七八九十\d]+)$/);
        if (!m) return 0;
        const raw = m[1];
        if (/^\d+$/.test(raw)) return Math.max(1, Number(raw) || 1);
        const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
        if (raw === '十') return 10;
        if (raw.startsWith('十')) return 10 + (map[raw.slice(1)] || 0);
        const tm = raw.match(/^([一二三四五六七八九])十([一二三四五六七八九])?$/);
        if (tm) return (map[tm[1]] || 0) * 10 + (map[tm[2]] || 0);
        return map[raw] || 0;
    },

    buildSegments(module) {
        const m = this.normalizeModule(module || {});
        const lines = String(m.narrationText || '').replace(/\r\n/g, '\n').split('\n');
        const segments = [];
        let currentIndex = m.images[0] ? m.images[0].index : 1;
        let buf = [];
        const push = () => {
            const text = buf.join('\n').trim();
            if (text) segments.push({ imageIndex: currentIndex, text });
            buf = [];
        };
        lines.forEach(line => {
            const marker = this.parseImageMarker(line);
            if (marker) {
                push();
                currentIndex = marker;
                return;
            }
            buf.push(line);
        });
        push();
        if (!segments.length && m.images[0]) segments.push({ imageIndex: m.images[0].index, text: '' });
        return segments;
    },

    findModule(project, moduleId) {
        const id = String(moduleId || '').trim();
        if (!id) return null;
        const list = this.normalizeProject(project);
        return list.find(m => m && m.id === id) || null;
    },

    imageForSegment(module, segment) {
        const idx = Number(segment && segment.imageIndex) || 1;
        const images = Array.isArray(module && module.images) ? module.images : [];
        return images.find(x => Number(x.index) === idx) || images[idx - 1] || images[0] || null;
    }
};

if (typeof window !== 'undefined') {
    window.GraphicReadingConfig = GraphicReadingConfig;
}
