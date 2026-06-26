/**
 * item-library-config.js - 物品库数据工具
 */
const ItemLibraryConfig = {
    normalizeProject(project) {
        if (!project || typeof project !== 'object') return;
        if (!Array.isArray(project.itemLibrary)) project.itemLibrary = [];
        const seen = new Set();
        project.itemLibrary = project.itemLibrary
            .filter(row => row && typeof row === 'object')
            .map((row, index) => {
                let id = String(row.itemId || row.id || '').trim();
                if (!id || seen.has(id)) id = this.makeId(index);
                seen.add(id);
                return {
                    itemId: id,
                    name: String(row.name || id).trim() || id,
                    iconAlias: String(row.iconAlias || '').trim(),
                    description: String(row.description || '').trim(),
                    type: String(row.type || 'normal').trim() || 'normal',
                    stackable: !!row.stackable
                };
            });
    },

    makeId(seed = '') {
        return `item_${Date.now().toString(36)}_${String(seed || Math.random().toString(16).slice(2, 6)).replace(/[^\w-]/g, '')}`;
    },

    getItems(project) {
        this.normalizeProject(project);
        return project && Array.isArray(project.itemLibrary) ? project.itemLibrary : [];
    },

    findItem(project, itemId) {
        const id = String(itemId || '').trim();
        return this.getItems(project).find(item => item && item.itemId === id) || null;
    },

    itemLabel(project, itemId) {
        const item = this.findItem(project, itemId);
        if (!item) return itemId ? `${itemId}（未找到）` : '未选择物品';
        return `${item.name}${item.itemId ? `（${item.itemId}）` : ''}`;
    }
};

if (typeof window !== 'undefined') window.ItemLibraryConfig = ItemLibraryConfig;
