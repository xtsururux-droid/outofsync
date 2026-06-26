/**
 * hidden-map-config.js - 寻物地图数据工具
 */
const HiddenMapConfig = {
    normalizeProject(project) {
        if (!project || typeof project !== 'object') return;
        if (!Array.isArray(project.hiddenMapModules)) project.hiddenMapModules = [];
        const seen = new Set();
        project.hiddenMapModules = project.hiddenMapModules
            .filter(map => map && typeof map === 'object')
            .map((map, index) => {
                let mapId = String(map.mapId || map.id || '').trim();
                if (!mapId || seen.has(mapId)) mapId = this.makeMapId(index);
                seen.add(mapId);
                const spots = Array.isArray(map.spots) ? map.spots : [];
                const cleanSpots = spots
                    .filter(spot => spot && typeof spot === 'object')
                    .map((spot, spotIndex) => this.normalizeSpot(spot, spotIndex));
                const hiddenItemCount = Math.max(0, Number.isFinite(Number(map.hiddenItemCount)) ? Math.round(Number(map.hiddenItemCount)) : cleanSpots.length);
                let allowedFindCount = Number.isFinite(Number(map.allowedFindCount)) ? Math.round(Number(map.allowedFindCount)) : hiddenItemCount;
                allowedFindCount = Math.max(0, Math.min(hiddenItemCount || cleanSpots.length, allowedFindCount));
                return {
                    mapId,
                    name: String(map.name || mapId).trim() || mapId,
                    imageAlias: String(map.imageAlias || map.image || '').trim(),
                    foundSoundAlias: String(map.foundSoundAlias || map.soundAlias || '').trim(),
                    collectMode: map.collectMode === 'choice' ? 'choice' : 'auto',
                    hiddenItemCount,
                    allowedFindCount,
                    finishMode: map.finishMode === 'manual' ? 'manual' : 'auto',
                    spots: cleanSpots
                };
            });
    },

    normalizeSpot(spot, index = 0) {
        const shape = spot.shape === 'rect' ? 'rect' : 'circle';
        const x = Number.isFinite(Number(spot.x)) ? Number(spot.x) : 50;
        const y = Number.isFinite(Number(spot.y)) ? Number(spot.y) : 50;
        const width = Number.isFinite(Number(spot.width)) ? Math.max(4, Number(spot.width)) : 12;
        const height = Number.isFinite(Number(spot.height)) ? Math.max(4, Number(spot.height)) : 12;
        const radius = Number.isFinite(Number(spot.radius)) ? Math.max(2, Number(spot.radius)) : 6;
        return {
            spotId: String(spot.spotId || spot.id || `spot_${Date.now().toString(36)}_${index}`).trim(),
            label: String(spot.label || `藏物点${index + 1}`).trim(),
            shape,
            x,
            y,
            radius,
            width,
            height,
            itemId: String(spot.itemId || '').trim(),
            foundText: String(spot.foundText || spot.dialogueText || '').trim(),
            acceptText: String(spot.acceptText || '').trim(),
            rejectText: String(spot.rejectText || '').trim(),
            effect: 'glow'
        };
    },

    makeMapId(seed = '') {
        return `map_${Date.now().toString(36)}_${String(seed || Math.random().toString(16).slice(2, 6)).replace(/[^\w-]/g, '')}`;
    },

    makeSpot(index = 0) {
        return this.normalizeSpot({ label: `藏物点${index + 1}`, x: 50, y: 50, radius: 7 }, index);
    },

    getMaps(project) {
        this.normalizeProject(project);
        return project && Array.isArray(project.hiddenMapModules) ? project.hiddenMapModules : [];
    },

    findMap(project, mapId) {
        const id = String(mapId || '').trim();
        return this.getMaps(project).find(map => map && map.mapId === id) || null;
    },

    getImageUrl(map) {
        const alias = map && String(map.imageAlias || '').trim();
        if (!alias) return '';
        if (typeof AssetManager !== 'undefined' && AssetManager.getPath) {
            return AssetManager.getPath('backgrounds', alias) || AssetManager.getPath('storyGraphics', alias) || alias;
        }
        return alias;
    },

    validateMap(map) {
        const errors = [];
        if (!map || typeof map !== 'object') return ['地图不存在。'];
        if (!String(map.name || '').trim()) errors.push('请填写地图名称。');
        if (!String(map.imageAlias || '').trim()) errors.push('请选择地图图片。');
        if (Number(map.allowedFindCount) > Number(map.hiddenItemCount)) errors.push('允许找到数量不能大于藏物数量。');
        const spots = Array.isArray(map.spots) ? map.spots : [];
        if (spots.length !== Number(map.hiddenItemCount)) errors.push('藏物点数量应等于藏物数量。');
        spots.forEach((spot, index) => {
            if (!String(spot.itemId || '').trim()) errors.push(`第 ${index + 1} 个藏物点还没有绑定物品。`);
            else if (typeof ItemLibraryConfig !== 'undefined') {
                const item = ItemLibraryConfig.findItem(
                    typeof Editor !== 'undefined' ? Editor.projectData : null,
                    spot.itemId
                );
                if (item && !String(item.iconAlias || '').trim()) {
                    errors.push(`第 ${index + 1} 个藏物点绑定的物品还没有物品图片。`);
                }
            }
        });
        return errors;
    }
};

if (typeof window !== 'undefined') window.HiddenMapConfig = HiddenMapConfig;
